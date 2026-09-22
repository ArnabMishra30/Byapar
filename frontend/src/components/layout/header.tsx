"use client";

import { roleLabel, roleShortLabel } from "@/lib/auth/roles";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { MobileNav } from "./mobile-nav";
import { Breadcrumbs } from "./breadcrumbs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GstBadge } from "@/components/shared/gst-badge";
import { getInitials } from "@/lib/utils";
import {
  User,
  LogOut,
  Sliders,
  Building2,
  Shield,
  Bell,
  Search,
} from "lucide-react";

export function Header() {
  const { user, company, logout, isGstEnabled, isAdmin } = useAuth();

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-border/80 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
      {/* Left side: Mobile trigger + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <MobileNav />
        <div className="hidden sm:block">
          <Breadcrumbs />
        </div>
      </div>

      {/* Right side: Active company badge, Notifications, User Menu */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Company & GST Badge */}
        {company && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-muted/30">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground max-w-[140px] truncate">
              {company.name}
            </span>
            <GstBadge
              isGstEnabled={isGstEnabled}
              registrationType={company.gstRegistrationType}
            />
          </div>
        )}

        {/* User Account Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-9 rounded-full px-2 gap-2 hover:bg-muted/70"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs font-bold">
                  {getInitials(user?.name)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden lg:flex flex-col items-start text-left text-xs">
                <span className="font-semibold text-foreground leading-tight">
                  {user?.name || "Account"}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase">
                  {roleShortLabel(user?.role)}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold text-foreground leading-none">
                  {user?.name}
                </p>
                <p className="text-xs text-muted-foreground leading-none">
                  {user?.email}
                </p>
                <span className="mt-1 inline-flex text-[10px] uppercase font-bold text-primary">
                  {roleLabel(user?.role)}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center gap-2 cursor-pointer">
                <User className="w-4 h-4 text-muted-foreground" />
                <span>My Profile</span>
              </Link>
            </DropdownMenuItem>

            {isAdmin && (
              <>
                <DropdownMenuItem asChild>
                  <Link
                    href="/admin/companies"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span>Manage Companies</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <Link
                    href="/admin/settings"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Sliders className="w-4 h-4 text-muted-foreground" />
                    <span>System Settings</span>
                  </Link>
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={logout}
              className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
