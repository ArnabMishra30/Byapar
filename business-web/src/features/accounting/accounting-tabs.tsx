"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { ROUTES } from "@/lib/constants";
import { ModuleTabs } from "@/components/shared/module-tabs";

/**
 * The four accountant pages as one row of tabs, so moving between them does
 * not mean going back to the menu. Opening balance and periods are hidden for
 * staff, matching the navigation (the backend refuses their writes anyway).
 */
export function AccountingTabs() {
  const { isAdmin } = useAuth();
  return (
    <ModuleTabs
      tabs={[
        { label: "Accounts", href: ROUTES.accounts },
        { label: "Journal & Ledger", href: ROUTES.journal },
        { label: "Opening balance", href: ROUTES.openingBalance, show: isAdmin },
        { label: "Periods", href: ROUTES.periods, show: isAdmin },
      ]}
    />
  );
}
