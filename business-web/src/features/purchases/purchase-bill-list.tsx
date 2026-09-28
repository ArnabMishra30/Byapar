"use client";

import { DocumentRegisterList } from "@/features/documents/document-register";
import { PURCHASE_TABS } from "./tabs";

/** Every purchase bill: completed (with paid / due), drafts and cancelled. */
export function PurchaseBillList() {
  return (
    <DocumentRegisterList
      kind="purchase"
      tabs={PURCHASE_TABS}
      unavailable={[
        {
          title: "Filter by paid / unpaid / part paid",
          description:
            "The server cannot filter bills by payment status yet. Each row shows its status; Supplier Payables lists every unpaid bill.",
        },
      ]}
    />
  );
}
