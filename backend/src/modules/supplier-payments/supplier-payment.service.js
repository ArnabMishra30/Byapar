import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, subtract, round, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as supplierPaymentRepository from './supplier-payment.repository.js';
import * as supplierPayableRepository from '../supplier-payables/supplier-payable.repository.js';
import * as supplierLedgerRepository from '../supplier-payables/supplier-ledger.repository.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import { derivePayableState, LEDGER_REFERENCE_TYPE } from '../supplier-payables/supplier-payable.service.js';
import * as supplierRepository from '../suppliers/supplier.repository.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';

// Supplier payments.
//
// A payment is money leaving for a supplier. It may be split across the bills it
// settles ("allocations"); anything not allocated stays as an advance held
// against that supplier and shows up in their balance.
//
// A payment has NO effect on any balance until it is POSTED - exactly like a
// purchase or a return.

const MONEY_DP = 4;

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * What to call the thing being settled. An OPENING BALANCE payable has no bill
 * behind it - the money was already owed when the business started here.
 */
function settledLabel(payable) {
  return payable.purchase ? payable.purchase.purchaseNumber : 'the opening balance';
}

function toPublicAllocation(allocation) {
  return {
    id: allocation.id,
    payableId: allocation.payable.id,
    // Null when this allocation settles an opening balance.
    purchase: allocation.payable.purchase
      ? {
          id: allocation.payable.purchase.id,
          purchaseNumber: allocation.payable.purchase.purchaseNumber,
          invoiceNumber: allocation.payable.purchase.invoiceNumber,
        }
      : null,
    source: allocation.payable.purchase ? 'PURCHASE' : 'OPENING_BALANCE',
    amount: toMoneyString(allocation.amount, 2),
    payableOutstandingAmount: toMoneyString(allocation.payable.outstandingAmount, 2),
  };
}

