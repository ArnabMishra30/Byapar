"use client";

import React from "react";
import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { UserCheck } from "lucide-react";

export default function CustomersPage() {
  return (
    <ModulePlaceholder
      title="Customer Directory & Credit Management"
      description="Manage customer profiles, credit limits, contact info, and individual customer ledgers."
      icon={UserCheck}
      features={[
        "Customer profile with optional GSTIN and place of supply",
        "Opening balance recording for historical balances",
        "Credit limit setting (0 = unlimited credit)",
        "Payment terms (credit days) for automatic invoice due dates",
        "Statement of accounts with running balance and transaction audit",
      ]}
    />
  );
}
