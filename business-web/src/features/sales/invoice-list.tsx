"use client";

import { DocumentRegisterList } from "@/features/documents/document-register";
import { SALES_TABS } from "./tabs";

/** Every sales invoice: completed (with paid / due), drafts and cancelled. */
export function InvoiceList() {
  return (
    <DocumentRegisterList
      kind="sale"
      tabs={SALES_TABS}
      unavailable={[
        {
          title: "Filter by paid / unpaid / part paid",
          description:
            "The server cannot filter invoices by payment status yet. Each row shows its status; the Credit Book lists every unpaid invoice.",
        },
        {
          title: "Filter by salesperson or product",
          description: "Invoices are not linked to a salesperson, and there is no item-wise filter yet.",
        },
      ]}
    />
  );
}
