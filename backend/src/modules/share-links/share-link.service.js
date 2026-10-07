import { randomBytes } from 'node:crypto';
import { ownRecordsFilter, hasShopPermission } from '../users/shop-permissions.js';
import { ApiError } from '../../utils/api-error.js';
import { toMoneyString } from '../../utils/money.js';
import * as shareLinkRepository from './share-link.repository.js';
import * as statementService from '../credit/statement.service.js';

// SHARE LINKS: the shop sends a customer (or supplier) a link, and they see
// their bill and their account - a log book - on their phone, with no login.
//
//   INVOICE           one sales invoice; with includeAccount, also the customer's
//                     whole log book, each of whose invoices can be opened.
//   CUSTOMER_ACCOUNT  a customer's log book: invoices, receipts, returns, balance.
//   SUPPLIER_ACCOUNT  the same for a supplier, from the shop's side.
//
// WHAT KEEPS IT SAFE.
//   - The token is 24 random bytes: it cannot be guessed or enumerated.
//   - A link reads exactly one invoice or one party of one company. Every read
//     below is scoped by that company AND that party; an invoice of some other
//     customer is "not found" even inside a valid link.
//   - Read-only: nothing on the public side writes anything except the view
//     counter.
//   - Only what the recipient should see. No cost, margin, stock, staff names
//     or internal ids beyond the invoice ids needed to open an invoice.
//   - A link works until the shop stops sharing it. A stopped link and a link
//     that never existed get the same answer.
//
// The figures are not recomputed here: the log book is the existing customer /
// supplier statement, and the invoice and its paid/due come from the invoice
// and its receivable.

const money = (value) => toMoneyString(value ?? 0, 2);
const dateOnly = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

const gone = () =>
  ApiError.business(404, 'SHARE_LINK_NOT_FOUND', 'This link is no longer available. Please ask the shop for a new one.');

export function toPublicLinkForOwner(link) {
  return {
    id: link.id,
    kind: link.kind,
    token: link.token,
    salesInvoiceId: link.salesInvoiceId,
    customerId: link.customerId,
    supplierId: link.supplierId,
    includeAccount: link.includeAccount,
    isActive: !link.revokedAt,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
    viewCount: link.viewCount,
    firstViewedAt: link.firstViewedAt,
    lastViewedAt: link.lastViewedAt,
  };
}

// --- owner side ----------------------------------------------------------------

/**
 * Creates a link, or returns the one already active for the same thing.
 * Sharing the same invoice twice gives the same link, so the customer never
 * ends up with two that the shop has to remember to stop.
 */
export async function create(currentUser, input) {
  const { companyId, id: userId } = currentUser;
  const target = { kind: input.kind, salesInvoiceId: null, customerId: null, supplierId: null, includeAccount: false };

  if (input.kind === 'INVOICE') {
    const invoice = await shareLinkRepository.findInvoice(companyId, input.salesInvoiceId);
    if (!invoice) throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
    // A biller who sees only their own bills can share only those.
    const own = ownRecordsFilter(currentUser);
    if (own && invoice.createdById !== own) {
      throw ApiError.business(404, 'SALE_NOT_FOUND', 'Sales invoice not found');
    }
    // The full account shows every bill of that customer, not just theirs.
    if (input.includeAccount && !hasShopPermission(currentUser, 'REPORTS_VIEW')) {
      throw ApiError.forbidden('You are not allowed to share a customer full account.');
    }
    if (invoice.status === 'DRAFT') {
      throw ApiError.business(409, 'SALE_NOT_POSTED', 'Save (post) the invoice before sharing it.');
    }
    target.salesInvoiceId = invoice.id;
    target.customerId = invoice.customerId;
    target.includeAccount = Boolean(input.includeAccount);
  } else if (!hasShopPermission(currentUser, 'REPORTS_VIEW')) {
    throw ApiError.forbidden('You are not allowed to share account statements.');
  } else if (input.kind === 'CUSTOMER_ACCOUNT') {
    const customer = await shareLinkRepository.findCustomerName(companyId, input.customerId);
    if (!customer) throw ApiError.business(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    target.customerId = customer.id;
  } else {
    const supplier = await shareLinkRepository.findSupplierName(companyId, input.supplierId);
    if (!supplier) throw ApiError.business(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
    target.supplierId = supplier.id;
  }

  const existing = await shareLinkRepository.findActive(companyId, target);
  if (existing) return { link: toPublicLinkForOwner(existing), created: false };

  const link = await shareLinkRepository.create({
    ...target,
    companyId,
    token: randomBytes(24).toString('base64url'),
    createdById: userId,
  });
  return { link: toPublicLinkForOwner(link), created: true };
}

export async function list(currentUser, query) {
  const links = await shareLinkRepository.findManyByCompany(currentUser.companyId, query);
  return links.map(toPublicLinkForOwner);
}

/** Stop sharing. Idempotent; the link stops working immediately. */
export async function revoke(currentUser, id) {
  const existing = await shareLinkRepository.findByIdAndCompany(id, currentUser.companyId);
  if (!existing) throw ApiError.business(404, 'SHARE_LINK_NOT_FOUND', 'Share link not found');
  const link = await shareLinkRepository.revoke(id, currentUser.companyId, currentUser.id);
  return toPublicLinkForOwner(link);
}

// --- what the recipient sees -------------------------------------------------------

async function activeLink(token) {
  const link = await shareLinkRepository.findByToken(token);
  if (!link || link.revokedAt) throw gone();
  return link;
}

function toPublicInvoice(invoice, receivable) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: dateOnly(invoice.invoiceDate),
    dueDate: dateOnly(invoice.dueDate),
    status: invoice.status,
    customerName: invoice.customerNameSnapshot,
    customerGstin: invoice.buyerGstin ?? null,
    items: invoice.items.map((item) => ({
      lineNumber: item.lineNumber,
      name: item.productNameSnapshot,
      unit: item.unitNameSnapshot,
      hsn: item.hsnCodeSnapshot,
      quantity: toMoneyString(item.quantity, 3),
      unitPrice: money(item.unitPrice),
      discount: money(item.discountAmount),
      taxRate: item.taxRateSnapshot == null ? null : toMoneyString(item.taxRateSnapshot, 2),
      tax: money(item.taxAmount),
      total: money(item.lineTotal),
      isFree: Boolean(item.isFree),
      // A combo's contents, so the customer sees what the pack held.
      contains: (item.components ?? []).map((c) => ({ name: c.productNameSnapshot, quantity: toMoneyString(c.quantityPerUnit, 3) })),
    })),
    subtotal: money(invoice.subtotal),
    discountTotal: money(invoice.discountTotal),
    taxTotal: money(invoice.taxTotal),
    taxBreakup: {
      cgst: money(invoice.cgstTotal),
      sgst: money(invoice.sgstTotal),
      igst: money(invoice.igstTotal),
      cess: money(invoice.cessTotal),
    },
    grandTotal: money(invoice.grandTotal),
    // From the invoice's receivable: what has been paid against it and what is
    // still due. A cancelled invoice has none, and nothing is due on it.
    paid: receivable ? money(receivable.paidAmount) : null,
    returned: receivable ? money(receivable.creditAmount) : null,
    due: receivable ? money(receivable.outstandingAmount) : null,
    notes: invoice.notes ?? null,
  };
}

