import { createHash } from 'node:crypto';
import { ApiError } from '../../utils/api-error.js';
import { withTransaction } from '../../config/transaction.js';
import { hasShopPermission } from '../users/shop-permissions.js';
import { toSkipTake, buildPagination } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';
import * as billRepository from './bill.repository.js';
import * as billStorage from './bill-storage.service.js';
import { extractBill, isExtractionConfigured } from './bill-extraction.service.js';
import { DOCUMENT_SCHEMA_BY_DIRECTION } from './bill.validation.js';
import { suggestMatches } from './bill-matching.service.js';
import {
  createPartyFromBill,
  createProductsFromBill,
  resolveWarehouseId,
} from './bill-masters.service.js';
import { recordBillPayment } from './bill-payment.service.js';
import * as purchaseService from '../purchases/purchase.service.js';
import * as salesService from '../sales/sales.service.js';

// IMPORTING A BILL.
//
// The whole feature in one line: a photo becomes a DRAFT that a human confirms.
//
//   UPLOADED -> PROCESSING -> REVIEW -> (human confirms) -> POSTED
//                          \-> FAILED  (the human types it instead)
//
// WHAT THIS FILE DOES NOT DO, and must never do:
//
//   It does not calculate a total. It does not decide a tax rate. It does not
//   write a journal line, touch stock, or move a receivable. When a human
//   confirms a reviewed bill, this calls the EXISTING purchase or sales service
//   with an ordinary payload - the same call the ordinary form makes - and those
//   services do all of it exactly as they always have.
//
//   IN  -> purchases (stock coming in, money owed to a supplier)
//   OUT -> sales     (stock going out, money owed by a customer)
//
// So a bill imported from a photo and a bill typed by hand produce identical
// accounting. There is no second path into the ledger, and no way for this
// feature to drift away from the rules the rest of the system enforces.

const TERMINAL_STATUSES = new Set(['POSTED', 'CANCELLED']);

/** A multipart form sends booleans as text; only an explicit true counts. */
function wantsAllowDuplicate(value) {
  return value === true || value === 'true';
}

/**
 * Serialises concurrent uploads of the same file within one company (M3), so the
 * duplicate check and the insert cannot interleave. A Postgres transaction-scoped
 * advisory lock keyed on (companyId, checksum); it releases when the transaction
 * ends. A key collision only adds harmless extra serialisation, never a wrong
 * result. A plain unique index cannot be used here because a multi-invoice file
 * legitimately produces several live bills that share one checksum.
 */
