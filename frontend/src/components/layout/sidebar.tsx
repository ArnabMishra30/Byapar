"use client";

import { roleLabel } from "@/lib/auth/roles";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { NAVIGATION_CONFIG, NavItem, NavSection } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Users,
  UserCheck,
  Truck,
  Receipt,
  ShoppingCart,
  Boxes,
  Wallet,
  BookOpen,
  Landmark,
  BarChart3,
  ShieldCheck,
  KeyRound,
  History,
  Sliders,
  UserCog,
  Store,
  Sparkles,
  CalendarClock,
  Tags,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard,
  Building2,
  Users,
  UserCheck,
  Truck,
  Receipt,
  ShoppingCart,
  Boxes,
  Wallet,
  BookOpen,
  Landmark,
  BarChart3,
  ShieldCheck,
  KeyRound,
  History,
  Sliders,
  UserCog,
  Store,
  Sparkles,
  CalendarClock,
  Tags,
  UsersRound,
};

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { user, isAdmin, isGstEnabled, company } = useAuth();

  const isRouteActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const renderItem = (item: NavItem) => {
    // Check role restriction
    if (item.roles && !item.roles.includes(user?.role as any)) {
      return null;
    }

    const Icon = iconMap[item.icon] || Store;
    const active = isRouteActive(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "group flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-all duration-150",
          active
            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        )}
      >
        <div className="flex items-center gap-3">
          <Icon
            className={cn(
              "w-4 h-4 transition-transform group-hover:scale-110",
              active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          <span>{item.title}</span>
        </div>

        {item.badge && (
          <span
            className={cn(
              "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded tracking-wider",
              active
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const renderSection = (section: NavSection) => {
    // Check role restriction for whole section
    if (section.roles && !section.roles.includes(user?.role as any)) {
      return null;
    }

    // Filter items
    const visibleItems = section.items.filter((item) => {
      if (item.roles && !item.roles.includes(user?.role as any)) return false;
      return true;
    });

    if (visibleItems.length === 0) return null;

    return (
      <div key={section.title} className="space-y-1">
        <div className="flex items-center justify-between px-3 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
          <span>{section.title}</span>
          {section.title === "COMPLIANCE" && !isGstEnabled && (
            <span className="text-[9px] font-normal text-muted-foreground/60 lowercase italic">
              (optional)
            </span>
          )}
        </div>
        <div className="space-y-0.5">{visibleItems.map(renderItem)}</div>
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-card border-r border-border/80 w-64 select-none",
        className
      )}
    >
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-border/80 bg-card/60 backdrop-blur-sm">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-indigo-700 flex items-center justify-center text-primary-foreground shadow-sm shadow-primary/30">
            <Store className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-foreground flex items-center gap-1.5">
              Byapar
              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20">
                PRO
              </span>
            </span>
          </div>
        </Link>
      </div>

      {/* Company Quick Glance */}
      {company && (
        <div className="px-4 py-3 border-b border-border/60 bg-muted/20">
          <div className="text-xs font-semibold text-foreground truncate">
            {company.name}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={cn(
                "inline-block w-1.5 h-1.5 rounded-full",
                company.isActive ? "bg-emerald-500" : "bg-rose-500"
              )}
            />
            <span className="text-[11px] text-muted-foreground">
              {isGstEnabled ? "GST Enabled" : "Non-GST Shop"}
            </span>
          </div>
        </div>
      )}

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAVIGATION_CONFIG.map(renderSection)}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-border/80 bg-muted/10 text-xs text-muted-foreground">
        <div className="flex items-center justify-between px-2">
          <span>Role: <strong className="text-foreground">{roleLabel(user?.role)}</strong></span>
          <span className="text-[10px] font-mono opacity-60">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
