"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  admin: "Admin",
  companies: "Companies",
  users: "Users",
  roles: "Roles & Permissions",
  "audit-logs": "Audit Logs",
  settings: "Settings",
  profile: "Profile",
  sales: "Sales",
  purchases: "Purchases",
  inventory: "Inventory",
  customers: "Customers",
  suppliers: "Suppliers",
  expenses: "Expenses",
  credit: "Credit Book",
  gst: "GST Compliance",
  reports: "Reports",
};

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0 || pathname === "/admin/login") return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center text-xs text-muted-foreground", className)}>
      <ol className="flex items-center space-x-1 sm:space-x-2">
        <li>
          <Link
            href="/dashboard"
            className="flex items-center hover:text-foreground transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            <span className="sr-only">Home</span>
          </Link>
        </li>

        {segments.map((segment, index) => {
          const href = "/" + segments.slice(0, index + 1).join("/");
          const isLast = index === segments.length - 1;
          const label = routeLabels[segment] || decodeURIComponent(segment);

          return (
            <li key={href} className="flex items-center">
              <ChevronRight className="h-3.5 w-3.5 mx-1 opacity-50 shrink-0" />
              {isLast ? (
                <span className="font-semibold text-foreground truncate max-w-[150px] sm:max-w-[200px]">
                  {label}
                </span>
              ) : (
                <Link
                  href={href}
                  className="hover:text-foreground transition-colors capitalize"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
