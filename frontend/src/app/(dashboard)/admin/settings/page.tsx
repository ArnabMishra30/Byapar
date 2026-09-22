"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi, companyApi, gstApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GstBadge } from "@/components/shared/gst-badge";
import { INDIAN_STATES, GST_REGISTRATION_TYPES } from "@/lib/constants";
import {
  Sliders,
  Building2,
  ShieldCheck,
  Calendar,
  Save,
  Loader2,
  Store,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export default function SystemSettingsPage() {
  const queryClient = useQueryClient();
  const { company, isGstEnabled, refreshCompany } = useAuth();

  // Fetch Settings
  const { data: settings, isLoading: isSettingsLoading } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getSettings(),
  });

  const [form, setForm] = useState({
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
    invoicePrefix: "INV",
    purchasePrefix: "PUR",
    financialYearStartMonth: 4,
    requireOpenPeriod: false,
  });

  const [gstForm, setGstForm] = useState({
    gstRegistrationType: "UNREGISTERED",
    gstin: "",
    stateCode: "",
  });

  React.useEffect(() => {
    if (settings) {
      setForm({
        currency: settings.currency || "INR",
        timezone: settings.timezone || "Asia/Kolkata",
        dateFormat: settings.dateFormat || "DD/MM/YYYY",
        invoicePrefix: settings.invoicePrefix || "INV",
        purchasePrefix: settings.purchasePrefix || "PUR",
        financialYearStartMonth: settings.financialYearStartMonth || 4,
        requireOpenPeriod: settings.requireOpenPeriod ?? false,
      });
    }
    if (company) {
      setGstForm({
        gstRegistrationType: company.gstRegistrationType || "UNREGISTERED",
        gstin: company.gstin || "",
        stateCode: company.stateCode || "",
      });
    }
  }, [settings, company]);

  const updateSettingsMutation = useMutation({
    mutationFn: (payload: any) => settingsApi.updateSettings(payload),
    onSuccess: () => {
      toast.success("Settings saved successfully");
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (err: any) => {
      toast.error("Failed to save settings", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  const updateGstMutation = useMutation({
    mutationFn: (payload: any) => {
      if (!company) throw new Error("No company loaded");
      return companyApi.updateCompany(company.id, payload);
    },
    onSuccess: () => {
      toast.success("GST configuration updated successfully");
      refreshCompany();
    },
    onError: (err: any) => {
      toast.error("Failed to update GST profile", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Sliders className="w-7 h-7 text-primary" />
            <span>System Settings</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Configure system parameters, document numbering, and tax preferences.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General & Financial Settings Card */}
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span>General & Document Settings</span>
            </CardTitle>
            <CardDescription className="text-xs">
              System display formats and document number prefixes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Currency Code</Label>
                <Input
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Date Format</Label>
                <Input
                  value={form.dateFormat}
                  onChange={(e) =>
                    setForm({ ...form, dateFormat: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Invoice Prefix (Sales)
                </Label>
                <Input
                  value={form.invoicePrefix}
                  onChange={(e) =>
                    setForm({ ...form, invoicePrefix: e.target.value })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Purchase Bill Prefix
                </Label>
                <Input
                  value={form.purchasePrefix}
                  onChange={(e) =>
                    setForm({ ...form, purchasePrefix: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-foreground">
                    Require Open Accounting Period
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Refuse posting documents dated outside open periods
                  </p>
                </div>
                <Switch
                  checked={form.requireOpenPeriod}
                  onCheckedChange={(c) =>
                    setForm({ ...form, requireOpenPeriod: c })
                  }
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t pt-4">
            <Button
              onClick={() => updateSettingsMutation.mutate(form)}
              disabled={updateSettingsMutation.isPending}
              className="gap-2 ml-auto"
            >
              {updateSettingsMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Save Document Settings</span>
            </Button>
          </CardFooter>
        </Card>

        {/* GST Settings Card */}
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span>GST Compliance Settings</span>
              </CardTitle>
              <GstBadge
                isGstEnabled={isGstEnabled}
                registrationType={gstForm.gstRegistrationType}
              />
            </div>
            <CardDescription className="text-xs">
              Optional tax setup. Keep unregistered if you do not collect GST.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Registration Status</Label>
              <Select
                value={gstForm.gstRegistrationType}
                onValueChange={(val) =>
                  setGstForm({ ...gstForm, gstRegistrationType: val })
                }
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select Status" />
                </SelectTrigger>
                <SelectContent>
                  {GST_REGISTRATION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {gstForm.gstRegistrationType !== "UNREGISTERED" ? (
              <div className="space-y-3 p-3.5 rounded-lg border bg-sky-50/30 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800 animate-fade-in">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">GSTIN</Label>
                  <Input
                    placeholder="27AABCU9603R1ZM"
                    value={gstForm.gstin}
                    onChange={(e) =>
                      setGstForm({ ...gstForm, gstin: e.target.value.toUpperCase() })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Registered State</Label>
                  <Select
                    value={gstForm.stateCode}
                    onValueChange={(val) =>
                      setGstForm({ ...gstForm, stateCode: val })
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select State" />
                    </SelectTrigger>
                    <SelectContent className="max-h-56">
                      {INDIAN_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.code} - {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-lg border bg-muted/30 flex items-start gap-2.5 text-xs text-muted-foreground">
                <Store className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Non-GST local shop mode active. Invoices will not display tax splits or require HSN codes.
                </span>
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t pt-4">
            <Button
              onClick={() =>
                updateGstMutation.mutate({
                  gstRegistrationType: gstForm.gstRegistrationType,
                  gstin: gstForm.gstRegistrationType === "UNREGISTERED" ? null : gstForm.gstin || null,
                  stateCode: gstForm.gstRegistrationType === "UNREGISTERED" ? null : gstForm.stateCode || null,
                })
              }
              disabled={updateGstMutation.isPending}
              className="gap-2 ml-auto"
            >
              {updateGstMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Update GST Profile</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
