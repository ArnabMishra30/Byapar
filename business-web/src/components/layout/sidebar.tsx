"use client";

import Link from "next/link";
import { Store } from "lucide-react";
import { NavItems } from "./nav-items";
import { useAuth } from "@/lib/auth/auth-context";
import { Badge } from "@/components/ui/badge";

/** The desktop sidebar. Hidden below lg; the header owns navigation there. */
export function Sidebar() {
  const { company, isGstEnabled } = useAuth();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b px-4">
        <Link href="/shop/dashboard" className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-foreground">
              {company?.name ?? "Byapar"}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {isGstEnabled ? "GST registered" : "Business account"}
            </span>
          </span>
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavItems />
      </div>

      {isGstEnabled ? (
        <div className="shrink-0 border-t p-3">
          <Badge variant="secondary" className="w-full justify-center py-1">
            GST enabled
          </Badge>
        </div>
      ) : null}
    </aside>
  );
}
