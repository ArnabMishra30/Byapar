"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { staffAccessApi } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface StaffAccess {
  shopRole: string;
  permissions: string[];
}

/** A one-line summary of a ready-made role, for the staff list. */
export function useShopRoles() {
  return useQuery({ queryKey: ["staff", "roles"], queryFn: () => staffAccessApi.roles(), staleTime: Infinity });
}

/**
 * "What can they do?" for a staff member: pick a ready-made role (Cashier,
 * Store keeper, Accountant, Manager), then tick or untick anything. Changing a
 * tick turns the role into Custom, so the label never lies about the access.
 *
 * The server enforces every one of these; this only edits the list.
 */
export function StaffAccessFields({
  value,
  onChange,
  disabled = false,
}: {
  value: StaffAccess;
  onChange: (next: StaffAccess) => void;
  disabled?: boolean;
}) {
  const catalog = useShopRoles();
  const [showAll, setShowAll] = React.useState(value.shopRole === "CUSTOM");

  if (catalog.isLoading || !catalog.data) return <Skeleton className="h-24 w-full" />;
  const { roles, permissions } = catalog.data;

  const pickRole = (key: string) => {
    const template = roles.find((role) => role.key === key);
    if (!template) return;
    onChange({
      shopRole: key,
      // Custom keeps the current ticks; a template brings its own.
      permissions: key === "CUSTOM" ? value.permissions : template.permissions,
    });
    if (key === "CUSTOM") setShowAll(true);
  };

  const toggle = (key: string, on: boolean) => {
    const next = on ? [...new Set([...value.permissions, key])] : value.permissions.filter((p) => p !== key);
    const matching = roles.find(
      (role) => role.key !== "CUSTOM" && role.permissions.length === next.length && role.permissions.every((p) => next.includes(p)),
    );
    onChange({ shopRole: matching?.key ?? "CUSTOM", permissions: next });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="staff-shop-role">What do they do?</Label>
        <NativeSelect
          id="staff-shop-role"
          value={value.shopRole}
          disabled={disabled}
          onChange={(event) => pickRole(event.target.value)}
        >
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          {value.permissions.length === 0
            ? "Nothing ticked yet: they can only look around."
            : `${value.permissions.length} of ${permissions.length} allowed.`}{" "}
          {!value.permissions.includes("SALES_VIEW_ALL")
            ? "They see only the bills they made themselves, not anyone else's or the shop's totals."
            : null}
        </p>
      </div>

      <div className="rounded-lg border">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center justify-between px-3 text-left text-sm font-medium"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
        >
          Change exactly what they can do
          <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} aria-hidden />
        </button>
        <ul className={cn("space-y-1 border-t p-3", !showAll && "hidden")}>
          {permissions.map((permission) => (
            <li key={permission.key}>
              <label className="flex min-h-[36px] cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  disabled={disabled}
                  checked={value.permissions.includes(permission.key)}
                  onChange={(event) => toggle(permission.key, event.target.checked)}
                />
                <span>{permission.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** "Cashier / Biller", "Store keeper"... or the old plain "Staff". */
export function shopRoleLabel(roles: { key: string; label: string }[] | undefined, shopRole?: string | null) {
  if (!shopRole) return null;
  return roles?.find((role) => role.key === shopRole)?.label ?? shopRole;
}
