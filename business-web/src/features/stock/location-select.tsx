"use client";

import { useQuery } from "@tanstack/react-query";
import { storageLocationsApi, type StorageLocation } from "@/lib/api";
import { NativeSelect } from "@/components/ui/select-native";

/** The shop's active racks/shelves/fridges. One cached query for every picker. */
export function useStorageLocations(warehouseId?: string) {
  return useQuery({
    queryKey: ["storage-locations", "options", warehouseId ?? "all"],
    queryFn: () =>
      storageLocationsApi.list({ limit: 100, isActive: "true", ...(warehouseId ? { warehouseId } : {}) }),
  });
}

/**
 * A rack / shelf / fridge picker.
 *
 * With `warehouseId` it lists only that store's locations (stock entries must
 * use a spot in the store they are recorded against). Without it, every
 * location, grouped by store (a product's usual spot).
 */
export function LocationSelect({
  id,
  value,
  onChange,
  warehouseId,
  emptyLabel = "Not set",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  warehouseId?: string;
  emptyLabel?: string;
}) {
  const locations = useStorageLocations(warehouseId);
  const items = locations.data?.items ?? [];

  const groups = new Map<string, { name: string; items: StorageLocation[] }>();
  for (const location of items) {
    const key = location.warehouseId;
    if (!groups.has(key)) groups.set(key, { name: location.warehouse?.name ?? "Store", items: [] });
    groups.get(key)!.items.push(location);
  }
  const grouped = !warehouseId && groups.size > 1;

  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={locations.isLoading}>
      <option value="">{items.length === 0 && !locations.isLoading ? "No locations set up yet" : emptyLabel}</option>
      {grouped
        ? Array.from(groups.entries()).map(([key, group]) => (
            <optgroup key={key} label={group.name}>
              {group.items.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </optgroup>
          ))
        : items.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
    </NativeSelect>
  );
}