function lockChecksum(tx, companyId, checksum) {
  // pg_advisory_xact_lock returns void, which $queryRaw cannot deserialize, so
  // the lock is taken inside a subquery and a constant is selected instead.
  return tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${checksum}))) AS _lock`;
}

/**
 * The identity two separate bills for the SAME invoice would share, drawn from
 * the posted (or about-to-be-posted) document (M4). Deliberately NOT the invoice
 * number - that is handled by the document service's own uniqueness and can be
 * blank or misread - but the party, the total and the date, which together pin
 * an invoice down. Both sides come through the same serializer, so the strings
 * are directly comparable.
 */
function postingSignature(direction, doc) {
  if (!doc) return null;
  const partyId = direction === 'IN' ? doc.supplier?.id : doc.customer?.id;
  return `${partyId ?? ''}|${doc.grandTotal ?? ''}|${doc.invoiceDate ?? ''}`;
}

/**
 * The posting fingerprint for a bill about to post (M4): a hash of the file
 * checksum + the posting signature (direction + party + total + date). It is the
 * same signal the pre-check uses, reduced to one string so a UNIQUE index can
 * enforce it atomically. Null when the file has no checksum (a legacy bill),
 * which falls back to the pre-check only.
 */
function computePostingFingerprint(checksum, direction, doc) {
  if (!checksum || !doc) return null;
  const signature = `${checksum}|${direction}|${postingSignature(direction, doc)}`;
  return createHash('sha256').update(signature).digest('hex');
}

/**
 * An already-POSTED bill that is the same invoice as the one about to post (M4).
 *
 * The signal is the same FILE (checksum) AND the same party+total+date. Both are
 * required, so a multi-invoice file (same checksum, different invoices) and a
 * genuine reorder (same figures, different file) are never mistaken for a
 * duplicate. Returns a reference to the existing bill/document, or null.
 */
async function findDuplicatePostedBill(currentUser, { bill, checksum, draftDoc, service }) {
  const candidates = await billRepository.findPostedBillsByChecksum(
    currentUser.companyId,
    checksum,
    bill.direction,
    bill.id,
  );
  if (candidates.length === 0) return null;

  const target = postingSignature(bill.direction, draftDoc);
  for (const candidate of candidates) {
    if (!candidate.postedSourceId) continue;
    let doc;
    try {
      doc = await service.getById(currentUser, candidate.postedSourceId);
    } catch {
      // The posted document is gone; it cannot be a live duplicate.
      continue;
    }
    if (postingSignature(bill.direction, doc) === target) {
      return { billId: candidate.id, documentId: candidate.postedSourceId };
    }
  }
  return null;
}

function toPublicBill(bill) {
  return {
    id: bill.id,
    direction: bill.direction,
    status: bill.status,
    file: {
      name: bill.originalFilename,
      mimeType: bill.mimeType,
      // Bytes, for a human-readable size in the UI. No path, ever.
      size: bill.fileSize,
    },
    extraction: bill.extraction ?? null,
    extractionModel: bill.extractionModel ?? null,
    extractedAt: bill.extractedAt ?? null,
    extractionError: bill.extractionError ?? null,
    reviewedData: bill.reviewedData ?? null,
    // POSTED MEANS POSTED. A source id with no postedAt is a draft an earlier
    // attempt left behind, and calling that "recorded" would tell the shop its
    // books contain something they do not.
    posted:
      bill.postedSourceId && bill.postedAt
        ? {
            sourceType: bill.postedSourceType,
            sourceId: bill.postedSourceId,
            postedAt: bill.postedAt,
            postedBy: bill.postedBy,
          }
        : null,
    /** A draft waiting to be finished, from a confirm that could not post. */
    draft:
      bill.postedSourceId && !bill.postedAt
        ? { sourceType: bill.postedSourceType, sourceId: bill.postedSourceId }
        : null,
    cancelledAt: bill.cancelledAt ?? null,
    cancelReason: bill.cancelReason ?? null,
    uploadedBy: bill.uploadedBy,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
  };
}

/**
 * Takes the file, stores it, and asks the model to read it.
 *
 * The record is written BEFORE the model is called, so a bill is never lost
 * because an extraction timed out - it lands in FAILED with the reason on it,
 * and the shop can review it by hand or try again.
 */
export async function upload(currentUser, file, input) {
  const { companyId } = currentUser;

  if (!file) {
    throw ApiError.business(400, 'NO_FILE', 'Choose a photo or PDF of the bill to upload.');
  }

  const stored = await billStorage.storeBill(companyId, file);
  const allowDuplicate = wantsAllowDuplicate(input.allowDuplicate);

  // DUPLICATE FILE DETECTION (M3), made concurrency-safe.
  //
  // The same bytes already uploaded (and not since failed or cancelled) means a
  // second extraction job would waste the provider's credits and leave two
  // drafts of one bill. The check and the insert run inside one transaction
  // holding an advisory lock on (companyId, checksum), so two simultaneous
  // identical uploads are serialised and the second sees the first's row. Unless
  // the uploader deliberately asks to keep both, it is refused with a reference
  // to what is already there. On any failure the stored file is removed so no
  // orphan is left behind.
  let bill;
  try {
    bill = await withTransaction(async (tx) => {
      await lockChecksum(tx, companyId, stored.checksum);

      if (!allowDuplicate) {
        const existing = await billRepository.findLiveBillByChecksum(companyId, stored.checksum, tx);
        if (existing) {
          throw new ApiError(
            409,
            'This looks like a bill you have already uploaded. Open the existing one, or upload again to keep both.',
            [
              {
                field: 'file',
                message: `Already uploaded (currently ${existing.status.toLowerCase()}).`,
                existingBillId: existing.id,
                status: existing.status,
              },
            ],
            'BILL_DUPLICATE_UPLOAD',
          );
        }
      }

      return billRepository.create(
        {
          companyId,
          direction: input.direction,
          status: 'PROCESSING',
          originalFilename: stored.originalFilename,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          storageKey: stored.storageKey,
          checksum: stored.checksum,
          uploadedById: currentUser.id,
        },
        tx,
      );
    });
  } catch (error) {
    // A rejected duplicate or a failed insert leaves no row pointing at the file,
    // so remove it rather than orphan it on storage.
    await billStorage.deleteBill(stored.storageKey).catch(() => {});
    throw error;
  }

  // Not configured is not a failure of this bill - it is a failure of the
  // server's setup, and the shop can still enter the bill by hand.
  if (!isExtractionConfigured()) {
    const updated = await billRepository.update(bill.id, {
      status: 'FAILED',
      extractionError:
        'Automatic bill reading is not set up on this server. Enter the bill manually.',
    });
    return toPublicBill(updated);
  }

  try {
    const result = await extractBill(file.buffer, stored.mimeType, input.direction);
    const [first, ...others] = result.documents ?? [result];

    const updated = await billRepository.update(bill.id, {
      status: 'REVIEW',
      // Verbatim, for audit. Kept even after the human corrects it, so what the
      // model said and what the human confirmed can always be compared.
      extraction: first.raw,
      extractionModel: first.model,
      extractedAt: new Date(),
      extractionError: null,
      // The validated, shaped version - the starting point for the review form.
      reviewedData: first.data,
    });

    // One file, several invoices (e.g. one per page): each becomes its own bill
    // to review and post. Each gets its own copy of the file, since a stored
    // file belongs to exactly one bill (storageKey is unique).
    const otherBills = [];
    for (const doc of others) {
      otherBills.push(await createSiblingBill(currentUser, file, input.direction, doc));
    }

    return { ...toPublicBill(updated), otherBills };
  } catch (error) {
    logger.warn({ billId: bill.id, err: error.message }, 'Bill extraction failed');

    const updated = await billRepository.update(bill.id, {
      status: 'FAILED',
      extractionError: error.message ?? 'The bill could not be read.',
    });

    return toPublicBill(updated);
  }
}

async function createSiblingBill(currentUser, file, direction, doc) {
  const stored = await billStorage.storeBill(currentUser.companyId, file);
  try {
    const sibling = await billRepository.create({
      companyId: currentUser.companyId,
      direction,
      status: 'REVIEW',
      originalFilename: stored.originalFilename,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      storageKey: stored.storageKey,
      checksum: stored.checksum,
      uploadedById: currentUser.id,
      extraction: doc.raw,
      extractionModel: doc.model,
      extractedAt: new Date(),
      reviewedData: doc.data,
    });
    return toPublicBill(sibling);
  } catch (error) {
    await billStorage.deleteBill(stored.storageKey).catch(() => {});
    throw error;
  }
}

/** Re-reads a bill that failed, or that the shop wants read again. */
export async function retryExtraction(currentUser, id) {
  const { companyId } = currentUser;

  const bill = await billRepository.findByIdAndCompanyWithKey(id, companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');

  if (TERMINAL_STATUSES.has(bill.status)) {
    throw ApiError.business(
      409,
      'BILL_NOT_RETRYABLE',
      bill.status === 'POSTED'
        ? 'This bill has already been recorded.'
        : 'This bill was cancelled.',
    );
  }

  const buffer = await billStorage.readBill(companyId, bill.storageKey);

  try {
    const result = await extractBill(buffer, bill.mimeType, bill.direction);
    // A bill split out of a multi-invoice file re-reads as its own invoice.
    const documents = result.documents ?? [result];
    const index = Number(bill.extraction?.documentIndex ?? 0);
    const doc = documents.find((d) => d.raw?.documentIndex === index) ?? documents[0];

    return toPublicBill(
      await billRepository.update(bill.id, {
        status: 'REVIEW',
        extraction: doc.raw,
        extractionModel: doc.model,
        extractedAt: new Date(),
        extractionError: null,
        reviewedData: doc.data,
      }),
    );
  } catch (error) {
    return toPublicBill(
      await billRepository.update(bill.id, {
        status: 'FAILED',
        extractionError: error.message ?? 'The bill could not be read.',
      }),
    );
  }
}

/**
 * Saves the human's corrections without posting anything.
 *
 * Lets somebody fix a bill now and post it later. The model's original output is
 * untouched - only `reviewedData` moves.
 */
export async function saveReview(currentUser, id, reviewedData) {
  const { companyId } = currentUser;

  const bill = await billRepository.findByIdAndCompany(id, companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');

  if (TERMINAL_STATUSES.has(bill.status)) {
    throw ApiError.business(
      409,
      'BILL_NOT_EDITABLE',
      bill.status === 'POSTED'
        ? 'This bill has already been recorded and cannot be changed.'
        : 'This bill was cancelled.',
    );
  }

  return toPublicBill(
    await billRepository.update(bill.id, { status: 'REVIEW', reviewedData }),
  );
}

/**
 * THE BRIDGE. A confirmed bill becomes a real accounting document.
 *
 * `document` is an ordinary purchase or sales payload - the same shape the
 * ordinary form posts, validated by the same Zod schema, carrying real product,
 * party and warehouse ids that the HUMAN chose during review. The model's text
 * ("ABC Traders", "sugar 1kg") never becomes an id on its own; somebody matched
 * it to a real record, and that is the point of the review step.
 *
 * Nothing about the accounting happens here. createDraft does the tax, the
 * totals and the document number; post() does the stock, the sub-ledger and the
 * journal. This function's only job is to call them and remember the result.
 */
/**
 * The draft a previous confirm created but could not post, if it is still there.
 *
 * Returns null whenever there is any doubt - no record, the document was
 * cancelled, or it is no longer a draft - so the ordinary path creates a fresh
 * one. Being wrong in that direction costs an extra draft; being wrong the other
 * way would post something the shop did not just review.
 */
async function findRecordedDraft(currentUser, bill, service) {
  if (!bill.postedSourceId || bill.postedAt) return null;

  try {
    const document = await service.getById(currentUser, bill.postedSourceId);
    return document?.status === 'DRAFT' ? document : null;
  } catch {
    // Deleted, or belonging to something else entirely. Start again.
    return null;
  }
}

/**
 * What this bill looks like it refers to in the shop's own records.
 *
 * Read-only and advisory: it pre-fills the review screen so a regular supplier
 * and familiar products need no dropdown work, and stays silent when it is not
 * sure. Nothing here decides anything - the person reviewing does.
 */
export async function suggestions(currentUser, id) {
  const { companyId } = currentUser;

  const bill = await billRepository.findByIdAndCompany(id, companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');

  return suggestMatches(companyId, bill.direction, bill.reviewedData ?? {});
}

export async function confirm(
  currentUser,
  id,
  {
    document,
    postImmediately = true,
    newParty = null,
    newProducts = [],
    newWarehouse = null,
    payment = null,
    allowDuplicate = false,
  },
) {
  const { companyId } = currentUser;

  const bill = await billRepository.findByIdAndCompany(id, companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');
  const { checksum } = (await billRepository.findChecksum(id, companyId)) ?? {};

  if (bill.status === 'POSTED') {
    throw ApiError.business(
      409,
      'BILL_ALREADY_POSTED',
      'This bill has already been recorded. Open the document it created rather than recording it twice.',
    );
  }
  if (bill.status === 'CANCELLED') {
    throw ApiError.business(409, 'BILL_CANCELLED', 'This bill was cancelled.');
  }

  const isPurchase = bill.direction === 'IN';
  const service = isPurchase ? purchaseService : salesService;

  // Saving a scanned bill records a real purchase or sale, so it also needs the
  // permission the typed version would.
  if (!hasShopPermission(currentUser, isPurchase ? 'PURCHASES_MANAGE' : 'SALES_POST')) {
    throw ApiError.forbidden(
      isPurchase ? 'You are not allowed to record purchases.' : 'You are not allowed to complete sales.',
    );
  }
  const sourceType = isPurchase ? 'PURCHASE' : 'SALES_INVOICE';

  // THE SAME SCHEMA THE ORDINARY FORM USES, chosen by the bill's own direction.
  // A bill that arrived as a photograph gets nothing past validation that a
  // typed one could not.
  // ADDING WHAT THE SHOP DOES NOT HAVE YET, before anything is validated.
  //
  // Each one goes through the ordinary supplier/customer/product service, so a
  // record created from a bill is indistinguishable from a typed one - same
  // validation, same duplicate checks. The ids then fill the gaps in the
  // document, which still faces the full schema below.
  const documentToPost = { ...document };

  if (newParty) {
    const partyId = await createPartyFromBill(currentUser, bill.direction, newParty);
    if (isPurchase) documentToPost.supplierId = partyId;
    else documentToPost.customerId = partyId;
  }

  if (newProducts.length > 0) {
    const createdProductIds = await createProductsFromBill(currentUser, newProducts);
    documentToPost.items = (documentToPost.items ?? []).map((item, index) =>
      createdProductIds.has(index) ? { ...item, productId: createdProductIds.get(index) } : item,
    );
  }

  // WHERE THE STOCK GOES. Posting needs a store, but a shop with exactly one
  // should never be asked to say so, and a shop with none is offered one on the
  // review screen. A shop with several is left to choose: stock in the wrong
  // godown is an error only the shop can prevent, so the schema below asks.
  if (!documentToPost.warehouseId) {
    const warehouseId = await resolveWarehouseId(currentUser, newWarehouse);
    if (warehouseId) documentToPost.warehouseId = warehouseId;
  }

  const schema = DOCUMENT_SCHEMA_BY_DIRECTION[bill.direction];
  const parsed = schema.safeParse(documentToPost);

  if (!parsed.success) {
    throw ApiError.badRequest(
      'Validation failed',
      parsed.error.issues.map((issue) => ({
        field: `document.${issue.path.join('.')}`,
        message: issue.message,
      })),
    );
  }

  // A DRAFT LEFT BEHIND BY AN EARLIER ATTEMPT IS FINISHED, NOT DUPLICATED.
  //
  // When a confirm creates the draft and then fails at posting, the draft stays
  // and its id is recorded below. Creating a second one on the retry would be
  // refused anyway - a supplier cannot have two bills with one invoice number -
  // so the shop would be left with a bill it could never record.
  const existingDraft = await findRecordedDraft(currentUser, bill, service);

  // The existing service. Same validation, same calculators, same everything.
  const draft = existingDraft ?? (await service.createDraft(currentUser, parsed.data));

  // DUPLICATE POSTING ACROSS SEPARATE BILL RECORDS (M4).
  //
  // The document service already refuses a second purchase with the same
  // supplier + invoice number (and a second sale with the same invoice number).
  // This catches what slips past that: the SAME file posted again under a blank
  // or different invoice number. A match needs the same file (checksum) AND the
  // same party, total and date, so a multi-invoice file and a genuine reorder
  // are never caught. The reviewer can confirm again with allowDuplicate to keep
  // both. Only matters when actually posting.
  if (postImmediately && !allowDuplicate) {
    const duplicate = await findDuplicatePostedBill(currentUser, {
      bill,
      checksum,
      draftDoc: draft,
      service,
    });
    if (duplicate) {
      // Remember the draft so an override retry finishes it rather than making a
      // second one - exactly as the post-failure path below does.
      await billRepository.update(bill.id, {
        status: 'REVIEW',
        postedSourceType: sourceType,
        postedSourceId: draft.id,
      });
      throw new ApiError(
        409,
        'This bill looks like one already recorded. Open that document, or confirm again to record it anyway.',
        [
          {
            field: 'document',
            message: 'Same file, party, total and date as an existing posted bill.',
            existingBillId: duplicate.billId,
            documentId: duplicate.documentId,
          },
        ],
        'BILL_DUPLICATE_POSTING',
      );
    }

    // ATOMIC BACKSTOP for the concurrent case the read-only pre-check cannot
    // see: two confirmations of the same invoice from different bill records can
    // both pass the check above, then race to post. Reserving the posting
    // fingerprint makes the DB's unique index reject the loser before it posts,
    // so at most one document is ever created.
    const fingerprint = computePostingFingerprint(checksum, bill.direction, draft);
    if (fingerprint) {
      try {
        await billRepository.reservePostingFingerprint(bill.id, fingerprint);
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        const holder = await billRepository.findByPostingFingerprint(companyId, fingerprint);
        await billRepository.update(bill.id, {
          status: 'REVIEW',
          postedSourceType: sourceType,
          postedSourceId: draft.id,
        });
        throw new ApiError(
          409,
          'This bill looks like one already recorded. Open that document, or confirm again to record it anyway.',
          [
            {
              field: 'document',
              message: 'Same file, party, total and date as an existing posted bill.',
              existingBillId: holder?.id,
              documentId: holder?.postedSourceId,
            },
          ],
          'BILL_DUPLICATE_POSTING',
        );
      }
    }
  }

  let posted = draft;
  if (postImmediately) {
    try {
      posted = await service.post(currentUser, draft.id);
    } catch (error) {
      // The draft exists and is correct; only the posting was refused - a closed
      // period, an expired subscription, a database that took too long. Record
      // where the draft went so the retry finishes it rather than starting
      // again, and let the real reason surface.
      await billRepository.update(bill.id, {
        status: 'REVIEW',
        reviewedData: documentToPost,
        postedSourceType: sourceType,
        postedSourceId: draft.id,
        extractionError: null,
      });

      throw error;
    }
  }

  // WHAT WAS PAID ON THE SPOT, if the bill says any was.
  //
  // Deliberately AFTER posting and outside its failure path: the document is in
  // the books and correct, and a payment that cannot be recorded must not undo
  // it or pretend it did not happen. The shop is told instead, and can add the
  // receipt from Money Received - one missing payment, not a lost bill.
  let recordedPayment = null;
  let paymentError = null;

  if (postImmediately && payment?.amount) {
    try {
      recordedPayment = await recordBillPayment(currentUser, {
        direction: bill.direction,
        documentId: draft.id,
        partyId: isPurchase ? parsed.data.supplierId : parsed.data.customerId,
        amount: payment.amount,
        method: payment.method,
        paymentDate: payment.date ?? documentToPost.invoiceDate,
      });
    } catch (error) {
      paymentError = error.message ?? 'The payment could not be recorded.';
      logger.warn({ billId: bill.id, err: paymentError }, 'Bill payment could not be recorded');
    }
  }

  const updated = await billRepository.update(bill.id, {
    status: 'POSTED',
    reviewedData: document,
    postedSourceType: sourceType,
    postedSourceId: draft.id,
    postedAt: new Date(),
    postedById: currentUser.id,
  });

  return {
    bill: toPublicBill(updated),
    document: posted,
    /** The receipt or payment recorded alongside, when the bill showed one. */
    payment: recordedPayment,
    /** Said plainly when the bill posted but its payment did not. */
    paymentError,
  };
}

/** Abandons a bill. The file and the extraction stay, for audit. */
export async function cancel(currentUser, id, reason) {
  const { companyId } = currentUser;

  const bill = await billRepository.findByIdAndCompany(id, companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');

  if (bill.status === 'POSTED') {
    throw ApiError.business(
      409,
      'BILL_ALREADY_POSTED',
      'This bill was already recorded. Cancel or reverse the document it created instead.',
    );
  }
  if (bill.status === 'CANCELLED') return toPublicBill(bill);

  return toPublicBill(
    await billRepository.update(bill.id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    }),
  );
}

export async function list(currentUser, query = {}) {
  const { page, limit, status, direction, fromDate, toDate } = query;
  const { skip, take } = toSkipTake({ page, limit });

  const { items, total } = await billRepository.findMany({
    companyId: currentUser.companyId,
    skip,
    take,
    status,
    direction,
    fromDate,
    toDate,
  });

  return { bills: items.map(toPublicBill), pagination: buildPagination({ page, limit, total }) };
}

export async function getById(currentUser, id) {
  const bill = await billRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');
  return toPublicBill(bill);
}

/**
 * The stored file itself, for the review screen to show beside the form.
 *
 * Streamed through the API rather than served from a static folder, so that
 * reading a bill requires a valid token and the right company - a static folder
 * would make every uploaded bill public to anyone who guessed a filename.
 */
export async function getFile(currentUser, id) {
  const bill = await billRepository.findByIdAndCompanyWithKey(id, currentUser.companyId);
  if (!bill) throw ApiError.business(404, 'BILL_NOT_FOUND', 'Bill not found');

  const buffer = await billStorage.readBill(currentUser.companyId, bill.storageKey);
  return { buffer, mimeType: bill.mimeType, filename: bill.originalFilename };
}

export async function summary(currentUser) {
  const rows = await billRepository.countByStatus(currentUser.companyId);
  const counts = { UPLOADED: 0, PROCESSING: 0, REVIEW: 0, POSTED: 0, FAILED: 0, CANCELLED: 0 };
  for (const row of rows) counts[row.status] = row._count._all;

  return {
    counts,
    /** What the shop actually has to act on. */
    awaitingReview: counts.REVIEW + counts.FAILED,
    extractionConfigured: isExtractionConfigured(),
  };
}

export { toPublicBill };
