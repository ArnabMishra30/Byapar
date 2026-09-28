"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CheckCircle2, FileText, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ApiError, gstApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { ROUTES } from "@/lib/constants";
import { stripBodyPrefix } from "@/lib/utils";
import type { GstProfile, GstRegistrationType } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { REGISTRATION_TYPES, gstRegistrationApi, registrationLabel, type GstProfileUpdate } from "./api";

/**
 * GST registration.
 *
 * WHAT TURNS GST ON. The backend switches GST on for a business the moment a
 * GST state is set on it, and off again when the state is cleared. Everything
 * else here (GSTIN, legal name, address, registration type) describes the
 * registration. That rule is the backend's; this screen only explains it.
 *
 * The GSTIN check below is the backend's format and checksum test. It cannot
 * tell whether a GSTIN is actually active on the portal, and it says so.
 *
 * Reachable for every shop, registered or not: this is where a shop that has
 * just registered comes to switch GST on. Staff see it read-only.
 */

interface FormState {
  registrationType: GstRegistrationType;
  gstin: string;
  legalName: string;
  stateCode: string;
  registeredAddress: string;
}

const NEEDS_GSTIN = new Set<GstRegistrationType>(["REGULAR", "COMPOSITION", "SEZ"]);

function fromProfile(profile: GstProfile | undefined): FormState {
  return {
    registrationType: (profile?.registrationType as GstRegistrationType) ?? "UNREGISTERED",
    gstin: profile?.gstin ?? "",
    legalName: (profile?.legalName as string | null) ?? "",
    stateCode: profile?.stateCode ?? "",
    registeredAddress: (profile?.registeredAddress as string | null) ?? "",
  };
}

/** Only what changed, with blanks sent as null so a field can be cleared. */
function diff(form: FormState, original: FormState): GstProfileUpdate {
  const out: GstProfileUpdate = {};
  const blank = (value: string) => (value.trim() === "" ? null : value.trim());
  if (form.registrationType !== original.registrationType) out.registrationType = form.registrationType;
  if (form.gstin.trim().toUpperCase() !== original.gstin) out.gstin = blank(form.gstin.toUpperCase());
  if (form.legalName.trim() !== original.legalName) out.legalName = blank(form.legalName);
  if (form.stateCode !== original.stateCode) out.stateCode = blank(form.stateCode);
  if (form.registeredAddress.trim() !== original.registeredAddress) {
    out.registeredAddress = blank(form.registeredAddress);
  }
  return out;
}

