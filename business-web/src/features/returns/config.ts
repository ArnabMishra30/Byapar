import {
  purchaseReturnApi,
  purchasesApi,
  salesApi,
  salesReturnApi,
  type ListParams,
  type ListResult,
  type ReturnDoc,
} from "@/lib/api";
import type { Capability } from "@/lib/permissions";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";

/**
 * Sales returns and purchase returns are the same screen twice, facing opposite
 * ways. Everything that differs lives here, so the list, form and detail
 * components are written once.
 *
 * Both backends: STAFF may create a draft; only ADMIN may post or cancel.
 */
export type ReturnKind = "sale" | "purchase";

/** One line of the original document, as the backend says it can be returned. */
export interface ReturnableLine {
  itemId: string;
  productName: string;
  sku: string | null;
  /** Backend price (sales) or cost (purchases) per unit, display only. */
  unitPrice: string;
  originalQuantity: string;
  returnedQuantity: string;
  remainingQuantity: string;
}

export interface ReturnableSource {
  sourceId: string;
  sourceNumber: string;
  sourceStatus: string;
  partyId: string | null;
  partyName: string;
  warehouseName: string;
  lines: ReturnableLine[];
}

/** A completed invoice/bill offered in the "pick a document" step. */
export interface SourceOption {
  id: string;
  number: string;
  secondaryNumber?: string | null;
  date: string;
  partyName: string;
  grandTotal: string;
}

export interface ReturnConfig {
  kind: ReturnKind;
  queryKey: string;
  listTitle: string;
  listDescription: string;
  newTitle: string;
  partyLabel: string;
  sourceLabel: string;
  sourcePickTitle: string;
  unitPriceLabel: string;
  originalQtyLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  postTitle: string;
  postDescription: string;
  draftCapability: Capability;
  postCapability: Capability;
  listHref: string;
  newHref: string;
  detailHref: (id: string) => string;
  sourceHref: (id: string) => string;
  /** The query param the "new" page reads to preselect the original document. */
  sourceParam: string;
  api: {
    list: (p?: ListParams) => Promise<ListResult<ReturnDoc>>;
    get: (id: string) => Promise<ReturnDoc>;
    post: (id: string) => Promise<ReturnDoc>;
    cancel: (id: string) => Promise<ReturnDoc>;
    create: (
      sourceId: string,
      body: { returnDate: string; reason?: string; notes?: string },
      items: { itemId: string; quantity: string }[],
    ) => Promise<ReturnDoc>;
    returnable: (sourceId: string) => Promise<ReturnableSource>;
    searchSources: (search: string) => Promise<SourceOption[]>;
  };
  partyOf: (doc: ReturnDoc) => { id?: string; name?: string } | undefined;
  sourceOf: (doc: ReturnDoc) => { id: string; number: string } | null;
  /** Backend line fields for the detail table. */
  linePriceField: string;
}

type Party = { id?: string; name?: string };

