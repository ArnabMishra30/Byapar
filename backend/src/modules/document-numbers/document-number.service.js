import * as documentNumberRepository from './document-number.repository.js';

// Generates our own document numbers, e.g. PUR-2026-000001.
//
// Never COUNT(*) + 1: two concurrent requests would read the same count and
// produce the same number. Instead a per (company, type, year) counter row is
// locked FOR UPDATE, so the second request waits for the first to commit.
//
// If two requests race to create the counter itself, the unique constraint lets
// one win and the caller's withRetryableTransaction re-runs the loser.

export const DOCUMENT_TYPE = {
  PURCHASE: 'PURCHASE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  SALES_INVOICE: 'SALES_INVOICE',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  SALES_RETURN: 'SALES_RETURN',
  JOURNAL_ENTRY: 'JOURNAL_ENTRY',
  EXPENSE: 'EXPENSE',
};

/**
 * Takes the next number for a company, inside the caller's transaction.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ companyId: string, documentType: string, prefix: string, date: Date }} params
 * @returns {Promise<string>} e.g. "PUR-2026-000001"
 */
export async function nextDocumentNumber(tx, { companyId, documentType, prefix, date }) {
  const year = date.getUTCFullYear();

  const existing = await documentNumberRepository.lockSequence(tx, companyId, documentType, year);

  let number;
  if (existing) {
    number = existing.nextNumber;
    await documentNumberRepository.setNextNumber(tx, existing.id, number + 1);
  } else {
    number = 1;
    await documentNumberRepository.createSequence(tx, {
      companyId,
      documentType,
      year,
      nextNumber: 2,
    });
  }

  return `${prefix}-${year}-${String(number).padStart(6, '0')}`;
}
