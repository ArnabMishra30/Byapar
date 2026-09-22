"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  billsApi,
  warehousesApi,
  type Bill,
  type ExtractedBill,
  type ExtractedLine,
} from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { EntitySelect } from "@/components/shared/entity-select";
import { Field, FormSection } from "@/components/shared/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { stripBodyPrefix } from "@/lib/utils";

/**
 * THE REVIEW STEP. The whole point of the feature.
 *
 * On the left: the bill as photographed. On the right: what was read off it,
 * every field editable.
 *
 * WHY A HUMAN IS IN THE LOOP AT ALL. An OCR pass over a creased photo of a
 * handwritten bill misreads digits. A system that posted those straight into the
 * ledger would manufacture false accounting records at scale, quietly, and the
 * shop would find out months later. So the model's output is a DRAFT SUGGESTION
 * and nothing more.
 *
 * WHAT THE HUMAN MUST DO, and why the software cannot: the model reads text
 * ("ABC Traders", "sugar 1kg"). Posting needs IDs — this supplier, this product,
 * this warehouse. Matching one to the other is a judgement about the shop's own
 * records, so the person makes it here, and their choice is what gets posted.
 */

interface Props {
  billId: string;
}

export function BillReviewScreen({ billId }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const billQuery = useQuery({
    queryKey: ["bills", billId],
    queryFn: () => billsApi.get(billId),
  });

  const bill = billQuery.data;

  if (billQuery.isLoading) return <LoadingState />;
  if (billQuery.isError || !bill) {
    return (
      <ErrorState
        error={billQuery.error}
        onRetry={billQuery.refetch}
      />
    );
  }

  if (bill.status === "POSTED") {
    return <AlreadyRecorded bill={bill} />;
  }

  return (
    <ReviewForm
      bill={bill}
      onDone={() => {
        queryClient.invalidateQueries({ queryKey: ["bills"] });
        router.push("/shop/bills");
      }}
    />
  );
}

