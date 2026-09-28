"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Field, FormSection } from "@/components/shared/form-parts";
import { GstOnly } from "@/components/shared/gst-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { INDIAN_STATES } from "@/lib/constants";
import { cn, stripBodyPrefix } from "@/lib/utils";
import {
  EMPTY_PARTY,
  REGISTRATION_TYPES,
  partySchema,
  toPartyPayload,
  type PartyFormValues,
} from "@/features/customers/party-rules";
import type { Customer } from "@/types/api";

/**
 * The one form for adding or editing a customer or supplier.
 *
 * Used by the Add Customer page, the Add Supplier dialog and the Edit dialog on
 * both detail pages, so the rules and the wording are written once.
 *
 * SIMPLE FIRST. Name, phone, email and address are all most shops ever fill
 * in. GST details and credit terms sit behind "More details", opened
 * automatically when editing a record that already has any of them.
 */
export function PartyForm({
  kind,
  mode,
  initial,
  save,
  onSaved,
  onCancel,
  submitLabel = "Save",
}: {
  kind: "customer" | "supplier";
  mode: "create" | "update";
  initial?: PartyFormValues;
  /** Sends the body to the backend. */
  save: (body: Partial<Customer>) => Promise<Customer>;
  onSaved: (saved: Customer) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { isGstEnabled } = useAuth();
  const defaults = initial ?? EMPTY_PARTY;
  const hasExtra = Boolean(
    defaults.gstin || defaults.stateCode || defaults.creditLimit || defaults.creditDays || defaults.openingBalance,
  );
  const [showMore, setShowMore] = React.useState(hasExtra);
  const [pending, setPending] = React.useState(false);

  const form = useForm<PartyFormValues>({
    resolver: zodResolver(partySchema),
    defaultValues: defaults,
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setPending(true);
    try {
      const saved = await save(toPartyPayload(values, { mode, includeGst: isGstEnabled }));
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.length) {
        let placed = false;
        for (const item of err.fieldErrors) {
          const field = stripBodyPrefix(item.field) as keyof PartyFormValues;
          if (field in EMPTY_PARTY) {
            form.setError(field, { message: item.message });
            placed = true;
            // A backend error on a hidden field must be visible.
            if (field !== "name" && field !== "phone" && field !== "email" && field !== "address") {
              setShowMore(true);
            }
          }
        }
        toast.error("Please check the form", {
          description: placed ? undefined : err.fieldErrors[0]?.message,
        });
      } else if (err instanceof ApiError && err.status === 409) {
        form.setError("name", { message: `A ${kind} with this name already exists` });
        toast.error(err.message);
      } else {
        toast.error(`Could not save ${kind}`, {
          description: err instanceof ApiError ? err.message : undefined,
        });
      }
    } finally {
      setPending(false);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <FormSection>
        <Field label="Name" htmlFor="party-name" required error={errors.name?.message}>
          <Input id="party-name" autoFocus autoComplete="off" {...form.register("name")} />
        </Field>
        <Field label="Phone" htmlFor="party-phone" error={errors.phone?.message}>
          <Input id="party-phone" type="tel" inputMode="tel" {...form.register("phone")} />
        </Field>
        <Field label="Email" htmlFor="party-email" error={errors.email?.message}>
          <Input id="party-email" type="email" inputMode="email" {...form.register("email")} />
        </Field>
        <Field label="Address" htmlFor="party-address" error={errors.address?.message}>
          <Textarea id="party-address" rows={2} className="min-h-[64px]" {...form.register("address")} />
        </Field>
      </FormSection>

      <div className="rounded-lg border">
        <button
          type="button"
          onClick={() => setShowMore((open) => !open)}
          aria-expanded={showMore}
          className="flex min-h-[44px] w-full items-center justify-between px-3 text-left text-sm font-medium"
        >
          <span>
            More details
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {isGstEnabled ? "GST, credit terms" : "Credit terms"}
            </span>
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} aria-hidden />
        </button>

        {/* Kept mounted (only hidden) so typed values survive closing it. */}
        <div className={cn("space-y-5 border-t p-3", !showMore && "hidden")}>
          {/* Only a GST-registered business ever sees a GSTIN box. */}
          <GstOnly>
            <FormSection title="GST" description="Optional. Needed only for GST invoices to this party.">
              <Field label="GSTIN" htmlFor="party-gstin" error={errors.gstin?.message}>
                <Input id="party-gstin" className="uppercase" autoComplete="off" {...form.register("gstin")} />
              </Field>
              <Field label="State" htmlFor="party-state" error={errors.stateCode?.message}>
                <NativeSelect id="party-state" {...form.register("stateCode")}>
                  <option value="">Not set</option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Registration type"
                htmlFor="party-regtype"
                error={errors.gstRegistrationType?.message}
              >
                <NativeSelect id="party-regtype" {...form.register("gstRegistrationType")}>
                  <option value="">Not set</option>
                  {REGISTRATION_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </FormSection>
          </GstOnly>

          <FormSection
            title="Credit terms"
            description={
              kind === "customer"
                ? "How much credit you give, and how many days they get to pay."
                : "How many days this supplier gives you to pay."
            }
          >
            {kind === "customer" ? (
              <Field
                label="Credit limit"
                htmlFor="party-limit"
                hint="Blank or 0 means no limit"
                error={errors.creditLimit?.message}
              >
                <Input id="party-limit" inputMode="decimal" placeholder="0" {...form.register("creditLimit")} />
              </Field>
            ) : null}
            <Field
              label="Payment days"
              htmlFor="party-days"
              hint="Used to set due dates on bills"
              error={errors.creditDays?.message}
            >
              <Input id="party-days" inputMode="numeric" placeholder="30" {...form.register("creditDays")} />
            </Field>
            <Field
              label="Opening balance"
              htmlFor="party-opening"
              hint="Kept on the record for reference. To bring an old balance into your books, use Opening balance under Accounting."
              error={errors.openingBalance?.message}
            >
              <Input id="party-opening" inputMode="decimal" placeholder="0" {...form.register("openingBalance")} />
            </Field>
          </FormSection>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="min-h-[44px] sm:min-h-0">
            Cancel
          </Button>
        ) : null}
        {/* Disabled while in flight, so a double tap cannot create two. */}
        <Button type="submit" disabled={pending} className="min-h-[44px] sm:min-h-0">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
