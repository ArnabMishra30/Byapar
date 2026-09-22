"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { Wallet } from "lucide-react";

export default function ExpensesPage() {
  return (
    <ModulePlaceholder
      title="Operating Expenses"
      description="Record day-to-day shop operational costs paid out of cash or bank."
      icon={Wallet}
      features={[
        "Record paid expenses such as rent, electricity, salaries, transport, and tea",
        "Direct posting to Expense accounts in the general ledger",
        "Support for Cash and Bank payment accounts with live balance updates",
        "Optional supplier/vendor association for payment attribution",
        "Complete non-GST support: works identically for registered and local shops",
      ]}
    />
  );
}
