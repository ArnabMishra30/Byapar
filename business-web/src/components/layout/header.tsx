"use client";

import Link from "next/link";
import { LogOut, User as UserIcon } from "lucide-react";
import { MobileNav } from "./mobile-nav";
import { useAuth } from "@/lib/auth/auth-context";
import { roleLabel } from "@/lib/auth/roles";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/utils";

export function Header() {
  const { user, company, logout, isAdmin } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
      <MobileNav />

      {/* The company is shown, never chosen: the backend decides it from the
          token, and this application has no company switcher. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground lg:hidden">
          {company?.name ?? "Byapar"}
        </p>
      </div>

      <Badge variant={isAdmin ? "default" : "secondary"} className="hidden sm:inline-flex">
        {roleLabel(user?.role)}
      </Badge>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
            <Avatar>
              <AvatarFallback>{initials(user?.name)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block truncate text-sm font-semibold">{user?.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {user?.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/shop/profile">
              <UserIcon className="h-4 w-4" />
              My profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