export function GstPage() {
  const queryClient = useQueryClient();
  const { can, refresh } = useAuth();
  const canEdit = can("gst.manage");

  const profile = useQuery({ queryKey: ["gst-profile"], queryFn: () => gstApi.getProfile() });
  const states = useQuery({
    queryKey: ["gst-states"],
    queryFn: () => gstRegistrationApi.states(),
    staleTime: Infinity,
  });

  const original = React.useMemo(() => fromProfile(profile.data), [profile.data]);
  const [form, setForm] = React.useState<FormState>(original);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // When the saved profile arrives (or is saved), the form starts from it.
  React.useEffect(() => setForm(original), [original]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  // The live GSTIN check fires only once a full 15-character value is typed.
  const gstinValue = form.gstin.trim().toUpperCase();
  const [debouncedGstin, setDebouncedGstin] = React.useState(gstinValue);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedGstin(gstinValue), 300);
    return () => clearTimeout(timer);
  }, [gstinValue]);

  const gstinCheck = useQuery({
    queryKey: ["gstin-check", debouncedGstin],
    queryFn: () => gstRegistrationApi.validateGstin(debouncedGstin),
    enabled: canEdit && debouncedGstin.length === 15 && debouncedGstin !== original.gstin,
    staleTime: Infinity,
    retry: false,
  });

  // A valid GSTIN names its own state; fill it in when none is chosen yet.
  const checkedState = gstinCheck.data?.valid ? gstinCheck.data.stateCode : null;
  React.useEffect(() => {
    if (checkedState) setForm((current) => (current.stateCode ? current : { ...current, stateCode: checkedState }));
  }, [checkedState]);

  const changes = diff(form, original);
  const hasChanges = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => gstRegistrationApi.update(changes),
    onSuccess: async (updated) => {
      setConfirmOpen(false);
      toast.success(updated.gstEnabled ? "GST details saved" : "Saved. GST is off for this business.");
      queryClient.setQueryData(["gst-profile"], updated);
      // The whole app reads "is GST on?" from the session, so reload it.
      await refresh();
      queryClient.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (err) => {
      setConfirmOpen(false);
      if (err instanceof ApiError && err.fieldErrors?.length) {
        const next: Record<string, string> = {};
        for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
        setErrors(next);
        return;
      }
      toast.error("Could not save GST details", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (NEEDS_GSTIN.has(form.registrationType) && !gstinValue) {
      next.gstin = `A ${registrationLabel(form.registrationType)} registration needs a GSTIN.`;
    }
    if (gstinValue && gstinValue.length !== 15) next.gstin = "A GSTIN is exactly 15 characters.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setConfirmOpen(true);
  };

  const data = profile.data;
  const stateMismatch =
    gstinCheck.data?.valid && gstinCheck.data.stateCode && form.stateCode && gstinCheck.data.stateCode !== form.stateCode;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST registration"
        description="Your GST details. They decide how tax is worked out on new bills."
        actions={
          data ? (
            <Badge variant={data.gstEnabled ? "success" : "outline"}>
              {data.gstEnabled ? "GST on" : "GST off"}
            </Badge>
          ) : null
        }
      />

      {profile.error ? (
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      ) : profile.isLoading || !data ? (
        <LoadingState rows={3} />
      ) : (
        <>
          <Card className={data.gstEnabled ? "border-success/30 bg-success/5" : "bg-muted/30"}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  className={data.gstEnabled ? "mt-0.5 h-5 w-5 shrink-0 text-success" : "mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"}
                  aria-hidden
                />
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-foreground">
                    {data.gstEnabled
                      ? `GST is on${data.stateName ? ` · ${data.stateName}` : ""}`
                      : "GST is off"}
                  </p>
                  <p className="text-muted-foreground">
                    {data.gstEnabled
                      ? "New sales and purchases work out CGST/SGST or IGST from your state and the party's."
                      : "Your shop works fully without GST. To switch it on, choose your GST state below and save."}
                  </p>
                </div>
              </div>
              {data.gstEnabled ? (
                <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
                  <Link href={ROUTES.gstReport}>
                    <FileText className="h-4 w-4" />
                    GST reports
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {!canEdit ? (
            <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground">
              Only the shop owner can change GST details. You can see them here.
            </div>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Registration details</CardTitle>
              <CardDescription>As printed on your GST registration certificate.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} noValidate className="space-y-6">
                <FormSection>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Registration type"
                      htmlFor="gst-type"
                      error={errors.registrationType}
                      hint={REGISTRATION_TYPES.find((t) => t.value === form.registrationType)?.hint}
                    >
                      <NativeSelect
                        id="gst-type"
                        disabled={!canEdit}
                        value={form.registrationType}
                        onChange={(e) => set("registrationType", e.target.value as GstRegistrationType)}
                      >
                        {REGISTRATION_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>

                    <Field
                      label="GSTIN"
                      htmlFor="gst-gstin"
                      required={NEEDS_GSTIN.has(form.registrationType)}
                      error={errors.gstin}
                    >
                      <Input
                        id="gst-gstin"
                        disabled={!canEdit}
                        value={form.gstin}
                        maxLength={15}
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="e.g. 27AAAAA0000A1Z5"
                        className="font-mono uppercase"
                        onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                      />
                      <GstinStatus
                        checking={gstinCheck.isFetching}
                        result={gstinCheck.data}
                        failed={Boolean(gstinCheck.error)}
                        savedChecksumValid={
                          gstinValue === original.gstin ? (data.gstinChecksumValid as boolean | null | undefined) : undefined
                        }
                      />
                    </Field>

                    <Field
                      label="GST state"
                      htmlFor="gst-state"
                      error={errors.stateCode}
                      hint="Setting a state switches GST on. Clearing it switches GST off."
                    >
                      <NativeSelect
                        id="gst-state"
                        disabled={!canEdit || states.isLoading}
                        value={form.stateCode}
                        onChange={(e) => set("stateCode", e.target.value)}
                      >
                        <option value="">Not set (GST off)</option>
                        {(states.data ?? []).map((state) => (
                          <option key={state.code} value={state.code}>
                            {state.code} · {state.name}
                          </option>
                        ))}
                      </NativeSelect>
                      {stateMismatch ? (
                        <p className="text-xs text-warning">
                          This GSTIN belongs to {gstinCheck.data?.stateName ?? gstinCheck.data?.stateCode}. The backend
                          will refuse a different state.
                        </p>
                      ) : null}
                    </Field>

                    <Field label="Legal name" htmlFor="gst-legal" error={errors.legalName} hint="The name on the certificate">
                      <Input
                        id="gst-legal"
                        disabled={!canEdit}
                        value={form.legalName}
                        onChange={(e) => set("legalName", e.target.value)}
                      />
                    </Field>
                  </div>

                  <Field label="Registered address" htmlFor="gst-address" error={errors.registeredAddress}>
                    <Textarea
                      id="gst-address"
                      rows={3}
                      disabled={!canEdit}
                      value={form.registeredAddress}
                      onChange={(e) => set("registeredAddress", e.target.value)}
                    />
                  </Field>
                </FormSection>

                {canEdit ? (
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!hasChanges || save.isPending}
                      onClick={() => {
                        setForm(original);
                        setErrors({});
                      }}
                    >
                      Undo changes
                    </Button>
                    <Button type="submit" disabled={!hasChanges || save.isPending} className="gap-1.5">
                      {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                      Save GST details
                    </Button>
                  </div>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Save GST details?"
        confirmLabel="Save"
        isPending={save.isPending}
        onConfirm={() => save.mutate()}
        description={
          <div className="space-y-2">
            <p>
              This changes how tax is worked out on <strong>new</strong> sales and purchases. Bills already posted
              keep the tax they were posted with.
            </p>
            {changes.stateCode === null ? (
              <p className="font-medium text-warning">Clearing the state switches GST off for this business.</p>
            ) : null}
            {changes.stateCode && !original.stateCode ? (
              <p className="font-medium text-foreground">Setting a state switches GST on for this business.</p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

function GstinStatus({
  checking,
  result,
  failed,
  savedChecksumValid,
}: {
  checking: boolean;
  result: { valid: boolean; reason: string | null; stateName: string | null; note?: string } | undefined;
  failed: boolean;
  savedChecksumValid: boolean | null | undefined;
}) {
  if (checking) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking GSTIN…
      </p>
    );
  }
  if (savedChecksumValid === false) {
    return <p className="text-xs text-warning">The saved GSTIN does not pass the checksum. Please check it.</p>;
  }
  if (failed) return <p className="text-xs text-muted-foreground">Could not check the GSTIN right now.</p>;
  if (!result) return null;
  return result.valid ? (
    <p className="flex items-start gap-1.5 text-xs text-success">
      <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        Looks right{result.stateName ? ` · ${result.stateName}` : ""}. {result.note}
      </span>
    </p>
  ) : (
    <p className="flex items-start gap-1.5 text-xs text-destructive">
      <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{result.reason ?? "This GSTIN does not look right."}</span>
    </p>
  );
}
