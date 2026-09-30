"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, partiesApi, type PartyMatch, type PartyRelationship } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DETAIL_ROUTES, ROUTES } from "@/lib/constants";
import { PartyMasterForm } from "./party-master-form";
import { RelationshipBadge } from "./relationship-badge";
import {
  EMPTY_PARTY_FORM,
  MATCH_REASON_LABEL,
  missingSides,
  toCreatePayload,
  type PartyFormValues,
} from "./party-payload";

const SIDE_LABEL = { CUSTOMER: "customer", SUPPLIER: "supplier" } as const;

/**
 * Add a party.
 *
 * NEVER A SILENT DUPLICATE. If the backend finds a party with the same mobile,
 * GSTIN, email or name, it refuses, and this page shows who it looks like. The
 * shop then chooses: use that party (adding the missing side if needed), or
 * create a new one anyway. Nothing is merged without somebody choosing it.
 */
export function NewPartyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const preset = searchParams?.get("relationship") as PartyRelationship | null;
  const initial: PartyFormValues = {
    ...EMPTY_PARTY_FORM,
    relationship: preset && ["CUSTOMER", "SUPPLIER", "BOTH"].includes(preset) ? preset : "CUSTOMER",
    name: searchParams?.get("name") ?? "",
  };

  const [pending, setPending] = React.useState(false);
  const [lastValues, setLastValues] = React.useState<PartyFormValues | null>(null);
  const [matches, setMatches] = React.useState<PartyMatch[]>([]);
  const [serverErrors, setServerErrors] = React.useState<Partial<Record<keyof PartyFormValues, string>>>();
  const [usingId, setUsingId] = React.useState<string | null>(null);

  const done = (id: string, message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: ["parties"] });
    queryClient.invalidateQueries({ queryKey: ["customer"] });
    queryClient.invalidateQueries({ queryKey: ["supplier"] });
    router.push(DETAIL_ROUTES.party(id));
  };

  const save = async (values: PartyFormValues, allowDuplicate = false) => {
    setPending(true);
    setLastValues(values);
    try {
      const saved = await partiesApi.create(toCreatePayload(values, allowDuplicate));
      setMatches([]);
      done(saved.id, `${saved.name} added`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PARTY_POSSIBLE_DUPLICATE") {
        // Ask for the matches in their typed shape rather than parsing the error.
        const found = await partiesApi
          .possibleMatches({
            name: values.name.trim(),
            phone: values.phone.trim() || undefined,
            email: values.email.trim() || undefined,
            gstin: values.gstin.trim() || undefined,
          })
          .catch(() => []);
        if (found.length > 0) setMatches(found);
        else toast.error(err.message);
      } else if (err instanceof ApiError && (err.code === "CUSTOMER_NAME_TAKEN" || err.code === "SUPPLIER_NAME_TAKEN")) {
        setServerErrors({ name: err.message });
      } else if (err instanceof ApiError && err.fieldErrors?.length) {
        const mapped: Partial<Record<keyof PartyFormValues, string>> = {};
        for (const item of err.fieldErrors) {
          const key = item.field.replace(/^body\./, "") as keyof PartyFormValues;
          if (key in EMPTY_PARTY_FORM) mapped[key] = item.message;
        }
        setServerErrors(mapped);
        toast.error("Please check the form", { description: err.fieldErrors[0]?.message });
      } else {
        toast.error("Could not add the party", { description: err instanceof ApiError ? err.message : undefined });
      }
    } finally {
      setPending(false);
    }
  };

  const chooseExisting = async (match: PartyMatch) => {
    if (!lastValues) return;
    setUsingId(match.party.id);
    try {
      // Give the existing party whichever side the shop was trying to add.
      for (const side of missingSides(lastValues.relationship, match.party.relationship)) {
        await partiesApi.addRelationship(match.party.id, side);
      }
      setMatches([]);
      done(match.party.id, `Using ${match.party.name}`);
    } catch (err) {
      toast.error("Could not use that party", { description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setUsingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href={ROUTES.parties}>
          <ArrowLeft className="h-4 w-4" />
          Parties
        </Link>
      </Button>

      <PageHeader
        title="Add party"
        description="Someone you sell to, buy from, or both. Only the name is needed."
      />

      <Card>
        <CardContent className="pt-6">
          <PartyMasterForm
            mode="create"
            initial={initial}
            pending={pending}
            submitLabel="Save party"
            serverErrors={serverErrors}
            onSubmit={(values) => save(values)}
            onCancel={() => router.push(ROUTES.parties)}
          />
        </CardContent>
      </Card>

      <Dialog open={matches.length > 0} onOpenChange={(open) => (!open ? setMatches([]) : undefined)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>A similar party already exists</DialogTitle>
            <DialogDescription>
              Use the one you already have, or add “{lastValues?.name.trim()}” as a new party.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2">
            {matches.map((match) => {
              const toAdd = lastValues ? missingSides(lastValues.relationship, match.party.relationship) : [];
              return (
                <li key={match.party.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{match.party.name}</span>
                    <RelationshipBadge relationship={match.party.relationship} />
                    {!match.party.isActive ? <span className="text-xs text-muted-foreground">(inactive)</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[match.party.phone, match.party.gstin].filter(Boolean).join(" · ") || "No mobile"}
                    {" — "}
                    {match.reasons.map((reason) => MATCH_REASON_LABEL[reason]).join(", ")}
                  </p>
                  <Button
                    size="sm"
                    className="mt-2 min-h-[40px] w-full sm:w-auto"
                    disabled={usingId !== null}
                    onClick={() => chooseExisting(match)}
                  >
                    {usingId === match.party.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {toAdd.length > 0
                      ? `Use this party (also make them a ${toAdd.map((s) => SIDE_LABEL[s]).join(" and ")})`
                      : "Use this party"}
                  </Button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setMatches([])} className="min-h-[44px] sm:min-h-0">
              Go back
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => lastValues && save(lastValues, true)}
              className="min-h-[44px] sm:min-h-0"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create new party
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
