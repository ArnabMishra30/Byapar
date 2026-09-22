import { salesApi, purchasesApi, type ListParams, type ListResult } from "@/lib/api";
import type { Capability } from "@/lib/permissions";

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
  listTitle: string;
  listDescription: string;
  newTitle: string;
  backHref: string;
  detailHref: (id: string) => string;
  newHref: string;

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

  emptyTitle: string;
  emptyDescription: string;

  api: DocApi;
}

export const DOC_CONFIG: Record<DocKind, DocConfig> = {
  sale: {
    kind: "sale",
    listTitle: "Sales",
    listDescription: "Bills you gave customers, and what they still owe.",
    newTitle: "New sale",
    backHref: "/shop/sales",
    detailHref: (id) => `/shop/sales/${id}`,
    newHref: "/shop/sales/new",
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
    emptyTitle: "No sales yet",
    emptyDescription: "Make your first bill and it will show up here.",
    api: salesApi as unknown as DocApi,
  },
  purchase: {
    kind: "purchase",
    listTitle: "Purchases",
    listDescription: "Bills from your suppliers, and what you still owe.",
    newTitle: "New purchase",
    backHref: "/shop/purchases",
    detailHref: (id) => `/shop/purchases/${id}`,
    newHref: "/shop/purchases/new",
    partyKind: "supplier",
    partyLabel: "Supplier",
    partyField: "supplierId",
    amountField: "unitCost",
    amountLabel: "Cost",
    requiresSupplierInvoiceNumber: true,
    numberOf: (row) => String(row.purchaseNumber ?? ""),
    dateField: "invoiceDate",
    draftCapability: "purchases.draft",
    postCapability: "purchases.post",
    emptyTitle: "No purchases yet",
    emptyDescription: "Record a supplier bill and the stock it brought in.",
    api: purchasesApi as unknown as DocApi,
  },
};
