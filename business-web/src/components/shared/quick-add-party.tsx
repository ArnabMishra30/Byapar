"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ApiError, partiesApi, type PartyMatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Add a customer (or supplier) without leaving the bill being made.
 *
 * Name and mobile only - everything else can be filled in later on the party's
 * page. It goes through the same Party API as the full Add Party screen, so a
 * possible duplicate (same mobile, GSTIN or name) is shown rather than created:
 * the person picks the existing one, or confirms it really is someone new.
 */
export function QuickAddParty({
  kind,
  initialName,
  onCreated,
  onCancel,
}: {
  kind: "customer" | "supplier";
  initialName: string;
  /** The new (or chosen) customer / supplier id and name, ready to put on the bill. */
  onCreated: (id: string, label: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(initialName);
  const [phone, setPhone] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<PartyMatch[]>([]);
  const relationship = kind === "customer" ? "CUSTOMER" : "SUPPLIER";
  const word = kind === "customer" ? "customer" : "supplier";

  const finish = (id: string, label: string) => {
    queryClient.invalidateQueries({ queryKey: [kind] });
    queryClient.invalidateQueries({ queryKey: ["parties"] });
    onCreated(id, label);
  };

  const save = async (allowDuplicate = false) => {
    if (name.trim().length < 2) return setError("Enter at least 2 characters");
    if (phone.trim() && !/^[+]?[0-9\s-]{7,20}$/.test(phone.trim())) return setError("Enter a valid mobile number");
    setPending(true);
    setError(null);
    try {
      const party = await partiesApi.create({
        name: name.trim(),
        phone: phone.trim() || null,
        relationship,
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      });
      const id = kind === "customer" ? party.customerId : party.supplierId;
      if (id) finish(id, party.name);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PARTY_POSSIBLE_DUPLICATE") {
        const found = await partiesApi
          .possibleMatches({ name: name.trim(), phone: phone.trim() || undefined })
          .catch(() => []);
        if (found.length > 0) setMatches(found);
        else setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : `Could not add the ${word}`);
      }
    } finally {
      setPending(false);
    }
  };

  /** Use a party that already exists, giving it this side first if needed. */
  const chooseExisting = async (match: PartyMatch) => {
    setPending(true);
    try {
      let id = kind === "customer" ? match.party.customerId : match.party.supplierId;
      if (!id) {
        const updated = await partiesApi.addRelationship(match.party.id, relationship);
        id = kind === "customer" ? updated.customerId : updated.supplierId;
      }
      if (id) finish(id, match.party.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not use that party");
    } finally {
      setPending(false);
    }
  };

  if (matches.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">A similar party already exists</p>
        <ul className="space-y-2">
          {matches.map((match) => {
            const hasSide = kind === "customer" ? match.party.customerId : match.party.supplierId;
            return (
              <li key={match.party.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-[44px] w-full justify-between gap-2 whitespace-normal text-left"
                  disabled={pending}
                  onClick={() => chooseExisting(match)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{match.party.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {match.party.phone ?? "No mobile"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-normal text-primary">
                    {hasSide ? "Use this" : `Use & make ${word}`}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setMatches([])} disabled={pending}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button type="button" variant="secondary" onClick={() => save(true)} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            No, add as new {word}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="qa-name">Name</Label>
        <Input id="qa-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="qa-phone">Mobile (optional)</Label>
        <Input id="qa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">Address, GSTIN and payment terms can be added later.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Button>
        <Button type="submit" disabled={pending} className="min-h-[44px] sm:min-h-0">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add {word}
        </Button>
      </div>
    </form>
  );
}