export function toPublicPayment(payment) {
  return {
    id: payment.id,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    supplier: { id: payment.supplier.id, name: payment.supplier.name },
    paymentDate: toBusinessDate(payment.paymentDate),
    amount: toMoneyString(payment.amount, 2),
    allocatedAmount: toMoneyString(payment.allocatedAmount, 2),
    // Money paid but not applied to a bill: an advance held with the supplier.
    unallocatedAmount: toMoneyString(payment.unallocatedAmount, 2),
    paymentMethod: payment.paymentMethod,
    referenceNumber: payment.referenceNumber,
    notes: payment.notes,
    allocations: payment.allocations ? payment.allocations.map(toPublicAllocation) : undefined,
    createdBy: payment.createdBy ? { id: payment.createdBy.id, name: payment.createdBy.name } : null,
    postedBy: payment.postedBy ? { id: payment.postedBy.id, name: payment.postedBy.name } : null,
    postedAt: payment.postedAt,
    cancelledBy: payment.cancelledBy
      ? { id: payment.cancelledBy.id, name: payment.cancelledBy.name }
      : null,
    cancelledAt: payment.cancelledAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

// --- validation ------------------------------------------------------------

async function assertSupplier(companyId, supplierId) {
  const supplier = await supplierRepository.findByIdAndCompany(supplierId, companyId);
  // Another company's supplier is reported exactly like a non-existent one.
  if (!supplier) throw ApiError.business(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  if (!supplier.isActive) {
    throw ApiError.business(422, 'SUPPLIER_INACTIVE', `Supplier "${supplier.name}" is inactive`);
  }
  return supplier;
}

/**
 * Checks the allocations a client sent: each payable must exist, belong to this
 * company AND this supplier, and the allocated total must not exceed the payment.
 *
 * Amounts are checked against live outstanding figures at draft time for
 * feedback; posting re-checks them under a row lock, which is authoritative.
 */
async function resolveAllocations(companyId, supplierId, input, { client } = {}) {
  const resolved = [];

  for (const [index, allocation] of (input.allocations ?? []).entries()) {
    const payable = await supplierPayableRepository.findByIdAndCompany(
      allocation.payableId,
      companyId,
      client,
    );

    if (!payable) {
      throw ApiError.business(
        404,
        'SUPPLIER_PAYABLE_NOT_FOUND',
        `Allocation ${index + 1}: payable not found`,
      );
    }
    if (payable.supplier.id !== supplierId) {
      throw ApiError.business(
        422,
        'INVALID_PAYMENT_ALLOCATION',
        `Allocation ${index + 1}: that bill belongs to a different supplier`,
      );
    }
    if (isGreaterThan(allocation.amount, payable.outstandingAmount)) {
      throw ApiError.business(
        422,
        'PAYMENT_ALLOCATION_EXCEEDS_PAYABLE',
        `Allocation ${index + 1} (${settledLabel(payable)}): only ${toMoneyString(payable.outstandingAmount, 2)} is outstanding`,
      );
    }

    resolved.push({
      supplierPayableId: payable.id,
      amount: round(allocation.amount, MONEY_DP),
    });
  }

  const allocatedAmount = resolved.reduce(
    (total, allocation) => add(total, allocation.amount),
    toDecimal(0),
  );

  // Money must never be invented. Allocating more than was paid is a bug in the
  // client, not an advance.
  if (isGreaterThan(allocatedAmount, input.amount)) {
    throw ApiError.business(
      422,
      'PAYMENT_EXCEEDS_OUTSTANDING',
      `Allocations total ${toMoneyString(allocatedAmount, 2)}, which is more than the payment of ${toMoneyString(input.amount, 2)}`,
    );
  }

  return {
    allocations: resolved,
    allocatedAmount: round(allocatedAmount, MONEY_DP),
    unallocatedAmount: round(subtract(input.amount, allocatedAmount), MONEY_DP),
  };
}

function assertIsDraft(payment) {
  if (payment.status === 'POSTED') {
    throw ApiError.business(
      409,
      'SUPPLIER_PAYMENT_ALREADY_POSTED',
      'A posted payment is a historical record and cannot be changed',
    );
  }
  if (payment.status !== 'DRAFT') {
    throw ApiError.business(
      409,
      'SUPPLIER_PAYMENT_NOT_POSTABLE',
      `This payment is ${payment.status.toLowerCase()}`,
    );
  }
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT payment. Nothing is settled until it is posted. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  await assertSupplier(companyId, input.supplierId);
  const { allocations, allocatedAmount, unallocatedAmount } = await resolveAllocations(
    companyId,
    input.supplierId,
    input,
  );

  const created = await withRetryableTransaction(async (tx) => {
    const paymentNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.SUPPLIER_PAYMENT,
      prefix: 'PAY',
      date: input.paymentDate,
    });

    return supplierPaymentRepository.createDraft(tx, {
      payment: {
        companyId,
        supplierId: input.supplierId,
        paymentNumber,
        paymentDate: input.paymentDate,
        amount: round(input.amount, MONEY_DP),
        allocatedAmount,
        unallocatedAmount,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        status: 'DRAFT',
        createdById: currentUser.id,
      },
      allocations,
    });
  });

  return toPublicPayment(created);
}

/** Replaces a draft. The supplier may not be changed. */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await supplierPaymentRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment not found');
  }
  assertIsDraft(existing);

  if (input.supplierId !== existing.supplier.id) {
    throw ApiError.business(
      422,
      'SUPPLIER_PAYMENT_SUPPLIER_IMMUTABLE',
      'A payment cannot be moved to a different supplier. Cancel it and create a new one.',
    );
  }

  await assertSupplier(companyId, input.supplierId);
  const { allocations, allocatedAmount, unallocatedAmount } = await resolveAllocations(
    companyId,
    input.supplierId,
    input,
  );

  const updated = await withRetryableTransaction(async (tx) =>
    supplierPaymentRepository.updateDraft(tx, {
      id,
      companyId,
      payment: {
        paymentDate: input.paymentDate,
        amount: round(input.amount, MONEY_DP),
        allocatedAmount,
        unallocatedAmount,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
      },
      allocations,
    }),
  );

  if (!updated) {
    throw ApiError.business(
      409,
      'SUPPLIER_PAYMENT_NOT_POSTABLE',
      'Only a draft payment can be edited',
    );
  }

  return toPublicPayment(updated);
}

/**
 * Posts the payment: the only place a payment moves a balance.
 *
 * One transaction covers the payment lock, every payable lock, the allocation
 * writes and the ledger entry. Payables are locked in id order so two payments
 * touching an overlapping set of bills can never deadlock.
 */
