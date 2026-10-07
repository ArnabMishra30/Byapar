"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Box,
  Check,
  Columns3,
  Inbox,
  LayoutGrid,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Power,
  Refrigerator,
  Snowflake,
  Store,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  LOCATION_TYPE_LABEL,
  storageLocationsApi,
  warehousesApi,
  type StorageLocation,
  type StorageLocationType,
} from "@/lib/api";
import { stripBodyPrefix } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import { Can } from "@/components/shared/permission-gate";

const TYPE_ICON: Record<StorageLocationType, React.ComponentType<{ className?: string }>> = {
  RACK: Columns3,
  SHELF: LayoutGrid,
  DRAWER: Inbox,
  FRIDGE: Refrigerator,
  FREEZER: Snowflake,
  COUNTER: Store,
  BIN: Archive,
  BOX: Box,
  OTHER: MapPin,
};

const TYPES = Object.keys(LOCATION_TYPE_LABEL) as StorageLocationType[];

export function LocationIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICON[type as StorageLocationType] ?? MapPin;
  return <Icon className={className} />;
}

/**
 * Racks, shelves, drawers and fridges - where things sit INSIDE a store.
 *
 * The owner sets this up once and everybody follows it: a product says where
 * it is usually kept, and every stock entry is tagged with a location, so
 * anyone can find the stock. A location is only a tag - stock is still counted
 * per store - so renaming or switching one off never changes a quantity.
 */
export function LocationsSection() {
  const queryClient = useQueryClient();
  const warehouses = useQuery({
    queryKey: ["warehouses", "all"],
    queryFn: () => warehousesApi.list({ limit: 100 }),
  });
  const stores = warehouses.data?.items ?? [];

  const [warehouseId, setWarehouseId] = React.useState("");
  const firstStoreId = stores[0]?.id;
  React.useEffect(() => {
    if (!warehouseId && firstStoreId) setWarehouseId(firstStoreId);
  }, [warehouseId, firstStoreId]);

  const locations = useQuery({
    queryKey: ["storage-locations", "settings", warehouseId],
    queryFn: () => storageLocationsApi.list({ warehouseId, limit: 100 }),
    enabled: Boolean(warehouseId),
  });
  const items = locations.data?.items ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["storage-locations"] });
  const onError = (error: Error) => toast.error(stripBodyPrefix(error.message));

  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<StorageLocationType>("RACK");
  const [code, setCode] = React.useState("");

  const create = useMutation({
    mutationFn: () =>
      storageLocationsApi.create({ warehouseId, name: name.trim(), type, code: code.trim() || null }),
    onSuccess: (created) => {
      toast.success(`${created.name} added`);
      setName("");
      setCode("");
      refresh();
    },
    onError,
  });

  const starter = useMutation({
    mutationFn: () => storageLocationsApi.addStarter(warehouseId),
    onSuccess: () => {
      toast.success("Starter layout added. Rename or switch off anything you don't use.");
      refresh();
    },
    onError,
  });

  const toggle = useMutation({
    mutationFn: (location: StorageLocation) => storageLocationsApi.setStatus(location.id, !location.isActive),
    onSuccess: (saved) => {
      toast.success(saved.isActive ? `${saved.name} is in use again` : `${saved.name} switched off`);
      refresh();
    },
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Racks, shelves &amp; fridges</CardTitle>
        <CardDescription>
          Where things are kept inside each store. Set it up once — products and every stock entry
          are tagged with these, so anyone can find the stock.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {warehouses.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : stores.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Add a store above first.
          </p>
        ) : (
          <>
            {stores.length > 1 ? (
              <NativeSelect
                aria-label="Store"
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
                className="sm:w-64"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}

            {locations.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="space-y-3 rounded-lg border border-dashed p-4">
                <p className="text-sm text-muted-foreground">
                  No locations in this store yet. Start with a ready-made layout, or add your own below.
                </p>
                <Can do="settings.manage">
                  <Button
                    variant="outline"
                    className="min-h-[44px] gap-1.5"
                    disabled={starter.isPending}
                    onClick={() => starter.mutate()}
                  >
                    {starter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    Use starter layout
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Rack 1, Rack 2, Counter, Drawer 1, Fridge, Back store.
                  </p>
                </Can>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border">
                {items.map((location) => (
                  <LocationRow
                    key={location.id}
                    location={location}
                    onToggle={() => toggle.mutate(location)}
                    onSaved={refresh}
                  />
                ))}
              </ul>
            )}

            <Can do="settings.manage">
              <form
                className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_7rem_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim() && warehouseId) create.mutate();
                }}
              >
                <Input
                  aria-label="Location name"
                  placeholder="e.g. Rack A, Drawer 3, Fridge"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <NativeSelect
                  aria-label="Type"
                  value={type}
                  onChange={(event) => setType(event.target.value as StorageLocationType)}
                >
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {LOCATION_TYPE_LABEL[value]}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label="Short code"
                  placeholder="Code (optional)"
                  className="uppercase"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button
                  type="submit"
                  className="min-h-[44px] gap-1.5 sm:min-h-0"
                  disabled={!name.trim() || create.isPending}
                >
                  {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add
                </Button>
              </form>
            </Can>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LocationRow({
  location,
  onToggle,
  onSaved,
}: {
  location: StorageLocation;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(location.name);
  const [type, setType] = React.useState<StorageLocationType>(location.type);

  const save = useMutation({
    mutationFn: () => storageLocationsApi.update(location.id, { name: name.trim(), type }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  if (editing) {
    return (
      <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <Input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1" />
        <NativeSelect
          aria-label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as StorageLocationType)}
          className="sm:w-36"
        >
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {LOCATION_TYPE_LABEL[value]}
            </option>
          ))}
        </NativeSelect>
        <div className="flex gap-2">
          <Button size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <LocationIcon type={location.type} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {location.name}
          {location.code ? <span className="ml-1.5 text-xs text-muted-foreground">{location.code}</span> : null}
          {!location.isActive ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(off)</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {LOCATION_TYPE_LABEL[location.type]} · {location.productCount} product
          {location.productCount === 1 ? "" : "s"} kept here
        </p>
      </div>
      <Can do="settings.manage">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${location.name}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggle}
          aria-label={location.isActive ? `Switch off ${location.name}` : `Switch on ${location.name}`}
          className="text-muted-foreground"
        >
          <Power className="h-4 w-4" />
        </Button>
      </Can>
    </li>
  );
}
