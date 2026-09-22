import { prisma } from '../../config/prisma.js';

// Owns the document_sequences table. Internal: there is no HTTP surface here.

/**
 * Locks this company's counter row for the rest of the transaction.
 * Returns null when the company has no counter for this type and year yet.
 *
 * MUST be called inside a transaction.
 */
export async function lockSequence(tx, companyId, documentType, year) {
  await tx.$queryRaw`
    SELECT id FROM document_sequences
    WHERE "companyId" = ${companyId}
      AND "documentType" = ${documentType}
      AND "year" = ${year}
    FOR UPDATE
  `;

  return tx.documentSequence.findFirst({
    where: { companyId, documentType, year },
    select: { id: true, nextNumber: true },
  });
}

export function createSequence(tx, { companyId, documentType, year, nextNumber }) {
  return tx.documentSequence.create({
    data: { companyId, documentType, year, nextNumber },
    select: { id: true, nextNumber: true },
  });
}

export function setNextNumber(tx, id, nextNumber) {
  return tx.documentSequence.update({ where: { id }, data: { nextNumber }, select: { id: true } });
}
