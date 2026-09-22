"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Store } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NavItems } from "./nav-items";
import { useAuth } from "@/lib/auth/auth-context";

/**
 * Navigation on a phone: a drawer, not a squeezed sidebar.
 *
 * It closes on navigation - leaving it open over the page the user just asked
 * for is the single most common mobile-nav bug.
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const { company } = useAuth();

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-[85%] max-w-xs p-0">
        <div className="flex h-16 items-center gap-2.5 border-b px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="h-5 w-5" />
          </span>
          <SheetTitle className="min-w-0 truncate">{company?.name ?? "Byapar"}</SheetTitle>
        </div>
        <div className="h-[calc(100vh-4rem)] overflow-y-auto pb-8">
          <NavItems onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
