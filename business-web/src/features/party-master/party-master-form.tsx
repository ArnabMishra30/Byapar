"use client";

import * as React from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Field, FormSection } from "@/components/shared/form-parts";
import { GstOnly } from "@/components/shared/gst-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select-native";
import { INDIAN_STATES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { validatePartyForm, type PartyFormValues } from "./party-payload";

/**
 * The party form, for adding and for editing.
 *
 * ONE KIND OF PARTY. The shop no longer chooses "customer, supplier or both" -
 * a new party is simply a party, usable for selling and buying alike, with its
 * two balances kept apart by the backend. Name and mobile are all most shops
 * fill in; address, GSTIN, PAN and payment days sit behind "More details".
 */
export function PartyMasterForm({
  mode,
  initial,
  sides,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
  serverErrors,
}: {
  mode: "create" | "update";
  initial: PartyFormValues;
  /** On edit, which sides the party has, so only their terms are shown. */
  sides?: { isCustomer: boolean; isSupplier: boolean };
  pending: boolean;
  submitLabel: string;
  onSubmit: (values: PartyFormValues) => void;
  onCancel?: () => void;
  serverErrors?: Partial<Record<keyof PartyFormValues, string>>;
}) {
  const [values, setValues] = React.useState<PartyFormValues>(initial);
  const [errors, setErrors] = React.useState<Partial<Record<keyof PartyFormValues, string>>>({});
  const hasExtra = Boolean(
    initial.address || initial.gstin || initial.pan || initial.city || initial.contactPerson || initial.notes,
  );
  const [showMore, setShowMore] = React.useState(hasExtra);

  React.useEffect(() => {
    if (serverErrors && Object.keys(serverErrors).length > 0) {
      setErrors(serverErrors);
      setShowMore(true);
    }
  }, [serverErrors]);

  const set = (key: keyof PartyFormValues) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const isCustomer = mode === "create" ? values.relationship !== "SUPPLIER" : Boolean(sides?.isCustomer);
  const isSupplier = mode === "create" ? values.relationship !== "CUSTOMER" : Boolean(sides?.isSupplier);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validatePartyForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const visible: (keyof PartyFormValues)[] = ["name", "phone", "email"];
      if (Object.keys(found).some((key) => !visible.includes(key as keyof PartyFormValues))) setShowMore(true);
      return;
    }
    onSubmit(values);
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {mode === "create" && values.relationship === "BOTH" ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          You can sell to this party and buy from them. What they owe you and what you owe them are
          kept as two separate balances.
        </p>
      ) : null}

      <FormSection>
        <Field label="Party name" htmlFor="pm-name" required error={errors.name}>
          <Input id="pm-name" autoFocus autoComplete="off" value={values.name} onChange={set("name")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Mobile" htmlFor="pm-phone" error={errors.phone}>
            <Input id="pm-phone" type="tel" inputMode="tel" value={values.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email" htmlFor="pm-email" error={errors.email}>
            <Input id="pm-email" type="email" inputMode="email" value={values.email} onChange={set("email")} />
          </Field>
        </div>
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
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">Address, tax IDs, payment days</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} aria-hidden />
        </button>

        {/* Kept mounted (only hidden) so typed values survive closing it. */}
        <div className={cn("space-y-5 border-t p-3", !showMore && "hidden")}>
          <FormSection title="Contact">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact person" htmlFor="pm-contact" error={errors.contactPerson}>
                <Input id="pm-contact" value={values.contactPerson} onChange={set("contactPerson")} />
              </Field>
              <Field label="Other mobile" htmlFor="pm-alt" error={errors.alternatePhone}>
                <Input id="pm-alt" type="tel" inputMode="tel" value={values.alternatePhone} onChange={set("alternatePhone")} />
              </Field>
            </div>
            <Field label="Address" htmlFor="pm-address" error={errors.address}>
              <Textarea id="pm-address" rows={2} className="min-h-[64px]" value={values.address} onChange={set("address")} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="City" htmlFor="pm-city" error={errors.city}>
                <Input id="pm-city" value={values.city} onChange={set("city")} />
              </Field>
              <Field label="State" htmlFor="pm-state" error={errors.stateCode}>
                <NativeSelect id="pm-state" value={values.stateCode} onChange={set("stateCode")}>
                  <option value="">Not set</option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Pincode" htmlFor="pm-pin" error={errors.pincode}>
                <Input id="pm-pin" inputMode="numeric" value={values.pincode} onChange={set("pincode")} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Tax IDs" description="Optional. Leave blank if they are not registered.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Only a GST-registered shop is asked for a GSTIN. */}
              <GstOnly>
                <Field label="GSTIN" htmlFor="pm-gstin" error={errors.gstin}>
                  <Input id="pm-gstin" className="uppercase" autoComplete="off" value={values.gstin} onChange={set("gstin")} />
                </Field>
              </GstOnly>
              <Field label="PAN" htmlFor="pm-pan" error={errors.pan}>
                <Input id="pm-pan" className="uppercase" autoComplete="off" value={values.pan} onChange={set("pan")} />
              </Field>
            </div>
          </FormSection>

          {isCustomer || isSupplier ? (
            <FormSection title="Payment terms">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {isCustomer ? (
                  <>
                    <Field
                      label="Days they get to pay you"
                      htmlFor="pm-cdays"
                      hint="Sets due dates on your sales to them"
                      error={errors.customerCreditDays}
                    >
                      <Input id="pm-cdays" inputMode="numeric" placeholder="e.g. 15" value={values.customerCreditDays} onChange={set("customerCreditDays")} />
                    </Field>
                    <Field
                      label="Credit limit"
                      htmlFor="pm-climit"
                      hint="Most they may owe you. Blank means no limit"
                      error={errors.customerCreditLimit}
                    >
                      <Input id="pm-climit" inputMode="decimal" placeholder="0" value={values.customerCreditLimit} onChange={set("customerCreditLimit")} />
                    </Field>
                  </>
                ) : null}
                {isSupplier ? (
                  <Field
                    label="Days you get to pay them"
                    htmlFor="pm-sdays"
                    hint="Sets due dates on their bills"
                    error={errors.supplierCreditDays}
                  >
                    <Input id="pm-sdays" inputMode="numeric" placeholder="e.g. 30" value={values.supplierCreditDays} onChange={set("supplierCreditDays")} />
                  </Field>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          <Field label="Notes" htmlFor="pm-notes" error={errors.notes}>
            <Textarea id="pm-notes" rows={2} className="min-h-[64px]" value={values.notes} onChange={set("notes")} />
          </Field>
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
