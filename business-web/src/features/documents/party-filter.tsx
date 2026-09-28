"use client";

import { X } from "lucide-react";
import { EntitySelect } from "@/components/shared/entity-select";
import { Button } from "@/components/ui/button";

export interface PartyValue {
  id: string;
  label: string;
}

/**
 * "Only this customer" / "only this supplier", with a way back to everyone.
 *
 * The picker searches on the server, so it works for a shop with thousands of
 * parties. Clearing is a separate button because the picker itself has no
 * "none" choice.
 */
export function PartyFilter({
  kind,
  value,
  onChange,
}: {
  kind: "customer" | "supplier";
  value: PartyValue | null;
  onChange: (next: PartyValue | null) => void;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <EntitySelect
          kind={kind}
          value={value?.id ?? ""}
          valueLabel={value?.label ?? ""}
          placeholder={kind === "customer" ? "All customers" : "All suppliers"}
          onChange={(id, label) => onChange({ id, label })}
        />
      </div>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
          aria-label={kind === "customer" ? "Show all customers" : "Show all suppliers"}
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
