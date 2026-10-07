import { getList, getOne, patchOne, postOne, type ListParams } from "./http";
import { apiClient } from "./client";
import type { ApiSuccessResponse } from "@/types/api";

// STORAGE LOCATIONS: racks, shelves, drawers and fridges inside a store.
//
// The shop owner sets the layout up once; products say where they are usually
// kept, and every stock entry is tagged with a location. A tag only - stock is
// still counted per store.

export type StorageLocationType =
  | "RACK"
  | "SHELF"
  | "DRAWER"
  | "FRIDGE"
  | "FREEZER"
  | "COUNTER"
  | "BIN"
  | "BOX"
  | "OTHER";

export interface StorageLocation {
  id: string;
  warehouseId: string;
  warehouse: { id: string; name: string; code: string } | null;
  name: string;
  type: StorageLocationType;
  code: string | null;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface StorageLocationInput {
  warehouseId: string;
  name: string;
  type?: StorageLocationType;
  code?: string | null;
  notes?: string | null;
}

export const LOCATION_TYPE_LABEL: Record<StorageLocationType, string> = {
  RACK: "Rack",
  SHELF: "Shelf",
  DRAWER: "Drawer",
  FRIDGE: "Fridge",
  FREEZER: "Freezer",
  COUNTER: "Counter",
  BIN: "Bin",
  BOX: "Box",
  OTHER: "Other",
};

export const storageLocationsApi = {
  list: (p?: ListParams & { warehouseId?: string; isActive?: string; type?: StorageLocationType }) =>
    getList<StorageLocation>("/storage-locations", p),
  get: (id: string) => getOne<StorageLocation>(`/storage-locations/${id}`, "location"),
  create: (body: StorageLocationInput) => postOne<StorageLocation>("/storage-locations", "location", body),
  update: (id: string, body: Partial<Omit<StorageLocationInput, "warehouseId">>) =>
    patchOne<StorageLocation>(`/storage-locations/${id}`, "location", body),
  setStatus: (id: string, isActive: boolean) =>
    patchOne<StorageLocation>(`/storage-locations/${id}/status`, "location", { isActive }),
  /** Adds Rack 1, Rack 2, Counter, Drawer 1, Fridge, Back store. Safe to repeat. */
  addStarter: async (warehouseId: string): Promise<StorageLocation[]> => {
    const res = await apiClient.post<ApiSuccessResponse<{ locations: StorageLocation[] }>>(
      "/storage-locations/starter",
      { warehouseId },
    );
    return res.data.data.locations;
  },
};
