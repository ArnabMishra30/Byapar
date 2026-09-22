"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { platformApi } from "@/lib/api/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDIAN_STATES } from "@/lib/constants";
import { Loader2, CheckCircle2, Copy, Info } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

// REGISTERING A SHOP.
//
// One form, one request, one transaction on the server: the business, the
// owner's login, the chart of accounts, the subscription and the cash. A rep is
// standing in the shop while they fill this in, so it asks for the least it can
// and everything optional is genuinely optional.
//
// GST IS OFF BY DEFAULT. Most small shops are not registered, and turning this
// into a required field would lock out the people the product is for.

const onboardSchema = z
  .object({
    name: z.string().min(2, "The business needs a name").max(150),
    phone: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    pincode: z.string().optional(),

    ownerName: z.string().min(2, "The owner needs a name").max(150),
    ownerEmail: z.string().email("A valid email is needed to sign in"),
    ownerPassword: z.string().min(8, "At least 8 characters"),

    hasGst: z.boolean(),
    gstin: z.string().optional(),
    stateCode: z.string().optional(),

    planId: z.string().optional(),
    collectPayment: z.boolean(),
    paymentAmount: z.string().optional(),
    paymentMethod: z.string().optional(),
    paymentReference: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.pincode && !/^[0-9]{6}$/.test(values.pincode)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pincode"], message: "Pincode is 6 digits" });
    }

    // Only enforced when the shop says it IS registered.
    if (values.hasGst) {
      if (!values.gstin || values.gstin.trim().length !== 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gstin"],
          message: "A GSTIN is 15 characters",
        });
      }
      if (!values.stateCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stateCode"],
          message: "Choose the state",
        });
      }
    }

    if (values.collectPayment) {
      if (!values.planId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["planId"],
          message: "Choose a plan before recording a payment",
        });
      }
      if (!values.paymentAmount || !/^\d+(\.\d{1,2})?$/.test(values.paymentAmount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentAmount"],
          message: "Enter the amount collected",
        });
      }
    }
  });

type OnboardValues = z.infer<typeof onboardSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

