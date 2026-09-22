"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  KeyRound,
  Shield,
  UserCheck,
  Check,
  X,
  Search,
  Lock,
  Info,
} from "lucide-react";
import { PermissionDefinition } from "@/types/api";

const SYSTEM_PERMISSIONS: PermissionDefinition[] = [
  {
    id: "dash_view",
    module: "Dashboard",
    name: "View Dashboard & Metrics",
    description: "Access high-level sales, purchases, and cash movement summaries",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "comp_read",
    module: "Companies",
    name: "View Company Details",
    description: "Read active business profile and general parameters",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "comp_write",
    module: "Companies",
    name: "Manage Company Profile & Tenants",
    description: "Create new companies, edit legal name, address, and status",
    adminAllowed: true,
    staffAllowed: false,
  },
  {
    id: "users_manage",
    module: "Users & Staff",
    name: "Manage Users & Role Assignment",
    description: "Create, edit, activate, or deactivate company team members",
    adminAllowed: true,
    staffAllowed: false,
  },
  {
    id: "sales_draft",
    module: "Sales & Invoices",
    name: "Create & View Sales Invoices",
    description: "Generate drafts and inspect customer sales invoices",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "sales_post",
    module: "Sales & Invoices",
    name: "Post & Cancel Sales Invoices",
    description: "Post invoices to reduce stock, freeze COGS, and raise receivables",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "purchases_post",
    module: "Purchases & Bills",
    name: "Create & Post Supplier Bills",
    description: "Record bills, receive warehouse stock, and update weighted average cost",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "inventory_view",
    module: "Inventory",
    name: "View Warehouse Stock Balances",
    description: "Inspect inventory quantities and moving weighted average costs",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "inventory_adjust",
    module: "Inventory",
    name: "Record Stock Adjustments",
    description: "Add or remove inventory adjustments with audit trail",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "credit_manage",
    module: "Credit Book",
    name: "View Receivables & Payables",
    description: "Inspect customer credit dues and supplier payables",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "expenses_manage",
    module: "Operating Expenses",
    name: "Record & Reverse Expenses",
    description: "Record rent, electricity, and salaries paid from cash or bank",
    adminAllowed: true,
    staffAllowed: true,
  },
  {
    id: "gst_manage",
    module: "GST Compliance",
    name: "Configure GST & HSN Codes",
    description: "Set company GST state, GSTIN, and manage tax classifications",
    adminAllowed: true,
    staffAllowed: false,
  },
  {
    id: "settings_manage",
    module: "System Settings",
    name: "Update Accounting & System Settings",
    description: "Modify numbering prefixes, date formats, and period enforcement",
    adminAllowed: true,
    staffAllowed: false,
  },
  {
    id: "audit_view",
    module: "Audit Logs",
    name: "Inspect System Audit Trails",
    description: "Review security logs and administrative modification records",
    adminAllowed: true,
    staffAllowed: false,
  },
];

export default function RolesPermissionsPage() {
  const [search, setSearch] = useState("");

  const filteredPermissions = SYSTEM_PERMISSIONS.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.module.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <KeyRound className="w-7 h-7 text-primary" />
            <span>Roles & Access Control (RBAC)</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Overview of role-based permissions enforced by the backend security layer.
          </p>
        </div>
      </div>

      {/* Role Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Administrator Role Card */}
        <Card className="border-indigo-200 dark:border-indigo-900 bg-indigo-50/20 dark:bg-indigo-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <span>Administrator (ADMIN)</span>
                    <Badge variant="default" className="text-[10px]">
                      Full Control
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Business owners and senior management
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Admins have unrestricted access to manage business settings, create and deactivate staff accounts, configure GST details, inspect audit logs, and execute all business operations.
            </p>
          </CardContent>
        </Card>

        {/* Staff Role Card */}
        <Card className="border-border/80">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <span>Staff Member (STAFF)</span>
                    <Badge variant="secondary" className="text-[10px]">
                      Operations Only
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Shop assistants, cashiers, and inventory clerks
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Staff can record day-to-day sales, purchase bills, inventory adjustments, receive payments, and view reports. Administrative settings and user management remain restricted.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Permissions Matrix */}
      <Card className="border-border/80 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
          <div>
            <CardTitle className="text-base font-bold">
              Role Permission Matrix
            </CardTitle>
            <CardDescription className="text-xs">
              Backend authorization boundary mapped across functional modules
            </CardDescription>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search permissions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[180px] font-bold">Module</TableHead>
                  <TableHead className="font-bold">Permission / Capability</TableHead>
                  <TableHead className="text-center font-bold w-[120px]">
                    ADMIN
                  </TableHead>
                  <TableHead className="text-center font-bold w-[120px]">
                    STAFF
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPermissions.map((perm) => (
                  <TableRow key={perm.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs text-foreground">
                      <span className="px-2 py-1 rounded bg-muted/60 text-foreground">
                        {perm.module}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-xs text-foreground">
                        {perm.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {perm.description}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {perm.adminAllowed ? (
                        <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                          <X className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {perm.staffAllowed ? (
                        <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                          <X className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* RBAC Architecture Info Note */}
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-muted/20 text-xs">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1 text-muted-foreground">
          <p className="font-semibold text-foreground">
            Backend Security Boundary
          </p>
          <p>
            Frontend permission checks provide an intuitive, role-aware user experience. All mutations and sensitive queries are strictly verified by Express middleware (<code className="font-mono text-[11px]">requireRole(&apos;ADMIN&apos;)</code>) on the backend server.
          </p>
        </div>
      </div>
    </div>
  );
}
