"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { NotAvailable } from "@/components/shared/not-available";
import { Can } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { MovementList } from "./movement-list";
import { StockTabs } from "./stock-ui";

/**
 * Stock that came in: purchases, plus opening stock on the toggle.
 *
 * Every row is a backend stock movement. The supplier is not stored on the
 * movement, so the reference link opens the purchase, which shows it.
 */
export function StockInPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock In"
        description="Stock added by purchases. Switch the type to see opening stock."
        actions={
          <Can do="purchases.draft">
            <Button asChild className="min-h-[44px]">
              <Link href={ROUTES.newPurchase}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New purchase</span>
                <span className="sm:hidden">Purchase</span>
              </Link>
            </Button>
          </Can>
        }
      />
      <StockTabs />
      <MovementList
        types={["STOCK_IN", "OPENING_STOCK"]}
        columnSet="in"
        emptyTitle="No stock has come in yet"
        emptyDescription="Post a purchase and the items appear here."
        emptyAction={
          <div className="flex flex-wrap justify-center gap-2">
            <Can do="purchases.draft">
              <Button asChild size="sm">
                <Link href={ROUTES.newPurchase}>New purchase</Link>
              </Button>
            </Can>
            <Button asChild size="sm" variant="outline">
              <Link href={`${ROUTES.bills}?upload=1&direction=IN`}>
                <Upload className="h-4 w-4" /> Upload purchase bill
              </Link>
            </Button>
          </div>
        }
      />
      <NotAvailable
        features={[
          {
            title: "Supplier on each row",
            description: "Open the purchase from the Reference column to see the supplier.",
          },
          {
            title: "Batch, serial number and expiry",
            description: "Stock is tracked per product and warehouse only.",
          },
        ]}
      />
    </div>
  );
}

/** Stock that went out through sales. "Billed by" is who posted the sale. */
export function StockOutPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Out"
        description="Stock taken out by sales."
        actions={
          <Can do="sales.draft">
            <Button asChild className="min-h-[44px]">
              <Link href={ROUTES.newSale}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New sale</span>
                <span className="sm:hidden">Sale</span>
              </Link>
            </Button>
          </Can>
        }
      />
      <StockTabs />
      <MovementList
        types={["STOCK_OUT"]}
        columnSet="out"
        emptyTitle="No stock has gone out yet"
        emptyDescription="Post a sale and the items appear here."
        emptyAction={
          <Can do="sales.draft">
            <Button asChild size="sm">
              <Link href={ROUTES.newSale}>New sale</Link>
            </Button>
          </Can>
        }
      />
      <NotAvailable
        features={[
          {
            title: "Customer on each row",
            description: "Open the sale from the Reference column to see the customer.",
          },
        ]}
      />
    </div>
  );
}
