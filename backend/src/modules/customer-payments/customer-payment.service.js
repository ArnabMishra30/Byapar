import { ApiError } from '../../utils/api-error.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { add, subtract, round, toDecimal, toMoneyString, isGreaterThan } from '../../utils/money.js';
import { withRetryableTransaction } from '../../config/transaction.js';
import * as customerPaymentRepository from './customer-payment.repository.js';
import * as customerReceivableRepository from '../customer-receivables/customer-receivable.repository.js';
import * as customerLedgerRepository from '../customer-receivables/customer-ledger.repository.js';
import * as glPostingService from '../accounting/gl-posting.service.js';
import {
  deriveReceivableState,
  LEDGER_REFERENCE_TYPE,
} from '../customer-receivables/customer-receivable.service.js';
import * as customerRepository from '../customers/customer.repository.js';
import { nextDocumentNumber, DOCUMENT_TYPE } from '../document-numbers/document-number.service.js';

// Customer payments - the mirror of supplier payments.
//
// Money received from a customer, optionally split across the invoices it
// settles. Anything not allocated is customer credit held against them.
// A payment has NO effect on any balance until it is POSTED.

const MONEY_DP = 4;

// --- serialization ---------------------------------------------------------

function toBusinessDate(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * What to call the thing being settled.
 *
 * An OPENING BALANCE receivable has no invoice behind it - the customer already
 * owed the money when the business started here. It is settled by an ordinary
 * receipt like any other debt, so every message has to read sensibly for both.
 */
function settledLabel(receivable) {
  return receivable.salesInvoice ? `invoice ${receivable.salesInvoice.invoiceNumber}` : 'the opening balance';
}

function toPublicAllocation(allocation) {
  return {
    id: allocation.id,
    receivableId: allocation.receivable.id,
    // Null when this allocation settles an opening balance.
    salesInvoice: allocation.receivable.salesInvoice
      ? {
          id: allocation.receivable.salesInvoice.id,
          invoiceNumber: allocation.receivable.salesInvoice.invoiceNumber,
          invoiceDate: toBusinessDate(allocation.receivable.salesInvoice.invoiceDate),
        }
      : null,
    source: allocation.receivable.salesInvoice ? 'SALES_INVOICE' : 'OPENING_BALANCE',
    amount: toMoneyString(allocation.amount, 2),
    receivableOutstandingAmount: toMoneyString(allocation.receivable.outstandingAmount, 2),
  };
}

export function toPublicPayment(payment) {
  return {
    id: payment.id,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    customer: { id: payment.customer.id, name: payment.customer.name },
    paymentDate: toBusinessDate(payment.paymentDate),
    amount: toMoneyString(payment.amount, 2),
    allocatedAmount: toMoneyString(payment.allocatedAmount, 2),
    // Money received but not applied to an invoice: credit held for the customer.
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

async function assertCustomer(companyId, customerId) {
  const customer = await customerRepository.findByIdAndCompany(customerId, companyId);
  // Another company's customer is reported exactly like a non-existent one.
  if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  if (!customer.isActive) {
    throw ApiError.business(422, 'CUSTOMER_INACTIVE', `Customer "${customer.name}" is inactive`);
  }
  return customer;
}

/**
 * Checks the allocations a client sent: each receivable must exist, belong to
 * this company AND this customer, sit on a POSTED invoice, and the allocated
 * total must not exceed the payment.
 *
 * Amounts are checked against live figures here for feedback; posting re-checks
 * them under a row lock, which is authoritative.
 */
async function resolveAllocations(companyId, customerId, input, { client } = {}) {
  const resolved = [];

  for (const [index, allocation] of (input.allocations ?? []).entries()) {
    const receivable = await customerReceivableRepository.findByIdAndCompany(
      allocation.receivableId,
      companyId,
      client,
    );

    if (!receivable) {
      throw ApiError.business(
        404,
        'CUSTOMER_RECEIVABLE_NOT_FOUND',
        `Allocation ${index + 1}: receivable not found`,
      );
    }
    if (receivable.customer.id !== customerId) {
      throw ApiError.business(
        422,
        'INVALID_PAYMENT_ALLOCATION',
        `Allocation ${index + 1}: that invoice belongs to a different customer`,
      );
    }
    // A receivable only exists for a posted invoice, but check explicitly so the
    // rule is visible rather than implied.
    // An opening receivable has no invoice to be posted; it is owed outright.
    if (receivable.salesInvoice && receivable.salesInvoice.status !== 'POSTED') {
      throw ApiError.business(
        422,
        'INVALID_PAYMENT_ALLOCATION',
        `Allocation ${index + 1}: invoice ${receivable.salesInvoice.invoiceNumber} is not posted`,
      );
    }
    if (isGreaterThan(allocation.amount, receivable.outstandingAmount)) {
      throw ApiError.business(
        422,
        'PAYMENT_ALLOCATION_EXCEEDS_RECEIVABLE',
        `Allocation ${index + 1} (${settledLabel(receivable)}): only ${toMoneyString(receivable.outstandingAmount, 2)} is outstanding`,
      );
    }

    resolved.push({
      customerReceivableId: receivable.id,
      amount: round(allocation.amount, MONEY_DP),
    });
  }

  const allocatedAmount = resolved.reduce(
    (total, allocation) => add(total, allocation.amount),
    toDecimal(0),
  );

  // Money must never be invented: allocating more than was received is a client
  // bug, not an advance.
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
      'CUSTOMER_PAYMENT_ALREADY_POSTED',
      'A posted payment is a historical record and cannot be changed',
    );
  }
  if (payment.status !== 'DRAFT') {
    throw ApiError.business(
      409,
      'CUSTOMER_PAYMENT_NOT_POSTABLE',
      `This payment is ${payment.status.toLowerCase()}`,
    );
  }
}

// --- writes ----------------------------------------------------------------

/** Creates a DRAFT payment. Nothing is settled until it is posted. */
export async function createDraft(currentUser, input) {
  const { companyId } = currentUser;

  await assertCustomer(companyId, input.customerId);
  const { allocations, allocatedAmount, unallocatedAmount } = await resolveAllocations(
    companyId,
    input.customerId,
    input,
  );

  const created = await withRetryableTransaction(async (tx) => {
    const paymentNumber = await nextDocumentNumber(tx, {
      companyId,
      documentType: DOCUMENT_TYPE.CUSTOMER_PAYMENT,
      prefix: 'RCP',
      date: input.paymentDate,
    });

    return customerPaymentRepository.createDraft(tx, {
      payment: {
        companyId,
        customerId: input.customerId,
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

/** Replaces a draft. The customer may not be changed. */
export async function updateDraft(currentUser, id, input) {
  const { companyId } = currentUser;

  const existing = await customerPaymentRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment not found');
  }
  assertIsDraft(existing);

  if (input.customerId !== existing.customer.id) {
    throw ApiError.business(
      422,
      'CUSTOMER_PAYMENT_CUSTOMER_IMMUTABLE',
      'A payment cannot be moved to a different customer. Cancel it and create a new one.',
    );
  }

  await assertCustomer(companyId, input.customerId);
  const { allocations, allocatedAmount, unallocatedAmount } = await resolveAllocations(
    companyId,
    input.customerId,
    input,
  );

  const updated = await withRetryableTransaction(async (tx) =>
    customerPaymentRepository.updateDraft(tx, {
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
      'CUSTOMER_PAYMENT_NOT_POSTABLE',
      'Only a draft payment can be edited',
    );
  }

  return toPublicPayment(updated);
}

/**
 * Posts the payment: the only place a payment moves a balance.
 *
 * Receivables are locked in id order so two payments touching an overlapping set
 * of invoices can never deadlock.
 */
export async function post(currentUser, id) {
  const { companyId } = currentUser;

  const posted = await withRetryableTransaction(async (tx) => {
    const locked = await customerPaymentRepository.lockForPosting(tx, id, companyId);

    if (!locked) {
      throw ApiError.business(404, 'CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment not found');
    }
    if (locked.status === 'POSTED') {
      throw ApiError.business(
        409,
        'CUSTOMER_PAYMENT_ALREADY_POSTED',
        'This payment has already been posted',
      );
    }
    if (locked.status !== 'DRAFT') {
      throw ApiError.business(
        409,
        'CUSTOMER_PAYMENT_NOT_POSTABLE',
        'Only a draft payment can be posted',
      );
    }

    // Deterministic lock order across every receivable this payment touches.
    const allocations = [...locked.allocations].sort((a, b) =>
      a.customerReceivableId.localeCompare(b.customerReceivableId),
    );

    let allocatedAmount = toDecimal(0);

    for (const allocation of allocations) {
      const receivable = await customerReceivableRepository.lockForUpdate(
        tx,
        allocation.customerReceivableId,
        companyId,
      );

      if (!receivable) {
        throw ApiError.business(404, 'CUSTOMER_RECEIVABLE_NOT_FOUND', 'Receivable not found');
      }
      if (receivable.customerId !== locked.customerId) {
        throw ApiError.business(
          422,
          'INVALID_PAYMENT_ALLOCATION',
          'An invoice in this payment belongs to a different customer',
        );
      }
      if (receivable.salesInvoice && receivable.salesInvoice.status !== 'POSTED') {
        throw ApiError.business(
          422,
          'INVALID_PAYMENT_ALLOCATION',
          `Invoice ${receivable.salesInvoice.invoiceNumber} is not posted`,
        );
      }

      // Re-checked under the lock: another payment may have settled this invoice
      // since the draft was prepared.
      if (isGreaterThan(allocation.amount, receivable.outstandingAmount)) {
        throw ApiError.business(
          422,
          'PAYMENT_EXCEEDS_OUTSTANDING',
          `Only ${toMoneyString(receivable.outstandingAmount, 2)} is outstanding on ${settledLabel(receivable)}, ${toMoneyString(allocation.amount, 2)} was allocated`,
        );
      }

      const paidAmount = add(receivable.paidAmount, allocation.amount);
      // creditAmount must be carried through. Omitting it would recompute
      // outstanding as (original - paid) and silently undo any sales return
      // already credited against this invoice. The supplier payment path does
      // the same with payable.creditAmount.
      const { outstandingAmount, status } = deriveReceivableState({
        originalAmount: receivable.originalAmount,
        creditAmount: receivable.creditAmount,
        paidAmount,
      });

      await customerReceivableRepository.updateAmounts(tx, receivable.id, {
        creditAmount: receivable.creditAmount,
        paidAmount: round(paidAmount, MONEY_DP),
        outstandingAmount,
        status,
      });

      allocatedAmount = add(allocatedAmount, allocation.amount);
    }

    // One ledger entry for the whole payment, for the full amount - including
    // any unallocated remainder, which is real money the customer has paid.
    await customerLedgerRepository.create(tx, {
      companyId,
      customerId: locked.customerId,
      entryType: 'PAYMENT',
      entryDate: locked.paymentDate,
      // A payment reduces what the customer owes us.
      credit: locked.amount,
      debit: 0,
      referenceType: LEDGER_REFERENCE_TYPE.CUSTOMER_PAYMENT,
      referenceId: locked.id,
      receivableId: null,
      description: `Payment ${locked.paymentNumber}`,
      createdById: currentUser.id,
    });

    // The general ledger entry, last and in this same transaction. The split
    // between "settled an invoice" and "customer credit" is the same split the
    // sub-ledger just recorded - it is not recalculated here.
    await glPostingService.recordCustomerPaymentPosted(tx, currentUser, {
      id: locked.id,
      paymentNumber: locked.paymentNumber,
      paymentDate: locked.paymentDate,
      paymentMethod: locked.paymentMethod,
      amount: locked.amount,
      allocatedAmount: round(allocatedAmount, MONEY_DP),
      unallocatedAmount: round(subtract(locked.amount, allocatedAmount), MONEY_DP),
    });

    const updated = await customerPaymentRepository.updateStatus(tx, {
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
        'CUSTOMER_PAYMENT_NOT_POSTABLE',
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

  const existing = await customerPaymentRepository.findByIdAndCompany(id, companyId);
  if (!existing) {
    throw ApiError.business(404, 'CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment not found');
  }
  assertIsDraft(existing);

  const cancelled = await withRetryableTransaction(async (tx) =>
    customerPaymentRepository.updateStatus(tx, {
      id,
      companyId,
      fromStatus: 'DRAFT',
      data: { status: 'CANCELLED', cancelledById: currentUser.id, cancelledAt: new Date() },
    }),
  );

  if (!cancelled) {
    throw ApiError.business(
      409,
      'CUSTOMER_PAYMENT_NOT_POSTABLE',
      'Only a draft payment can be cancelled',
    );
  }

  return toPublicPayment(cancelled);
}

// --- reads -----------------------------------------------------------------

export async function list(currentUser, query) {
  const { page, limit, ...filters } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await customerPaymentRepository.findManyByCompany(currentUser.companyId, {
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
  const payment = await customerPaymentRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!payment) {
    throw ApiError.business(404, 'CUSTOMER_PAYMENT_NOT_FOUND', 'Customer payment not found');
  }
  return toPublicPayment(payment);
}

/** Payment history for one customer. */
export async function listByCustomer(currentUser, customerId, query) {
  const { companyId } = currentUser;

  const customer = await customerRepository.findByIdAndCompany(customerId, companyId);
  if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');

  const { page, limit, status } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await customerPaymentRepository.findManyByCustomer(customerId, companyId, {
    skip,
    take,
    status,
  });

  return {
    payments: items.map(toPublicPayment),
    pagination: buildPagination({ page, limit, total }),
  };
}