export const RETURN_CONFIG: Record<ReturnKind, ReturnConfig> = {
  sale: {
    kind: "sale",
    queryKey: "sales-returns",
    listTitle: "Sales Returns",
    listDescription: "Items customers brought back.",
    newTitle: "New Return",
    partyLabel: "Customer",
    sourceLabel: "Invoice",
    sourcePickTitle: "Which invoice is the customer returning from?",
    unitPriceLabel: "Price",
    originalQtyLabel: "Sold",
    emptyTitle: "No sales returns yet",
    emptyDescription:
      "A return brings items back to stock and reduces what the customer owes.",
    postTitle: "Complete this return?",
    postDescription:
      "The items come back into stock and the customer owes you less (a credit note is raised against their invoice). A completed return cannot be edited or undone.",
    draftCapability: "sales.draft",
    postCapability: "sales.post",
    listHref: ROUTES.salesReturns,
    newHref: ROUTES.newSalesReturn,
    detailHref: DETAIL_ROUTES.salesReturn,
    sourceHref: DETAIL_ROUTES.sale,
    sourceParam: "salesInvoiceId",
    linePriceField: "unitPrice",
    api: {
      list: salesReturnApi.list,
      get: salesReturnApi.get,
      post: salesReturnApi.post,
      cancel: salesReturnApi.cancel,
      create: (sourceId, body, items) =>
        salesReturnApi.create({
          salesInvoiceId: sourceId,
          ...body,
          items: items.map((item) => ({ salesInvoiceItemId: item.itemId, quantity: item.quantity })),
        }),
      returnable: async (sourceId) => {
        const r = await salesReturnApi.returnable(sourceId);
        return {
          sourceId: r.salesInvoiceId,
          sourceNumber: r.invoiceNumber,
          sourceStatus: r.status,
          partyId: r.customer?.id ?? null,
          partyName: r.customer?.name ?? "",
          warehouseName: r.warehouse?.name ?? "",
          lines: r.lines.map((line) => ({
            itemId: line.salesInvoiceItemId,
            productName: line.productName,
            sku: line.sku,
            unitPrice: line.unitPrice,
            originalQuantity: line.soldQuantity,
            returnedQuantity: line.returnedQuantity,
            remainingQuantity: line.remainingQuantity,
          })),
        };
      },
      searchSources: async (search) => {
        const { items } = await salesApi.list({
          status: "POSTED",
          search: search || undefined,
          limit: 10,
        });
        return items.map((invoice) => ({
          id: invoice.id,
          number: invoice.invoiceNumber,
          date: invoice.invoiceDate,
          partyName: invoice.customer?.name ?? "",
          grandTotal: invoice.grandTotal,
        }));
      },
    },
    partyOf: (doc) => doc.customer as Party | undefined,
    sourceOf: (doc) =>
      doc.salesInvoice ? { id: doc.salesInvoice.id, number: doc.salesInvoice.invoiceNumber } : null,
  },

  purchase: {
    kind: "purchase",
    queryKey: "purchase-returns",
    listTitle: "Purchase Returns",
    listDescription: "Items you sent back to suppliers.",
    newTitle: "New Return",
    partyLabel: "Supplier",
    sourceLabel: "Purchase bill",
    sourcePickTitle: "Which purchase bill are you returning items from?",
    unitPriceLabel: "Cost",
    originalQtyLabel: "Bought",
    emptyTitle: "No purchase returns yet",
    emptyDescription:
      "A return sends items back to the supplier: stock goes out and you owe the supplier less.",
    postTitle: "Complete this return?",
    postDescription:
      "The items go out of your stock and you owe the supplier less (a credit is raised against their bill). A completed return cannot be edited or undone.",
    draftCapability: "purchases.draft",
    postCapability: "purchases.post",
    listHref: ROUTES.purchaseReturns,
    newHref: ROUTES.newPurchaseReturn,
    detailHref: DETAIL_ROUTES.purchaseReturn,
    sourceHref: DETAIL_ROUTES.purchase,
    sourceParam: "purchaseId",
    linePriceField: "unitCost",
    api: {
      list: purchaseReturnApi.list,
      get: purchaseReturnApi.get,
      post: purchaseReturnApi.post,
      cancel: purchaseReturnApi.cancel,
      create: (sourceId, body, items) =>
        purchaseReturnApi.create({
          purchaseId: sourceId,
          ...body,
          items: items.map((item) => ({ purchaseItemId: item.itemId, quantity: item.quantity })),
        }),
      returnable: async (sourceId) => {
        // The returnable endpoint does not name the supplier, so the bill itself
        // is read alongside it for the header.
        const [r, purchase] = await Promise.all([
          purchaseReturnApi.returnable(sourceId),
          purchasesApi.get(sourceId),
        ]);
        return {
          sourceId: r.purchaseId,
          sourceNumber: purchase.invoiceNumber
            ? `${r.purchaseNumber} (${purchase.invoiceNumber})`
            : r.purchaseNumber,
          sourceStatus: r.status,
          partyId: purchase.supplier?.id ?? null,
          partyName: purchase.supplier?.name ?? "",
          warehouseName: r.warehouse?.name ?? "",
          lines: r.lines.map((line) => ({
            itemId: line.purchaseItemId,
            productName: line.productName,
            sku: line.sku,
            unitPrice: line.unitCost,
            originalQuantity: line.purchasedQuantity,
            returnedQuantity: line.returnedQuantity,
            remainingQuantity: line.remainingQuantity,
          })),
        };
      },
      searchSources: async (search) => {
        const { items } = await purchasesApi.list({
          status: "POSTED",
          search: search || undefined,
          limit: 10,
        });
        return items.map((bill) => ({
          id: bill.id,
          number: bill.purchaseNumber,
          secondaryNumber: bill.invoiceNumber,
          date: bill.invoiceDate,
          partyName: bill.supplier?.name ?? "",
          grandTotal: bill.grandTotal,
        }));
      },
    },
    // A purchase return carries its supplier inside the purchase it came from.
    partyOf: (doc) =>
      (doc.purchase as { supplier?: Party } | null | undefined)?.supplier ?? undefined,
    sourceOf: (doc) =>
      doc.purchase ? { id: doc.purchase.id, number: doc.purchase.purchaseNumber } : null,
  },
};
