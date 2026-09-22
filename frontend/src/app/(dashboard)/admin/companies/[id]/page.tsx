"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { companyApi, settingsApi, userApi, gstApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { GstBadge } from "@/components/shared/gst-badge";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { INDIAN_STATES, GST_REGISTRATION_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import {
  Building2,
  Sliders,
  ShieldCheck,
  Users,
  History,
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  Store,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = String(params.id);
  const queryClient = useQueryClient();
  const { company: authCompany, refreshCompany } = useAuth();

  const [activeTab, setActiveTab] = useState("overview");

  // Fetch Company
  const {
    data: company,
    isLoading: isCompLoading,
    isError: isCompError,
    error: compError,
    refetch: refetchCompany,
  } = useQuery({
    queryKey: ["company", companyId],
    queryFn: () => companyApi.getCompanyById(companyId),
  });

  // Fetch Company Settings
  const {
    data: settings,
    isLoading: isSettingsLoading,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => settingsApi.getSettings(),
  });

  // Fetch Users
  const {
    data: usersData,
    isLoading: isUsersLoading,
  } = useQuery({
    queryKey: ["company-users"],
    queryFn: () => userApi.listUsers({ limit: 50 }),
  });

  // Overview Form State
  const [overviewForm, setOverviewForm] = useState({
    name: "",
    legalName: "",
    registeredAddress: "",
    isActive: true,
  });

  // GST Form State
  const [gstForm, setGstForm] = useState({
    gstin: "",
    stateCode: "",
    gstRegistrationType: "UNREGISTERED",
  });

  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
    invoicePrefix: "INV",
    purchasePrefix: "PUR",
    financialYearStartMonth: 4,
    requireOpenPeriod: false,
  });

  // Sync state on fetch
  React.useEffect(() => {
    if (company) {
      setOverviewForm({
        name: company.name || "",
        legalName: company.legalName || "",
        registeredAddress: company.registeredAddress || "",
        isActive: company.isActive ?? true,
      });
      setGstForm({
        gstin: company.gstin || "",
        stateCode: company.stateCode || "",
        gstRegistrationType: company.gstRegistrationType || "UNREGISTERED",
      });
    }
  }, [company]);

  React.useEffect(() => {
    if (settings) {
      setSettingsForm({
        currency: settings.currency || "INR",
        timezone: settings.timezone || "Asia/Kolkata",
        dateFormat: settings.dateFormat || "DD/MM/YYYY",
        invoicePrefix: settings.invoicePrefix || "INV",
        purchasePrefix: settings.purchasePrefix || "PUR",
        financialYearStartMonth: settings.financialYearStartMonth || 4,
        requireOpenPeriod: settings.requireOpenPeriod ?? false,
      });
    }
  }, [settings]);

  // Update Company Mutation
  const updateCompanyMutation = useMutation({
    mutationFn: (payload: any) => companyApi.updateCompany(companyId, payload),
    onSuccess: () => {
      toast.success("Company profile updated successfully");
      queryClient.invalidateQueries({ queryKey: ["company", companyId] });
      refreshCompany();
    },
    onError: (err: any) => {
      toast.error("Failed to update company", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  // Update Settings Mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (payload: any) => settingsApi.updateSettings(payload),
    onSuccess: () => {
      toast.success("Business settings saved successfully");
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
    },
    onError: (err: any) => {
      toast.error("Failed to update settings", {
        description: err?.message || "An error occurred.",
      });
    },
  });

  if (isCompLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isCompError) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/companies")}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Companies</span>
        </Button>
        <ErrorState
          title="Company not found or access denied"
          message={compError?.message || "Could not load company details."}
          onRetry={refetchCompany}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-8 w-8 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <Link href="/admin/companies">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <span>{company?.name}</span>
            </h1>
            <StatusBadge status={company?.isActive} />
            <GstBadge
              isGstEnabled={Boolean(company?.stateCode && company?.gstRegistrationType !== "UNREGISTERED")}
              registrationType={company?.gstRegistrationType}
            />
          </div>
          <p className="text-xs text-muted-foreground ml-8">
            Company ID: <span className="font-mono">{company?.id}</span> • Created {formatDate(company?.createdAt)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full sm:w-auto h-auto p-1 bg-muted/70">
          <TabsTrigger value="overview" className="gap-2 text-xs py-2">
            <Building2 className="w-4 h-4" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 text-xs py-2">
            <Sliders className="w-4 h-4" />
            <span>Settings</span>
          </TabsTrigger>
          <TabsTrigger value="gst" className="gap-2 text-xs py-2">
            <ShieldCheck className="w-4 h-4" />
            <span>GST & Tax</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2 text-xs py-2">
            <Users className="w-4 h-4" />
            <span>Users ({usersData?.users?.length || 0})</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2 text-xs py-2">
            <History className="w-4 h-4" />
            <span>Activity</span>
          </TabsTrigger>
        </TabsList>

        {/* 1. OVERVIEW TAB */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold">Business Profile</CardTitle>
              <CardDescription className="text-xs">
                General company information and primary trading identity
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="compName" className="text-xs font-semibold">
                    Trading Name
                  </Label>
                  <Input
                    id="compName"
                    value={overviewForm.name}
                    onChange={(e) =>
                      setOverviewForm({ ...overviewForm, name: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="legalName" className="text-xs font-semibold">
                    Legal / Registered Name
                  </Label>
                  <Input
                    id="legalName"
                    placeholder="e.g. Royal General Store Pvt. Ltd."
                    value={overviewForm.legalName}
                    onChange={(e) =>
                      setOverviewForm({
                        ...overviewForm,
                        legalName: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="address" className="text-xs font-semibold">
                  Registered Address
                </Label>
                <Textarea
                  id="address"
                  placeholder="Street, City, State, PIN"
                  value={overviewForm.registeredAddress}
                  onChange={(e) =>
                    setOverviewForm({
                      ...overviewForm,
                      registeredAddress: e.target.value,
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/20">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-foreground">
                    Active Company Status
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Inactive companies cannot record new sales or purchases.
                  </p>
                </div>
                <Switch
                  checked={overviewForm.isActive}
                  onCheckedChange={(checked) =>
                    setOverviewForm({ ...overviewForm, isActive: checked })
                  }
                />
              </div>
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() => updateCompanyMutation.mutate(overviewForm)}
                disabled={updateCompanyMutation.isPending}
                className="gap-2 ml-auto"
              >
                {updateCompanyMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Profile Changes</span>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* 2. BUSINESS SETTINGS TAB */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold">Business & Accounting Configuration</CardTitle>
              <CardDescription className="text-xs">
                Configure document numbering, accounting periods, and operational defaults
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Currency</Label>
                  <Input
                    value={settingsForm.currency}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        currency: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Timezone</Label>
                  <Input
                    value={settingsForm.timezone}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        timezone: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Date Format</Label>
                  <Input
                    value={settingsForm.dateFormat}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        dateFormat: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Sales Invoice Prefix</Label>
                  <Input
                    value={settingsForm.invoicePrefix}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        invoicePrefix: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Purchase Bill Prefix</Label>
                  <Input
                    value={settingsForm.purchasePrefix}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        purchasePrefix: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/20">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-foreground">
                    Require Open Accounting Period for Postings
                  </span>
                  <p className="text-xs text-muted-foreground">
                    When enabled, documents dated in uncreated or closed periods will be strictly blocked.
                  </p>
                </div>
                <Switch
                  checked={settingsForm.requireOpenPeriod}
                  onCheckedChange={(checked) =>
                    setSettingsForm({
                      ...settingsForm,
                      requireOpenPeriod: checked,
                    })
                  }
                />
              </div>
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() => updateSettingsMutation.mutate(settingsForm)}
                disabled={updateSettingsMutation.isPending}
                className="gap-2 ml-auto"
              >
                {updateSettingsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Settings</span>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* 3. GST SETTINGS TAB (PROGRESSIVE DISCLOSURE) */}
        <TabsContent value="gst">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold">GST & Tax Registration</CardTitle>
                  <CardDescription className="text-xs">
                    GST is completely optional. If you run a local shop, keep it unregistered.
                  </CardDescription>
                </div>
                <GstBadge
                  isGstEnabled={Boolean(gstForm.stateCode && gstForm.gstRegistrationType !== "UNREGISTERED")}
                  registrationType={gstForm.gstRegistrationType}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">GST Registration Type</Label>
                <Select
                  value={gstForm.gstRegistrationType}
                  onValueChange={(val) =>
                    setGstForm({ ...gstForm, gstRegistrationType: val })
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select registration type" />
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

              {/* Progressive disclosure: Only show tax details when GST is enabled */}
              {gstForm.gstRegistrationType !== "UNREGISTERED" ? (
                <div className="space-y-4 p-4 rounded-xl border bg-sky-500/5 border-sky-200 dark:border-sky-900 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs font-bold text-sky-800 dark:text-sky-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>GST Registered Business Details</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="gstinInput" className="text-xs font-semibold">
                        GSTIN (15 Digits)
                      </Label>
                      <Input
                        id="gstinInput"
                        placeholder="e.g. 27AABCU9603R1ZM"
                        value={gstForm.gstin}
                        onChange={(e) =>
                          setGstForm({ ...gstForm, gstin: e.target.value.toUpperCase() })
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        GST State (Home Location)
                      </Label>
                      <Select
                        value={gstForm.stateCode}
                        onValueChange={(val) =>
                          setGstForm({ ...gstForm, stateCode: val })
                        }
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Select State" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {INDIAN_STATES.map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.code} - {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl border bg-muted/30 flex items-start gap-3">
                  <Store className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-foreground">
                      Operating in Non-GST Mode
                    </p>
                    <p className="text-muted-foreground">
                      No GSTIN, HSN codes, or tax splits will be forced on invoices or bills. All sales and purchases will use clean, simple totals.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() =>
                  updateCompanyMutation.mutate({
                    gstRegistrationType: gstForm.gstRegistrationType,
                    gstin: gstForm.gstRegistrationType === "UNREGISTERED" ? null : gstForm.gstin || null,
                    stateCode: gstForm.gstRegistrationType === "UNREGISTERED" ? null : gstForm.stateCode || null,
                  })
                }
                disabled={updateCompanyMutation.isPending}
                className="gap-2 ml-auto"
              >
                {updateCompanyMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Update GST Configuration</span>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* 4. USERS TAB */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Company Staff & Admins</CardTitle>
                <CardDescription className="text-xs">
                  Active team members with access to this business
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/admin/users">Manage All Users →</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {isUsersLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <div className="divide-y text-sm">
                  {usersData?.users?.map((u) => (
                    <div
                      key={u.id}
                      className="py-3 flex items-center justify-between hover:bg-muted/20 px-2 rounded-lg"
                    >
                      <div>
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          <span>{u.name}</span>
                          <span className="text-[10px] uppercase font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                            {u.role}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                      <StatusBadge status={u.isActive} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 5. ACTIVITY TAB */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold">Company Activity History</CardTitle>
              <CardDescription className="text-xs">
                Audited modifications and company milestone events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 text-xs">
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-foreground">Company Profile Active</span>
                    <p className="text-muted-foreground">
                      Company created and operational defaults initialized.
                    </p>
                    <span className="text-[11px] text-muted-foreground mt-1 inline-block">
                      {formatDate(company?.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
