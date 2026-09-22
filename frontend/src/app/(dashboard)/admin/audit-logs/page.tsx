"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditApi } from "@/lib/api";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatDateTime } from "@/lib/utils";
import { AuditLogEntry } from "@/types/api";
import {
  History,
  Eye,
  Shield,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
} from "lucide-react";

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const {
    data: auditResult,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["audit-logs", page, search, actionFilter],
    queryFn: () =>
      auditApi.listAuditLogs({
        page,
        limit: 15,
        search: search || undefined,
        action: actionFilter !== "all" ? actionFilter : undefined,
      }),
  });

  const columns: Column<AuditLogEntry>[] = [
    {
      header: "Timestamp",
      accessorKey: "timestamp",
      cell: (row) => (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 opacity-60" />
          <span>{formatDateTime(row.timestamp)}</span>
        </div>
      ),
    },
    {
      header: "Actor (User)",
      accessorKey: "userName",
      cell: (row) => (
        <div>
          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
            <span>{row.userName}</span>
            <span className="text-[9px] uppercase font-bold text-primary px-1 py-0.2 rounded bg-primary/10">
              {row.userRole}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">{row.userEmail}</div>
        </div>
      ),
    },
    {
      header: "Action / Event",
      accessorKey: "action",
      cell: (row) => (
        <span className="font-mono text-xs font-semibold px-2 py-1 rounded bg-muted/60 text-foreground">
          {row.action}
        </span>
      ),
    },
    {
      header: "Target Resource",
      accessorKey: "resource",
      cell: (row) => (
        <div className="text-xs">
          <span className="font-medium text-foreground">{row.resource}</span>
          {row.resourceId && (
            <div className="text-[11px] font-mono text-muted-foreground">
              {row.resourceId}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Result",
      accessorKey: "status",
      cell: (row) => (
        <span
          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${
            row.status === "SUCCESS"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
          }`}
        >
          {row.status === "SUCCESS" ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
          )}
          <span>{row.status}</span>
        </span>
      ),
    },
    {
      header: "Details",
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelectedLog(row)}
          className="h-8 gap-1.5 text-xs"
        >
          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Inspect</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <History className="w-7 h-7 text-primary" />
            <span>Audit Logs & Security Trail</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Auditable history of user actions, configuration changes, and security events.
          </p>
        </div>
      </div>

      {/* The backend has no audit-log module yet. Say so, rather than showing a
          generic failure that reads like a temporary outage - and rather than
          inventing records, which an earlier version of this page did. */}
      {isError && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5">
          <h4 className="text-sm font-semibold text-foreground mb-1">
            Audit logging is not available yet
          </h4>
          <p className="text-sm text-muted-foreground max-w-2xl">
            This build of the backend does not record an audit trail, so there is
            nothing to show here. Financial history remains fully auditable
            through the general ledger, the customer and supplier statements and
            the journal entry behind every posted document.
          </p>
        </div>
      )}

      {/* DataTable */}
      {!isError && (
      <DataTable
        columns={columns}
        data={auditResult?.logs || []}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        searchable={true}
        searchPlaceholder="Search logs by actor, resource, or action..."
        searchValue={search}
        onSearchChange={(val) => {
          setSearch(val);
          setPage(1);
        }}
        pagination={
          auditResult?.pagination
            ? {
                ...auditResult.pagination,
                onPageChange: setPage,
              }
            : undefined
        }
        emptyTitle="No audit records"
        emptyDescription="System activities and user operations will appear here."
        filterSlot={
          <Select
            value={actionFilter}
            onValueChange={(val) => {
              setActionFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <SelectValue placeholder="Action Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="COMPANY_SETTINGS_UPDATE">Settings Update</SelectItem>
              <SelectItem value="USER_CREATE">User Created</SelectItem>
              <SelectItem value="COMPANY_GST_UPDATE">GST Profile Updated</SelectItem>
              <SelectItem value="AUTHENTICATION_LOGIN">Sign In</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      )}

      {/* Inspect Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              <span>Event Details: {selectedLog?.action}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Full structured metadata and execution context
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/20">
                <div>
                  <span className="text-muted-foreground">Actor:</span>
                  <p className="font-semibold text-foreground mt-0.5">
                    {selectedLog.userName} ({selectedLog.userEmail})
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Role:</span>
                  <p className="font-semibold text-foreground mt-0.5">
                    {selectedLog.userRole}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Timestamp:</span>
                  <p className="font-mono text-foreground mt-0.5">
                    {formatDateTime(selectedLog.timestamp)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Target Resource:</span>
                  <p className="font-mono text-foreground mt-0.5">
                    {selectedLog.resource} ({selectedLog.resourceId || "N/A"})
                  </p>
                </div>
              </div>

              <div>
                <span className="font-semibold text-foreground mb-1.5 block">
                  Captured Event Metadata
                </span>
                <JsonViewer data={selectedLog.metadata} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