export function OnboardBusinessDialog({ open, onOpenChange, onDone }: Props) {
  const [result, setResult] = useState<{
    businessName: string;
    ownerEmail: string;
    plan: string | null;
    endDate: string | null;
  } | null>(null);

  const { data: plans } = useQuery({
    queryKey: ["platform", "plans", "sellable"],
    queryFn: () => platformApi.listPlans({ isActive: true, limit: 100 }),
    enabled: open,
  });

  const form = useForm<OnboardValues>({
    resolver: zodResolver(onboardSchema),
    defaultValues: {
      name: "",
      phone: "",
      city: "",
      pincode: "",
      ownerName: "",
      ownerEmail: "",
      ownerPassword: "",
      hasGst: false,
      gstin: "",
      stateCode: "",
      planId: undefined,
      collectPayment: false,
      paymentAmount: "",
      paymentMethod: "CASH",
      paymentReference: "",
    },
  });

  const hasGst = form.watch("hasGst");
  const collectPayment = form.watch("collectPayment");
  const selectedPlanId = form.watch("planId");
  const selectedPlan = plans?.data.find((plan) => plan.id === selectedPlanId);

  const mutation = useMutation({
    mutationFn: (values: OnboardValues) =>
      platformApi.onboardBusiness({
        name: values.name,
        phone: values.phone || null,
        city: values.city || null,
        pincode: values.pincode || null,
        // Both are sent only when the shop actually is registered. Leaving them
        // out is what keeps GST switched off for this business permanently.
        gstin: values.hasGst ? values.gstin?.toUpperCase() : null,
        stateCode: values.hasGst ? values.stateCode : null,
        owner: {
          name: values.ownerName,
          email: values.ownerEmail,
          password: values.ownerPassword,
        },
        planId: values.planId || undefined,
        payment:
          values.collectPayment && values.paymentAmount
            ? {
                amount: values.paymentAmount,
                method: values.paymentMethod || "CASH",
                reference: values.paymentReference || null,
              }
            : undefined,
      }),
    onSuccess: (data) => {
      toast.success(`${data.business.name} is registered`);
      setResult({
        businessName: data.business.name,
        ownerEmail: data.owner.email,
        plan: data.subscription?.plan ?? null,
        endDate: data.subscription?.endDate ?? null,
      });
      form.reset();
      onDone?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const close = () => {
    setResult(null);
    form.reset();
    onOpenChange(false);
  };

  // The success panel. A rep needs to read the login back to the owner, so it
  // stays on screen until they close it.
  if (result) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-2">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <DialogTitle>{result.businessName} is ready</DialogTitle>
            <DialogDescription>
              Give the owner these details. They can sign in to the business app straight away.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Sign in with</span>
              <span className="font-medium flex items-center gap-2">
                {result.ownerEmail}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    navigator.clipboard?.writeText(result.ownerEmail);
                    toast.success("Email copied");
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
            {result.plan && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">
                  {result.plan}
                  {result.endDate ? ` — until ${result.endDate}` : ""}
                </span>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            The password is the one you just typed. It is not shown again, so make sure the owner
            has it before you close this.
          </p>

          <DialogFooter>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register a business</DialogTitle>
          <DialogDescription>
            This creates the shop, its owner&apos;s login and its books in one go.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-5"
        >
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              The shop
            </h3>

            <div className="space-y-2">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" placeholder="Ramesh Medical Store" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" inputMode="tel" {...form.register("phone")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" {...form.register("city")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pincode">Pincode</Label>
                <Input id="pincode" inputMode="numeric" {...form.register("pincode")} />
                {form.formState.errors.pincode && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.pincode.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              The owner&apos;s login
            </h3>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ownerName">Owner name</Label>
                <Input id="ownerName" {...form.register("ownerName")} />
                {form.formState.errors.ownerName && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.ownerName.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerEmail">Email</Label>
                <Input id="ownerEmail" type="email" {...form.register("ownerEmail")} />
                {form.formState.errors.ownerEmail && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.ownerEmail.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ownerPassword">Password</Label>
              <Input id="ownerPassword" type="text" {...form.register("ownerPassword")} />
              <p className="text-xs text-muted-foreground">
                Shown as plain text on purpose &mdash; you need to read it out to the owner. They
                can change it later.
              </p>
              {form.formState.errors.ownerPassword && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.ownerPassword.message}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">GST registered?</h3>
                <p className="text-xs text-muted-foreground">
                  Leave this off if the shop has no GST number. Everything still works.
                </p>
              </div>
              <Switch
                checked={hasGst}
                onCheckedChange={(checked) => form.setValue("hasGst", checked)}
              />
            </div>

            {hasGst && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <Input
                    id="gstin"
                    className="font-mono uppercase"
                    maxLength={15}
                    {...form.register("gstin")}
                  />
                  {form.formState.errors.gstin && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.gstin.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Select
                    value={form.watch("stateCode")}
                    onValueChange={(value) => form.setValue("stateCode", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a state" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((state) => (
                        <SelectItem key={state.code} value={state.code}>
                          {state.code} &mdash; {state.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.stateCode && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.stateCode.message}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Subscription
            </h3>

            <div className="space-y-2">
              <Label>Plan (optional)</Label>
              <Select
                value={form.watch("planId") ?? ""}
                onValueChange={(value) => {
                  form.setValue("planId", value);
                  // Pre-fill the amount with the plan's price. A rep can change
                  // it if the shop paid something else.
                  const plan = plans?.data.find((item) => item.id === value);
                  if (plan) form.setValue("paymentAmount", plan.price);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No plan yet — sell one later" />
                </SelectTrigger>
                <SelectContent>
                  {plans?.data.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} &mdash; ₹{plan.price} for {plan.durationValue}{" "}
                      {plan.durationUnit.toLowerCase()}
                      {plan.durationValue > 1 ? "s" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.planId && (
                <p className="text-xs text-destructive">{form.formState.errors.planId.message}</p>
              )}
            </div>

            {selectedPlan && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Record a payment now</p>
                  <p className="text-xs text-muted-foreground">
                    Only if the shop is paying you today.
                  </p>
                </div>
                <Switch
                  checked={collectPayment}
                  onCheckedChange={(checked) => form.setValue("collectPayment", checked)}
                />
              </div>
            )}

            {collectPayment && (
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="paymentAmount">Amount (₹)</Label>
                  <Input
                    id="paymentAmount"
                    inputMode="decimal"
                    {...form.register("paymentAmount")}
                  />
                  {form.formState.errors.paymentAmount && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.paymentAmount.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select
                    value={form.watch("paymentMethod")}
                    onValueChange={(value) => form.setValue("paymentMethod", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Cash</SelectItem>
                      <SelectItem value="UPI">UPI</SelectItem>
                      <SelectItem value="BANK">Bank transfer</SelectItem>
                      <SelectItem value="CARD">Card</SelectItem>
                      <SelectItem value="CHEQUE">Cheque</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentReference">Reference</Label>
                  <Input id="paymentReference" {...form.register("paymentReference")} />
                </div>
              </div>
            )}

            <div className="flex gap-2 items-start rounded-lg border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p>
                This payment is your platform&apos;s revenue. It is recorded against the
                subscription and never appears in the shop&apos;s own accounts.
              </p>
            </div>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Register business
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