/** The log book, from the existing statement, with internal fields left out. */
async function toPublicAccount(companyId, side, partyId) {
  const fakeUser = { companyId };
  const statement =
    side === 'CUSTOMER'
      ? await statementService.getCustomerStatement(fakeUser, partyId, {})
      : await statementService.getSupplierStatement(fakeUser, partyId, {});

  return {
    side,
    partyName: statement.party.name,
    lines: statement.lines.map((line) => ({
      date: line.date,
      label: line.label,
      documentNumber: line.documentNumber,
      // Only a customer's own invoices can be opened from the log book.
      invoiceId: side === 'CUSTOMER' && line.type === 'SALE' ? line.documentId : null,
      reference: line.reference,
      dueDate: line.dueDate,
      debit: line.debit,
      credit: line.credit,
      balance: line.balance,
    })),
    closingBalance: statement.closingBalance,
    totals: {
      totalDebit: statement.totals.totalDebit,
      totalCredit: statement.totals.totalCredit,
      entryCount: statement.totals.entryCount,
    },
  };
}

/**
 * Everything the link shows, for the public page.
 * Records one view (seen-tracking for the shop).
 */
export async function view(token) {
  const link = await activeLink(token);
  const { companyId } = link;

  const shop = await shareLinkRepository.findShop(companyId);

  let invoice = null;
  if (link.kind === 'INVOICE') {
    const row = await shareLinkRepository.findInvoice(companyId, link.salesInvoiceId);
    if (!row) throw gone();
    invoice = toPublicInvoice(row, await shareLinkRepository.findReceivable(companyId, row.id));
  }

  let account = null;
  if (link.kind === 'CUSTOMER_ACCOUNT' || (link.kind === 'INVOICE' && link.includeAccount)) {
    account = await toPublicAccount(companyId, 'CUSTOMER', link.customerId);
  } else if (link.kind === 'SUPPLIER_ACCOUNT') {
    account = await toPublicAccount(companyId, 'SUPPLIER', link.supplierId);
  }

  await shareLinkRepository.recordView(link.id, link.firstViewedAt);

  return {
    kind: link.kind,
    shop: {
      name: shop?.name ?? '',
      legalName: shop?.legalName ?? null,
      phone: shop?.phone ?? null,
      email: shop?.email ?? null,
      city: shop?.city ?? null,
      gstin: shop?.gstin ?? null,
    },
    invoice,
    account,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * One invoice opened from inside a customer log book. Allowed only when the
 * link shows that customer's account, and only for that customer's invoices.
 */
export async function viewInvoice(token, salesInvoiceId) {
  const link = await activeLink(token);
  const showsAccount = link.kind === 'CUSTOMER_ACCOUNT' || (link.kind === 'INVOICE' && link.includeAccount);
  if (!showsAccount && link.salesInvoiceId !== salesInvoiceId) throw gone();

  const row = await shareLinkRepository.findInvoice(link.companyId, salesInvoiceId, link.customerId);
  if (!row || row.status === 'DRAFT') throw gone();

  return toPublicInvoice(row, await shareLinkRepository.findReceivable(link.companyId, row.id));
}