export async function post(currentUser, id) {
  const { companyId } = currentUser;

  const posted = await withRetryableTransaction(async (tx) => {
    const locked = await supplierPaymentRepository.lockForPosting(tx, id, companyId);

    if (!locked) {
      throw ApiError.business(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment not found');
    }
    if (locked.status === 'POSTED') {
      throw ApiError.business(
        409,
        'SUPPLIER_PAYMENT_ALREADY_POSTED',
        'This payment has already been posted',
      );
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(
        409,
        'SUPPLIER_PAYMENT_NOT_POSTABLE',
        'Only a draft payment can be posted',
      );
    }

    // Deterministic lock order across all payables this payment touches.
    const allocations = [...locked.allocations].sort((a, b) =>
      a.supplierPayableId.localeCompare(b.supplierPayableId),
    );

    let allocatedAmount = toDecimal(0);

    for (const allocation of allocations) {
      const payable = await supplierPayableRepository.lockForUpdate(
        tx,
        allocation.supplierPayableId,
        companyId,
      );

      if (!payable) {
        throw ApiError.business(404, 'SUPPLIER_PAYABLE_NOT_FOUND', 'Payable not found');
      }
      if (payable.supplierId !== locked.supplierId) {
        throw ApiError.business(
          422,
          'INVALID_PAYMENT_ALLOCATION',
          'A bill in this payment belongs to a different supplier',
        );
      }

      // Re-checked under the lock: another payment may have settled this bill
      // since the draft was prepared.
      if (isGreaterThan(allocation.amount, payable.outstandingAmount)) {
        throw ApiError.business(
          422,
          'PAYMENT_EXCEEDS_OUTSTANDING',
          `Only ${toMoneyString(payable.outstandingAmount, 2)} is outstanding on that bill, ${toMoneyString(allocation.amount, 2)} was allocated`,
        );
      }

      const paidAmount = add(payable.paidAmount, allocation.amount);
      const { outstandingAmount, status } = derivePayableState({
        originalAmount: payable.originalAmount,
        creditAmount: payable.creditAmount,
        paidAmount,
      });

      await supplierPayableRepository.updateAmounts(tx, payable.id, {
        creditAmount: payable.creditAmount,
        paidAmount: round(paidAmount, MONEY_DP),
        outstandingAmount,
        status,
      });

      allocatedAmount = add(allocatedAmount, allocation.amount);
    }

    // One ledger entry for the whole payment, for the full amount - including
    // any unallocated remainder, which is a real advance the supplier holds.
    await supplierLedgerRepository.create(tx, {
      companyId,
      supplierId: locked.supplierId,
      entryType: 'PAYMENT',
      entryDate: locked.paymentDate,
      // A payment reduces what we owe.
      debit: locked.amount,
      credit: 0,
      referenceType: LEDGER_REFERENCE_TYPE.SUPPLIER_PAYMENT,
      referenceId: locked.id,
      payableId: null,
      description: `Payment ${locked.paymentNumber}`,
      createdById: currentUser.id,
    });

    // The general ledger entry, last and in this same transaction. The split
    // between "settled a bill" and "advance held by the supplier" is the same
    // split the sub-ledger just recorded - it is not recalculated here.
    await glPostingService.recordSupplierPaymentPosted(tx, currentUser, {
      id: locked.id,
      paymentNumber: locked.paymentNumber,
      paymentDate: locked.paymentDate,
      paymentMethod: locked.paymentMethod,
      amount: locked.amount,
      allocatedAmount: round(allocatedAmount, MONEY_DP),
      unallocatedAmount: round(subtract(locked.amount, allocatedAmount), MONEY_DP),
    });

    const updated = await supplierPaymentRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: {
        status: 'POSTED',
        postedById: currentUser.id,
        postedAt: new Date(),
        allocatedAmount: round(allocatedAmount, MONEY_DP),
        unallocatedAmount: round(subtract(locked.amount, allocatedAmount), MONEY_DP),
      },
    });

    if (!updated) {
      throw ApiError.business(
        409,
        'SUPPLIER_PAYMENT_NOT_POSTABLE',
        'Only a draft payment can be posted',
      );
    }

    return updated;
  });

  return toPublicPayment(posted);
}

/** Cancels a DRAFT. A posted payment is immutable in this phase. */
export async function cancel(currentUser, id) {
  const { companyId } = currentUser;

  const existing = await supplierPaymentRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment not found');
  }
  assertIsDraft(existing);

  const cancelled = await withRetryableTransaction(async (tx) =>
    supplierPaymentRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!cancelled) {
    throw ApiError.business(
      409,
      'SUPPLIER_PAYMENT_NOT_POSTABLE',
      'Only a draft payment can be cancelled',
    );
  }

  return toPublicPayment(cancelled);
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await supplierPaymentRepository.findManyByCompany(currentUser.companyId, {
    skip,
    take,
    ...filters,
  });

  return {
    payments: items.map(toPublicPayment),
    pagination: buildPagination({ page, limit, total }),
  };
}

export async function getById(currentUser, id) {
  const payment = await supplierPaymentRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!payment) {
    throw ApiError.business(404, 'SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment not found');
  }
  return toPublicPayment(payment);
}
