"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Building2, ChevronRight, Loader2, Receipt, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { ApiError, companyApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { ROUTES } from "@/lib/constants";
import { stripBodyPrefix } from "@/lib/utils";
import type { CompanySettings } from "@/types/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Field } from "@/components/shared/form-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { gstRegistrationApi } from "@/features/gst/api";
import { StoresSection } from "./stores-section";

/**
 * Business settings.
 *
 * WHERE EACH FIELD IS SAVED, because the backend splits them:
 *   business name ................ PATCH /companies/:id
 *   legal name, address .......... PATCH /tax/profile (the registration record)
 *   numbering, dates, year ....... PATCH /company-settings
 * All three are shop-owner only on the backend. Staff see the same screen
 * with every field read-only, and a line saying who can change it.
 */

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" }),
);

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

function useFieldErrors() {
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const fromError = (err: unknown, fallbackTitle: string) => {
    if (err instanceof ApiError && err.fieldErrors?.length) {
      const next: Record<string, string> = {};
      for (const item of err.fieldErrors) next[stripBodyPrefix(item.field)] = item.message;
      setErrors(next);
      return;
    }
    toast.error(fallbackTitle, { description: err instanceof ApiError ? err.message : undefined });
  };
  return { errors, setErrors, fromError };
}

