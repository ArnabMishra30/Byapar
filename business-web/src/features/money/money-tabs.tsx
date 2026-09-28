"use client";

import { ModuleTabs } from "@/components/shared/module-tabs";
import { ROUTES } from "@/lib/constants";

/**
 * The money pages share one row of tabs, so a shop owner moves between what
 * came in, what went out, running costs and the cash/bank balance without
 * going back to the menu.
 */
export function MoneyTabs() {
  return (
    <ModuleTabs
      tabs={[
        { label: "Money Received", href: ROUTES.moneyReceived },
        { label: "Money Paid", href: ROUTES.moneyPaid },
        { label: "Expenses", href: ROUTES.expenses },
        { label: "Cash & Bank", href: ROUTES.cashBank },
      ]}
    />
  );
}
