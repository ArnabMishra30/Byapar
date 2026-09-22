"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store } from "lucide-react";
import { toast } from "sonner";
import { warehousesApi } from "@/lib/api";
import { stripBodyPrefix } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Can } from "@/components/shared/permission-gate";

/**
 * Godowns and stores - the places stock actually sits.
 *
 * WHY THIS SCREEN HAD TO EXIST. Every purchase, sale and stock movement names a
 * warehouse, and until now nothing in the app could create one: a shop with no
 * warehouse met an empty "Godown / store" dropdown it had no way to fill, on
 * the very screen where it was trying to record its first bill. New companies
 * now start with one, and this is where a shop with a back godown adds the rest.
 *
 * A code is what the shop calls it on paper - MAIN, BACK, VAN1. It is required
 * by the API and must be unique within the business, so it is asked for plainly
 * rather than invented behind the shop's back.
 */
export function StoresSection() {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");

  const warehouses = useQuery({
    queryKey: ["warehouses", "all"],
    queryFn: () => warehousesApi.list({ limit: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: () => warehousesApi.create({ name: name.trim(), code: code.trim().toUpperCase() }),
    onSuccess: (created) => {
      toast.success(`${created.name} added`);
      setName("");
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  const items = warehouses.data?.items ?? [];
  const canSubmit = name.trim().length > 0 && code.trim().length > 0 && !createMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stores &amp; godowns</CardTitle>
        <CardDescription>
          Where your stock is kept. Every sale, purchase and stock entry is recorded against one
          of these.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {warehouses.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            You have no store yet. Add one below — most shops need only one.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((warehouse) => (
              <li key={warehouse.id} className="flex items-center gap-3 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Store className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{warehouse.name}</span>
                  <span className="block text-xs text-muted-foreground">{warehouse.code}</span>
                </span>
                {!warehouse.isActive && <Badge variant="outline">Inactive</Badge>}
              </li>
            ))}
          </ul>
        )}

        <Can
          do="settings.manage"
          fallback={
            <p className="text-sm text-muted-foreground">
              Ask an admin in your business to add a store.
            </p>
          }
        >
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) createMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="store-name">Name</Label>
              <Input
                id="store-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Back godown"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-code">Short code</Label>
              <Input
                id="store-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="BACK"
                maxLength={20}
              />
            </div>
            <Button type="submit" disabled={!canSubmit}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {createMutation.isPending ? "Adding…" : "Add store"}
            </Button>
          </form>
        </Can>
      </CardContent>
    </Card>
  );
}