export function BusinessSettings() {
  const { can } = useAuth();
  const canEdit = can("settings.manage");

  return (
    <div className="space-y-6">
      <PageHeader title="Business settings" description="How your business is set up in Byapar." />

      {!canEdit ? (
        <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-muted-foreground">
          You can see these settings but not change them. Only the shop owner can make changes.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <BusinessProfileCard canEdit={canEdit} />
        <InvoiceSettingsCard canEdit={canEdit} />
      </div>

      <StoresSection />

      <div className="grid gap-4 lg:grid-cols-2">
        <GstCard />
        {canEdit ? <MoreSettingsCard /> : null}
      </div>
    </div>
  );
}

// --- business profile --------------------------------------------------------

function BusinessProfileCard({ canEdit }: { canEdit: boolean }) {
  const { company, gstProfile, refresh } = useAuth();
  const queryClient = useQueryClient();
  const { errors, setErrors, fromError } = useFieldErrors();

  const original = React.useMemo(
    () => ({
      name: company?.name ?? "",
      legalName: (gstProfile?.legalName as string | null | undefined) ?? company?.legalName ?? "",
      registeredAddress:
        (gstProfile?.registeredAddress as string | null | undefined) ?? company?.registeredAddress ?? "",
    }),
    [company, gstProfile],
  );
  const [form, setForm] = React.useState(original);
  React.useEffect(() => setForm(original), [original]);

  const nameChanged = form.name.trim() !== original.name;
  const legalChanged = form.legalName.trim() !== original.legalName;
  const addressChanged = form.registeredAddress.trim() !== original.registeredAddress;
  const hasChanges = nameChanged || legalChanged || addressChanged;

  const save = useMutation({
    mutationFn: async () => {
      if (!company) throw new Error("Your business could not be loaded.");
      if (nameChanged) await companyApi.update(company.id, { name: form.name.trim() });
      if (legalChanged || addressChanged) {
        await gstRegistrationApi.update({
          ...(legalChanged ? { legalName: form.legalName.trim() || null } : {}),
          ...(addressChanged ? { registeredAddress: form.registeredAddress.trim() || null } : {}),
        });
      }
    },
    onSuccess: async () => {
      toast.success("Business details saved");
      setErrors({});
      queryClient.invalidateQueries({ queryKey: ["gst-profile"] });
      await refresh();
    },
    onError: (err) => fromError(err, "Could not save business details"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" aria-hidden />
          Business profile
        </CardTitle>
        <CardDescription>Your shop as it appears on bills.</CardDescription>
      </CardHeader>
      <CardContent>
        {!company ? (
          <LoadingState rows={2} />
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (form.name.trim().length < 2) {
                setErrors({ name: "Business name must be at least 2 characters." });
                return;
              }
              save.mutate();
            }}
          >
            <Field label="Business name" htmlFor="biz-name" required error={errors.name}>
              <Input
                id="biz-name"
                disabled={!canEdit}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Legal name" htmlFor="biz-legal" error={errors.legalName} hint="If different from the shop name">
              <Input
                id="biz-legal"
                disabled={!canEdit}
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </Field>
            <Field label="Address" htmlFor="biz-address" error={errors.registeredAddress}>
              <Textarea
                id="biz-address"
                rows={3}
                disabled={!canEdit}
                value={form.registeredAddress}
                onChange={(e) => setForm({ ...form, registeredAddress: e.target.value })}
              />
            </Field>
            {canEdit ? (
              <SaveRow
                pending={save.isPending}
                disabled={!hasChanges}
                onReset={() => {
                  setForm(original);
                  setErrors({});
                }}
              />
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// --- invoice settings --------------------------------------------------------

type EditableSettings = Pick<
  CompanySettings,
  "invoicePrefix" | "purchasePrefix" | "dateFormat" | "financialYearStartMonth"
>;

function InvoiceSettingsCard({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { errors, setErrors, fromError } = useFieldErrors();

  const settings = useQuery({ queryKey: ["company-settings"], queryFn: () => companyApi.getSettings() });

  const original = React.useMemo<EditableSettings | null>(
    () =>
      settings.data
        ? {
            invoicePrefix: settings.data.invoicePrefix,
            purchasePrefix: settings.data.purchasePrefix,
            dateFormat: settings.data.dateFormat,
            financialYearStartMonth: settings.data.financialYearStartMonth,
          }
        : null,
    [settings.data],
  );
  const [form, setForm] = React.useState<EditableSettings | null>(original);
  React.useEffect(() => setForm(original), [original]);

  const changes: Partial<EditableSettings> = {};
  if (form && original) {
    if (form.invoicePrefix.trim().toUpperCase() !== original.invoicePrefix) {
      changes.invoicePrefix = form.invoicePrefix.trim().toUpperCase();
    }
    if (form.purchasePrefix.trim().toUpperCase() !== original.purchasePrefix) {
      changes.purchasePrefix = form.purchasePrefix.trim().toUpperCase();
    }
    if (form.dateFormat !== original.dateFormat) changes.dateFormat = form.dateFormat;
    if (form.financialYearStartMonth !== original.financialYearStartMonth) {
      changes.financialYearStartMonth = form.financialYearStartMonth;
    }
  }
  const hasChanges = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => companyApi.updateSettings(changes),
    onSuccess: (updated) => {
      toast.success("Bill settings saved");
      setErrors({});
      queryClient.setQueryData(["company-settings"], updated);
    },
    onError: (err) => fromError(err, "Could not save bill settings"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-primary" aria-hidden />
          Bill settings
        </CardTitle>
        <CardDescription>Bill numbers, dates and your financial year.</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.error ? (
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        ) : !form || !settings.data ? (
          <LoadingState rows={3} />
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Sales bill prefix"
                htmlFor="set-inv"
                error={errors.invoicePrefix}
                hint="Used for new bills only"
              >
                <Input
                  id="set-inv"
                  disabled={!canEdit}
                  maxLength={10}
                  className="uppercase"
                  value={form.invoicePrefix}
                  onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field
                label="Purchase bill prefix"
                htmlFor="set-pur"
                error={errors.purchasePrefix}
                hint="Letters, numbers and hyphens"
              >
                <Input
                  id="set-pur"
                  disabled={!canEdit}
                  maxLength={10}
                  className="uppercase"
                  value={form.purchasePrefix}
                  onChange={(e) => setForm({ ...form, purchasePrefix: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Date format" htmlFor="set-date" error={errors.dateFormat}>
                <NativeSelect
                  id="set-date"
                  disabled={!canEdit}
                  value={form.dateFormat}
                  onChange={(e) => setForm({ ...form, dateFormat: e.target.value })}
                >
                  {DATE_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Financial year starts in" htmlFor="set-fy" error={errors.financialYearStartMonth}>
                <NativeSelect
                  id="set-fy"
                  disabled={!canEdit}
                  value={form.financialYearStartMonth}
                  onChange={(e) => setForm({ ...form, financialYearStartMonth: Number(e.target.value) })}
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Currency {settings.data.currency} · Timezone {settings.data.timezone}
              {settings.data.requireOpenPeriod !== undefined
                ? ` · Entries must fall in an open period: ${settings.data.requireOpenPeriod ? "yes" : "no"}`
                : ""}
            </div>

            {canEdit ? (
              <SaveRow
                pending={save.isPending}
                disabled={!hasChanges}
                onReset={() => {
                  setForm(original);
                  setErrors({});
                }}
              />
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// --- GST and links ------------------------------------------------------------

function GstCard() {
  const { gstProfile, isGstEnabled } = useAuth();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          GST
          <Badge variant={isGstEnabled ? "success" : "outline"} className="ml-auto">
            {isGstEnabled ? "On" : "Off"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {isGstEnabled
            ? `GSTIN ${gstProfile?.gstin ?? "not set"}${gstProfile?.stateName ? ` · ${gstProfile.stateName}` : ""}`
            : "GST is optional. Sales, purchases, stock, credit and expenses all work without it."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full justify-between sm:w-auto">
          <Link href={ROUTES.gstRegistration}>
            {isGstEnabled ? "GST registration details" : "Registered for GST? Switch it on"}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function MoreSettingsCard() {
  const links = [
    { href: ROUTES.staff, label: "Staff accounts", hint: "Who can sign in, and what they can do", icon: Users },
    { href: ROUTES.subscription, label: "Subscription", hint: "Your plan and renewal", icon: BadgeCheck },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">More settings</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y">
          {links.map(({ href, label, hint, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex min-h-[44px] items-center gap-3 rounded-md py-2.5 hover:text-primary"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SaveRow({ pending, disabled, onReset }: { pending: boolean; disabled: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" disabled={disabled || pending} onClick={onReset}>
        Undo changes
      </Button>
      <Button type="submit" disabled={disabled || pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save
      </Button>
    </div>
  );
}
