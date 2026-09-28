"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Square,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, customersApi } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { whyNot } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { ForbiddenState } from "@/components/shared/states";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select-native";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { downloadCsv, parseCsv, rowsToRecords, toCsv } from "./csv";
import {
  IMPORT_COLUMNS,
  SAMPLE_CSV_ROWS,
  toPartyPayload,
  validateImportRows,
  type ImportRow,
} from "./party-rules";

/**
 * Bulk upload of customers from a CSV file.
 *
 * THERE IS NO BULK ENDPOINT on the backend. Each valid row is sent to the
 * ordinary POST /customers, one after another, and the backend validates each
 * one exactly as it would a customer typed in by hand. That has consequences
 * the page is honest about:
 *
 *   - rows are checked here first with the backend's own rules, so obvious
 *     mistakes never reach it, and invalid rows are NEVER sent;
 *   - the import is not all-or-nothing: rows created before a failure stay
 *     created, and the result lists exactly which rows failed and why;
 *   - the backend is still the final judge (a name that already exists in the
 *     shop, for example, can only be caught there).
 */

const MAX_ROWS = 1000;
const MAX_BYTES = 1024 * 1024;

type Outcome = { line: number; values: ImportRow["values"]; error?: string };

export function ImportCustomersPage() {
  const { can, isGstEnabled } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<ImportRow[] | null>(null);
  const [show, setShow] = React.useState<"all" | "invalid" | "valid">("all");

  const [running, setRunning] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const [outcomes, setOutcomes] = React.useState<Outcome[] | null>(null);
  const stopRequested = React.useRef(false);

  if (!can("parties.manage")) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bulk upload customers" />
        <ForbiddenState message={whyNot("parties.manage")} />
      </div>
    );
  }

  const valid = rows?.filter((row) => row.errors.length === 0) ?? [];
  const invalid = rows?.filter((row) => row.errors.length > 0) ?? [];

  const reset = () => {
    setFileName(null);
    setFileError(null);
    setNotes([]);
    setRows(null);
    setOutcomes(null);
    setDone(0);
    setShow("all");
    if (fileInput.current) fileInput.current.value = "";
  };

  const readFile = async (file: File) => {
    reset();
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setFileError("Please choose a .csv file. In Excel use File → Save As → CSV.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError("That file is larger than 1 MB. Split it into smaller files.");
      return;
    }

    const text = await file.text();
    const { records, unknownHeaders, missingHeaders } = rowsToRecords(parseCsv(text), IMPORT_COLUMNS);

    if (missingHeaders.includes("name")) {
      setFileError('The first line must be the column names, including "name". Download the sample to see the layout.');
      return;
    }
    if (records.length === 0) {
      setFileError("The file has column names but no customers under them.");
      return;
    }
    if (records.length > MAX_ROWS) {
      setFileError(`That file has ${records.length} rows. Upload at most ${MAX_ROWS} at a time.`);
      return;
    }

    const nextNotes: string[] = [];
    if (unknownHeaders.length) nextNotes.push(`Ignored columns: ${unknownHeaders.join(", ")}.`);
    if (!isGstEnabled) {
      nextNotes.push("GST is not switched on for your business, so GSTIN and state are checked but not saved.");
    }
    setNotes(nextNotes);
    setRows(validateImportRows(records));
  };

  const runImport = async () => {
    if (valid.length === 0) return;
    setRunning(true);
    setDone(0);
    stopRequested.current = false;
    const results: Outcome[] = [];

    // One at a time, on purpose: parallel requests would race on the unique
    // customer name and make failures hard to attribute to a row.
    for (const row of valid) {
      if (stopRequested.current) break;
      try {
        await customersApi.create(toPartyPayload(row.values, { mode: "create", includeGst: isGstEnabled }));
        results.push({ line: row.line, values: row.values });
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.fieldErrors?.length
              ? err.fieldErrors.map((item) => item.message).join("; ")
              : err.message
            : "Could not reach the server";
        results.push({ line: row.line, values: row.values, error: message });
      }
      setDone(results.length);
    }

    setOutcomes(results);
    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ["customer"] });
    const created = results.filter((result) => !result.error).length;
    toast.success(`${created} customer${created === 1 ? "" : "s"} added`);
  };

  const created = outcomes?.filter((outcome) => !outcome.error) ?? [];
  const failed = outcomes?.filter((outcome) => outcome.error) ?? [];
  const notAttempted = outcomes ? valid.length - outcomes.length : 0;

  const downloadFailed = () => {
    const header = [...IMPORT_COLUMNS, "line", "error"];
    const lines = [
      ...failed.map((outcome) => ({ line: outcome.line, values: outcome.values, error: outcome.error ?? "" })),
      ...invalid.map((row) => ({ line: row.line, values: row.values, error: row.errors.join("; ") })),
    ].sort((a, b) => a.line - b.line);
    downloadCsv(
      "customers-to-fix.csv",
      toCsv([header, ...lines.map((item) => [...IMPORT_COLUMNS.map((key) => item.values[key]), item.line, item.error])]),
    );
  };

  const visible = (rows ?? []).filter((row) =>
    show === "all" ? true : show === "invalid" ? row.errors.length > 0 : row.errors.length === 0,
  );

  const columns: Column<ImportRow>[] = [
    { header: "Line", cell: (row) => <span className="tabular text-muted-foreground">{row.line}</span> },
    { header: "Name", cell: (row) => <span className="font-medium">{row.values.name || "—"}</span> },
    { header: "Phone", hideOnMobile: true, cell: (row) => row.values.phone || "—" },
    {
      header: "Email",
      hideOnMobile: true,
      cell: (row) => <span className="block max-w-[12rem] truncate">{row.values.email || "—"}</span>,
    },
    {
      header: "Check",
      cell: (row) =>
        row.errors.length === 0 ? (
          <Badge variant="success">Ready</Badge>
        ) : (
          <ul className="space-y-0.5 text-xs text-destructive">
            {row.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href={ROUTES.customers}>
          <ArrowLeft className="h-4 w-4" />
          Customers
        </Link>
      </Button>

      <PageHeader
        title="Bulk upload customers"
        description="Add many customers at once from a spreadsheet saved as CSV."
      />

      {/* Step 1 */}
      <Step number={1} title="Download the sample file" done={Boolean(rows)}>
        <p className="text-sm text-muted-foreground">
          Open it in Excel or Google Sheets, replace the two example rows with your customers, and save it
          as CSV. Only <span className="font-medium text-foreground">name</span> is required.
        </p>
        <Button
          variant="outline"
          className="mt-3 min-h-[44px] gap-1.5 sm:min-h-0"
          onClick={() => downloadCsv("customers-sample.csv", toCsv(SAMPLE_CSV_ROWS))}
        >
          <Download className="h-4 w-4" />
          Download sample CSV
        </Button>
      </Step>

      {/* Step 2 */}
      <Step number={2} title="Upload your CSV file" done={Boolean(rows)}>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="customer-csv"
          disabled={running}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
        <label
          htmlFor="customer-csv"
          className={cn(
            "flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors hover:border-primary/50",
            running && "pointer-events-none opacity-50",
          )}
        >
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="font-medium">{fileName ?? "Choose a .csv file"}</span>
          <span className="text-xs text-muted-foreground">Up to {MAX_ROWS} customers, 1 MB</span>
        </label>
        {fileError ? (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {fileError}
          </p>
        ) : null}
        {notes.map((note) => (
          <p key={note} className="mt-2 text-xs text-muted-foreground">
            {note}
          </p>
        ))}
      </Step>

      {/* Steps 3 and 4 */}
      {rows ? (
        <Step number={3} title="Check the rows" done={Boolean(outcomes)}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {valid.length} ready
            </Badge>
            {invalid.length ? (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3.5 w-3.5" />
                {invalid.length} with problems
              </Badge>
            ) : null}
            <NativeSelect
              aria-label="Show rows"
              className="w-full sm:ml-auto sm:w-48"
              value={show}
              onChange={(event) => setShow(event.target.value as typeof show)}
            >
              <option value="all">All rows</option>
              <option value="invalid">Rows with problems</option>
              <option value="valid">Ready rows</option>
            </NativeSelect>
          </div>
          {invalid.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Rows with problems are never imported. Fix them in your file and upload it again, or import the
              ready rows now and download the rest to fix later.
            </p>
          ) : null}
          <div className="mt-3">
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(row) => String(row.line)}
              emptyTitle="Nothing to show"
              emptyDescription="No rows match this filter."
              mobileCard={(row) => (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{row.values.name || "(no name)"}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">Line {row.line}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{row.values.phone || "No phone"}</p>
                  {row.errors.length === 0 ? (
                    <Badge variant="success">Ready</Badge>
                  ) : (
                    <ul className="space-y-0.5 text-xs text-destructive">
                      {row.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            />
          </div>
        </Step>
      ) : null}

      {/* Step 5 */}
      {rows ? (
        <Step number={4} title="Import" done={Boolean(outcomes)}>
          {running ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Adding customers…</span>
                <span className="tabular">
                  {done} of {valid.length}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={valid.length}
                aria-valuenow={done}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${valid.length ? Math.round((done / valid.length) * 100) : 0}%` }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  stopRequested.current = true;
                }}
              >
                <Square className="h-3.5 w-3.5" />
                Stop after this one
              </Button>
            </div>
          ) : outcomes ? (
            <p className="text-sm text-muted-foreground">Finished. See the result below.</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                className="min-h-[44px] gap-1.5 sm:min-h-0"
                disabled={valid.length === 0}
                onClick={() => void runImport()}
              >
                <Upload className="h-4 w-4" />
                Import {valid.length} customer{valid.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" className="min-h-[44px] sm:min-h-0" onClick={reset}>
                Choose another file
              </Button>
            </div>
          )}
        </Step>
      ) : null}

      {/* Step 6 */}
      {outcomes ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ResultFigure label="Added" value={created.length} tone="good" />
              <ResultFigure label="Refused by the server" value={failed.length} tone={failed.length ? "bad" : undefined} />
              <ResultFigure
                label="Skipped (problems or stopped)"
                value={invalid.length + notAttempted}
                tone={invalid.length + notAttempted ? "bad" : undefined}
              />
            </div>

            {failed.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {failed.map((outcome) => (
                  <li key={outcome.line} className="p-2.5">
                    <p className="font-medium">
                      Line {outcome.line}: {outcome.values.name}
                    </p>
                    <p className="text-xs text-destructive">{outcome.error}</p>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              {failed.length || invalid.length ? (
                <Button variant="outline" className="min-h-[44px] gap-1.5 sm:min-h-0" onClick={downloadFailed}>
                  <Download className="h-4 w-4" />
                  Download rows to fix
                </Button>
              ) : null}
              <Button asChild className="min-h-[44px] sm:min-h-0">
                <Link href={ROUTES.customers}>Go to customers</Link>
              </Button>
              <Button variant="ghost" className="min-h-[44px] sm:min-h-0" onClick={reset}>
                Upload another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {running ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Keep this page open until the import finishes.
        </p>
      ) : null}
    </div>
  );
}

function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              done ? "bg-success/15 text-success" : "bg-primary/10 text-primary",
            )}
          >
            {done ? <CheckCircle2 className="h-4 w-4" /> : number}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ResultFigure({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "good" && "border-success/30 bg-success/5",
        tone === "bad" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular">{value}</p>
    </div>
  );
}