function AlreadyRecorded({ bill }: { bill: Bill }) {
  const router = useRouter();
  const href =
    bill.posted?.sourceType === "PURCHASE"
      ? `/shop/purchases/${bill.posted.sourceId}`
      : `/shop/sales/${bill.posted?.sourceId}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Bill already recorded" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <p className="font-medium">This bill has already been recorded.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            A bill becomes one document and one only. To change what was recorded, cancel or
            reverse that document — a posted record is never edited in place.
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push("/shop/bills")}>
              Back to bills
            </Button>
            <Button onClick={() => router.push(href)}>Open the document</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const emptyLine: ExtractedLine = {
  description: null,
  hsnCode: null,
  quantity: null,
  unit: null,
  unitPrice: null,
  discount: null,
  taxRate: null,
  lineTotal: null,
};

function ReviewForm({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const router = useRouter();
  const isPurchase = bill.direction === "IN";

  // What was read, as the starting point. Every field is editable.
  const [data, setData] = React.useState<ExtractedBill>(
    bill.reviewedData ?? {
      partyName: null,
      partyGstin: null,
      partyPhone: null,
      partyAddress: null,
      invoiceNumber: null,
      invoiceDate: null,
      subtotal: null,
      totalTax: null,
      totalDiscount: null,
      grandTotal: null,
      lines: [{ ...emptyLine }],
      confidence: null,
      notes: null,
    }
  );

  // The ids the human picks. These, not the model's text, are what get posted.
  const [partyId, setPartyId] = React.useState("");
  const [partyLabel, setPartyLabel] = React.useState<string | null>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [lineProductIds, setLineProductIds] = React.useState<string[]>([]);
  const [lineProductLabels, setLineProductLabels] = React.useState<string[]>([]);

  const [imageUrl, setImageUrl] = React.useState<string | null>(null);

  // The stored file needs the auth header, so it is fetched rather than linked.
  React.useEffect(() => {
    let revoked: string | null = null;
    billsApi
      .fileBlob(bill.id)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        revoked = url;
        setImageUrl(url);
      })
      .catch(() => setImageUrl(null));

    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [bill.id]);

  const warehouses = useQuery({
    queryKey: ["warehouses", "all"],
    queryFn: () => warehousesApi.list({ limit: 100 }),
  });

  // One warehouse is the common case; choose it so nobody has to.
  React.useEffect(() => {
    const items = warehouses.data?.items ?? [];
    if (!warehouseId && items.length > 0) setWarehouseId(items[0].id);
  }, [warehouses.data, warehouseId]);

  const setField = <K extends keyof ExtractedBill>(key: K, value: ExtractedBill[K]) =>
    setData((current) => ({ ...current, [key]: value }));

  const setLine = (index: number, key: keyof ExtractedLine, value: string) =>
    setData((current) => ({
      ...current,
      lines: current.lines.map((line, i) =>
        i === index ? { ...line, [key]: value === "" ? null : value } : line
      ),
    }));

  const addLine = () =>
    setData((current) => ({ ...current, lines: [...current.lines, { ...emptyLine }] }));

  const removeLine = (index: number) => {
    setData((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }));
    setLineProductIds((current) => current.filter((_, i) => i !== index));
  };

  const saveMutation = useMutation({
    mutationFn: () => billsApi.saveReview(bill.id, data),
    onSuccess: () => toast.success("Saved — you can finish this later"),
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  const confirmMutation = useMutation({
    mutationFn: () => {
      // The ordinary document payload — exactly what the typed form sends.
      const items = data.lines
        .map((line, index) => ({
          productId: lineProductIds[index],
          quantity: line.quantity ?? "0",
          ...(isPurchase
            ? { unitCost: line.unitPrice ?? "0" }
            : { unitPrice: line.unitPrice ?? "0" }),
        }))
        .filter((item) => item.productId);

      const document: Record<string, unknown> = {
        warehouseId,
        invoiceDate: data.invoiceDate,
        items,
        ...(isPurchase
          ? { supplierId: partyId, invoiceNumber: data.invoiceNumber }
          : { customerId: partyId }),
      };

      return billsApi.confirm(bill.id, document);
    },
    onSuccess: () => {
      toast.success(isPurchase ? "Purchase recorded" : "Sale recorded");
      onDone();
    },
    onError: (error: Error) => toast.error(stripBodyPrefix(error.message)),
  });

  // What is still missing before this can be recorded. Shown plainly rather than
  // leaving somebody to guess why the button does nothing.
  const problems: string[] = [];
  if (!partyId) problems.push(isPurchase ? "Choose the supplier" : "Choose the customer");
  if (!warehouseId) problems.push("Choose a warehouse");
  if (!data.invoiceDate) problems.push("Enter the bill date");
  if (isPurchase && !data.invoiceNumber) problems.push("Enter the supplier's invoice number");
  const matchedLines = data.lines.filter((_, index) => lineProductIds[index]).length;
  if (matchedLines === 0) problems.push("Match at least one line to a product");

  const canConfirm = problems.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isPurchase ? "Check this purchase bill" : "Check this sales bill"}
        description="Nothing is recorded until you confirm. Correct anything that was misread."
        actions={
          <Button variant="ghost" onClick={() => router.push("/shop/bills")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
      />

      {bill.status === "FAILED" && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">This bill could not be read automatically.</p>
            <p className="mt-0.5 text-muted-foreground">
              {bill.extractionError ?? "Enter the details by hand below."}
            </p>
          </div>
        </div>
      )}

      {data.confidence && data.confidence !== "HIGH" && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">
              Parts of this bill were hard to read
              {data.confidence === "LOW" ? " — check every figure carefully" : ""}.
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Anything that could not be read is left blank rather than guessed at.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        {/* The bill as photographed */}
        <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            The bill you uploaded
          </Label>
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            {imageUrl ? (
              bill.file.mimeType === "application/pdf" ? (
                <object data={imageUrl} type="application/pdf" className="h-[600px] w-full">
                  <div className="flex flex-col items-center gap-2 p-8 text-center">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{bill.file.name}</p>
                    <a href={imageUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                      Open the PDF
                    </a>
                  </div>
                </object>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={bill.file.name} className="w-full object-contain" />
              )
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                Loading the bill…
              </div>
            )}
          </div>
        </div>

        {/* What was read */}
        <div className="space-y-6">
          <FormSection
            title={isPurchase ? "Who you bought from" : "Who you sold to"}
            description={
              data.partyName
                ? `The bill says "${data.partyName}". Match it to your own records.`
                : "Choose from your own records."
            }
          >
            <Field label={isPurchase ? "Supplier" : "Customer"} required>
              <EntitySelect
                kind={isPurchase ? "supplier" : "customer"}
                value={partyId}
                valueLabel={partyLabel}
                onChange={(id, label) => {
                  setPartyId(id);
                  setPartyLabel(label ?? null);
                }}
                placeholder={isPurchase ? "Choose a supplier" : "Choose a customer"}
              />
            </Field>

            <Field label="Godown / store" required>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm"
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">Choose…</option>
                {warehouses.data?.items.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </Field>
          </FormSection>

          <FormSection title="Bill details">
            {isPurchase && (
              <Field label="Invoice number" required>
                <Input
                  value={data.invoiceNumber ?? ""}
                  onChange={(event) => setField("invoiceNumber", event.target.value || null)}
                  placeholder="As printed on the bill"
                />
              </Field>
            )}

            <Field label="Bill date" required>
              <Input
                type="date"
                value={data.invoiceDate ?? ""}
                onChange={(event) => setField("invoiceDate", event.target.value || null)}
              />
            </Field>

            <Field
              label="Total on the bill"
              hint="For your own check. The system works out its own total from the lines below."
            >
              <Input
                value={data.grandTotal ?? ""}
                onChange={(event) => setField("grandTotal", event.target.value || null)}
                inputMode="decimal"
                placeholder="Not read"
              />
            </Field>
          </FormSection>

          <FormSection
            title="What was on the bill"
            description="Match each line to one of your products. Lines you leave unmatched are not recorded."
          >
            <div className="space-y-3">
              {data.lines.map((line, index) => (
                <div key={index} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {line.description || "(no description read)"}
                      </p>
                      {line.lineTotal && (
                        <p className="text-xs text-muted-foreground">
                          Bill shows ₹{line.lineTotal}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {lineProductIds[index] ? (
                        <Badge variant="outline" className="gap-1 text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />
                          Matched
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not matched
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLine(index)}
                        title="Remove this line"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Your product" required>
                      <EntitySelect
                        kind="product"
                        value={lineProductIds[index] ?? ""}
                        valueLabel={lineProductLabels[index] ?? null}
                        onChange={(id, label) => {
                          setLineProductIds((current) => {
                            const next = [...current];
                            next[index] = id;
                            return next;
                          });
                          setLineProductLabels((current) => {
                            const next = [...current];
                            next[index] = label ?? "";
                            return next;
                          });
                        }}
                        placeholder="Choose a product"
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Quantity">
                        <Input
                          value={line.quantity ?? ""}
                          onChange={(event) => setLine(index, "quantity", event.target.value)}
                          inputMode="decimal"
                        />
                      </Field>
                      <Field label={isPurchase ? "Cost each" : "Price each"}>
                        <Input
                          value={line.unitPrice ?? ""}
                          onChange={(event) => setLine(index, "unitPrice", event.target.value)}
                          inputMode="decimal"
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                Add a line
              </Button>
            </div>
          </FormSection>

          {problems.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">Before this can be recorded:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="outline"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save for later
            </Button>

            <Button
              disabled={!canConfirm || confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isPurchase ? "Record as a purchase" : "Record as a sale"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Recording this creates a real {isPurchase ? "purchase" : "sale"} — it moves stock and
            posts to your accounts, exactly as if you had typed it in.
          </p>
        </div>
      </div>
    </div>
  );
}
