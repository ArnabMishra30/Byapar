"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { Landmark } from "lucide-react";

export default function CashBankPage() {
  return (
    <ModulePlaceholder
      title="Cash & Bank Balances"
      description="Track cash-in-hand and bank account balances from sales receipts, bill payments, and operating expenses."
      icon={Landmark}
      features={[
        "Real-time cash book and bank ledger balances",
        "Detailed voucher history of customer receipts and supplier payments",
        "Expense outflows attributed to cash or bank accounts",
        "Opening balance reconciliation",
        "Reconciles 100% with double-entry General Ledger Asset accounts",
      ]}
    />
  );
}
