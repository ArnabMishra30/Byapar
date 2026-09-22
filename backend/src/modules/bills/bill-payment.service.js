import * as customerPaymentService from '../customer-payments/customer-payment.service.js';
import * as supplierPaymentService from '../supplier-payments/supplier-payment.service.js';
import { createCustomerPaymentSchema } from '../customer-payments/customer-payment.validation.js';
import { createSupplierPaymentSchema } from '../supplier-payments/supplier-payment.validation.js';
import * as receivableRepository from '../customer-receivables/customer-receivable.repository.js';
import * as payableRepository from '../supplier-payables/supplier-payable.repository.js';
import { toDecimal, toMoneyString } from '../../utils/money.js';
import { ApiError } from '../../utils/api-error.js';

// WHAT WAS PAID ON THE SPOT.
//
// A handwritten bill usually ends "Total 1,825 / Paid 1,000 / Balance 825", and
// a shop that records only the 1,825 has a credit book that disagrees with the
// cash drawer. So the amount paid travels with the bill and becomes a real
// payment - a receipt from a customer, or a payment to a supplier.
//
// THROUGH THE ORDINARY PAYMENT SERVICES, and their own validation. Nothing here
// touches a ledger, allocates by hand, or invents a second way to settle a bill:
// the money lands exactly where it would have if somebody had opened Money
// Received and typed it in.

/** Payment methods both sides accept. CASH is what a paper bill almost always means. */
export const BILL_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER'];

/**
 * Records the money that changed hands when this bill was recorded.
 *
 * The payment is allocated against the document just posted, up to what it
 * actually owes; anything beyond that stays unallocated, which is exactly what
 * an advance is. A bill paid in full leaves nothing outstanding.
 *
 * @param {{ direction: 'IN'|'OUT', documentId: string, partyId: string,
 *           amount: string, method?: string, paymentDate: string }} input
 * @returns {Promise<object|null>} the posted payment, or null when there is nothing to record
 */
export async function recordBillPayment(currentUser, input) {
  const { companyId } = currentUser;
  const { direction, documentId, partyId, amount, method = 'CASH', paymentDate } = input;

  const paid = toDecimal(amount ?? 0);
  if (!paid.greaterThan(0)) return null;

  const isPurchase = direction === 'IN';

  // What this document still owes, so the allocation cannot exceed it.
  const owed = isPurchase
    ? await payableRepository.findByPurchase(documentId, companyId)
    : await receivableRepository.findBySalesInvoice(documentId, companyId);

  const outstanding = owed ? toDecimal(owed.outstandingAmount) : toDecimal(0);
  const allocated = paid.greaterThan(outstanding) ? outstanding : paid;

  const allocations =
    owed && allocated.greaterThan(0)
      ? [
          isPurchase
            ? { payableId: owed.id, amount: toMoneyString(allocated) }
            : { receivableId: owed.id, amount: toMoneyString(allocated) },
        ]
      : [];

  const service = isPurchase ? supplierPaymentService : customerPaymentService;
  const schema = isPurchase ? createSupplierPaymentSchema : createCustomerPaymentSchema;

  const parsed = schema.safeParse({
    ...(isPurchase ? { supplierId: partyId } : { customerId: partyId }),
    paymentDate,
    amount: toMoneyString(paid),
    paymentMethod: method,
    notes: 'Recorded from an imported bill',
    allocations,
  });

  if (!parsed.success) {
    throw ApiError.badRequest(
      'Payment validation failed',
      parsed.error.issues.map((issue) => ({
        field: `payment.${issue.path.join('.')}`,
        message: issue.message,
      })),
    );
  }

  const draft = await service.createDraft(currentUser, parsed.data);
  return service.post(currentUser, draft.id);
}
