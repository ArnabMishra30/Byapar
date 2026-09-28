import {
  salesApi,
  purchasesApi,
  registersApi,
  type ListParams,
  type ListResult,
  type RegisterParams,
} from "@/lib/api";
import type { Capability } from "@/lib/permissions";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { fromPurchaseRegister, fromSalesRegister, type RegisterPage } from "./doc-helpers";

/**
 * The lifecycle both documents share, typed loosely on purpose.
 *
 * A sale carries a customer and a purchase carries a supplier, so their concrete
 * types do not unify. The shared screens only ever read fields by name, so they
 * work against this common shape and cast where they need a specific field.
 */
export interface DocApi {
  list: (p?: ListParams) => Promise<ListResult<Record<string, unknown>>>;
  get: (id: string) => Promise<Record<string, unknown>>;
  create: (body: unknown) => Promise<Record<string, unknown>>;
  update: (id: string, body: unknown) => Promise<Record<string, unknown>>;
  post: (id: string, body?: unknown) => Promise<Record<string, unknown>>;
  cancel: (id: string) => Promise<Record<string, unknown>>;
}

/**
 * Sales and purchases are mirror images.
 *
 * Same lifecycle (draft -> post -> immutable), same line items, same totals,
 * same permission split. Only the party, the price field and the wording change.
 * One configuration object rather than two near-identical feature folders.
 */
export type DocKind = "sale" | "purchase";

export interface DocConfig {
  kind: DocKind;
  /** "Sale" / "Purchase" - used inside sentences. */
  noun: string;
  /** "Invoices" / "Purchase bills" - the list page. */
  listTitle: string;
  listDescription: string;
  newTitle: string;
  editTitle: string;

  homeHref: string;
  listHref: string;
  newHref: string;
  detailHref: (id: string) => string;
  editHref: (id: string) => string;
  /** Where "record a payment" goes, with the party pre-filled. */
  paymentHref: (partyId: string) => string;
  paymentLabel: string;
  paymentCapability: Capability;
  /** Where "return items" goes, with this document pre-selected. */
  returnHref: (docId: string) => string;
  returnCapability: Capability;
  /** "?customerId" / "?supplierId" - the prefill a new document accepts. */
  prefillParam: "customerId" | "supplierId";

  /** "customer" or "supplier" - which party this document names. */
  partyKind: "customer" | "supplier";
  partyLabel: string;
  /** The field the API expects for the party. */
  partyField: "customerId" | "supplierId";

  /** Sales price the goods leave at; purchases the cost they arrive at. */
  amountField: "unitPrice" | "unitCost";
  amountLabel: string;

  /** A purchase carries the SUPPLIER's own bill number; a sale is numbered by us. */
  requiresSupplierInvoiceNumber: boolean;

  numberOf: (row: Record<string, unknown>) => string;
  dateField: string;

  draftCapability: Capability;
  postCapability: Capability;

  /** What a posted document is called, and how it is undone. */
  completedNote: string;

  emptyTitle: string;
  emptyDescription: string;

  api: DocApi;
  /** Posted documents with paid / due, normalised to one row shape. */
  register: (p: RegisterParams) => Promise<RegisterPage>;
}

export const DOC_CONFIG: Record<DocKind, DocConfig> = {
  sale: {
    kind: "sale",
    noun: "Sale",
    listTitle: "Invoices",
    listDescription: "Bills you gave customers, and what they still owe.",
    newTitle: "New sale",
    editTitle: "Edit sale draft",
    homeHref: ROUTES.sales,
    listHref: ROUTES.salesInvoices,
    newHref: ROUTES.newSale,
    detailHref: (id) => DETAIL_ROUTES.sale(id),
    editHref: (id) => `${DETAIL_ROUTES.sale(id)}/edit`,
    paymentHref: (partyId) => `${ROUTES.moneyReceived}?customerId=${encodeURIComponent(partyId)}`,
    paymentLabel: "Record payment",
    paymentCapability: "money.receive",
    returnHref: (docId) => `${ROUTES.newSalesReturn}?salesInvoiceId=${encodeURIComponent(docId)}`,
    // Drafting a sales return is open to staff; posting it is admin-only.
    returnCapability: "sales.draft",
    prefillParam: "customerId",
    partyKind: "customer",
    partyLabel: "Customer",
    partyField: "customerId",
    amountField: "unitPrice",
    amountLabel: "Price",
    requiresSupplierInvoiceNumber: false,
    numberOf: (row) => String(row.invoiceNumber ?? ""),
    dateField: "invoiceDate",
    draftCapability: "sales.draft",
    postCapability: "sales.post",
    completedNote: "Completed sales can't be edited. Use a sales return to undo.",
    emptyTitle: "No sales yet",
    emptyDescription: "Make your first bill and it will show up here.",
    api: salesApi as unknown as DocApi,
    register: async (p) => fromSalesRegister(await registersApi.sales(p)),
  },
  purchase: {
    kind: "purchase",
    noun: "Purchase",
    listTitle: "Purchase bills",
    listDescription: "Bills from your suppliers, and what you still owe.",
    newTitle: "New purchase",
    editTitle: "Edit purchase draft",
    homeHref: ROUTES.purchases,
    listHref: ROUTES.purchaseBills,
    newHref: ROUTES.newPurchase,
    detailHref: (id) => DETAIL_ROUTES.purchase(id),
    editHref: (id) => `${DETAIL_ROUTES.purchase(id)}/edit`,
    paymentHref: (partyId) => `${ROUTES.moneyPaid}?supplierId=${encodeURIComponent(partyId)}`,
    paymentLabel: "Pay supplier",
    paymentCapability: "money.pay",
    returnHref: (docId) => `${ROUTES.newPurchaseReturn}?purchaseId=${encodeURIComponent(docId)}`,
    // Every purchase-return write is ADMIN-only on the backend.
    returnCapability: "purchases.post",
    prefillParam: "supplierId",
    partyKind: "supplier",
    partyLabel: "Supplier",
    partyField: "supplierId",
    amountField: "unitCost",
    amountLabel: "Cost",
    requiresSupplierInvoiceNumber: true,
    numberOf: (row) => String(row.purchaseNumber ?? ""),
    dateField: "invoiceDate",
    // The backend puts requireRole('ADMIN') on EVERY purchase write, drafts
    // included (purchase.routes.js). The shared capability map says staff may
    // draft a purchase, which would walk a staff member into a 403 - so the
    // purchase screens gate drafting on the admin capability instead.
    draftCapability: "purchases.post",
    postCapability: "purchases.post",
    completedNote: "Completed purchases can't be edited. Use a purchase return to undo.",
    emptyTitle: "No purchases yet",
    emptyDescription: "Record a supplier bill and the stock it brought in.",
    api: purchasesApi as unknown as DocApi,
    register: async (p) => fromPurchaseRegister(await registersApi.purchases(p)),
  },
};
