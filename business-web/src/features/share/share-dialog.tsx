"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Link2, Loader2, MessageCircle, Share2, Ban } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  shareLinksApi,
  sharePath,
  type CreateShareLinkInput,
  type ShareLink,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Can } from "@/components/shared/permission-gate";
import { useAuth } from "@/lib/auth/auth-context";
import { formatDateTime } from "@/lib/utils";

type Target =
  | { kind: "INVOICE"; salesInvoiceId: string; customerName?: string; invoiceNumber?: string | null }
  | { kind: "CUSTOMER_ACCOUNT"; customerId: string; name: string }
  | { kind: "SUPPLIER_ACCOUNT"; supplierId: string; name: string };

function matches(link: ShareLink, target: Target, includeAccount: boolean) {
  if (!link.isActive || link.kind !== target.kind) return false;
  if (target.kind === "INVOICE") return link.salesInvoiceId === target.salesInvoiceId && link.includeAccount === includeAccount;
  if (target.kind === "CUSTOMER_ACCOUNT") return link.customerId === target.customerId;
  return link.supplierId === target.supplierId;
}

function listQuery(target: Target) {
  if (target.kind === "INVOICE") return { salesInvoiceId: target.salesInvoiceId };
  if (target.kind === "CUSTOMER_ACCOUNT") return { customerId: target.customerId };
  return { supplierId: target.supplierId };
}

/** "Opened 3 times, last on ..." - so the shop knows the customer has seen it. */
export function SeenLine({ link }: { link: ShareLink }) {
  if (!link.lastViewedAt) return <span className="text-muted-foreground">Not opened yet</span>;
  return (
    <span className="inline-flex items-center gap-1 text-success">
      <Eye className="h-3.5 w-3.5" />
      Opened {link.viewCount} time{link.viewCount === 1 ? "" : "s"} · last {formatDateTime(link.lastViewedAt)}
    </span>
  );
}

/**
 * The Share button and its dialog, for an invoice or a customer/supplier log
 * book. The link opens a read-only page with no login; it works until the shop
 * presses Stop sharing.
 */
export function ShareButton({ target, size = "default" }: { target: Target; size?: "default" | "sm" }) {
  const [open, setOpen] = React.useState(false);
  const { can } = useAuth();
  // A whole account shows every bill of that party, so it also needs reports.
  if (target.kind !== "INVOICE" && !can("reports.read")) return null;
  return (
    <Can do="share.create">
      <Button variant="outline" size={size} className="min-h-[44px] gap-1.5 sm:min-h-0" onClick={() => setOpen(true)}>
        <Share2 className="h-4 w-4" />
        Share
      </Button>
      {open ? <ShareDialog target={target} open={open} onOpenChange={setOpen} /> : null}
    </Can>
  );
}

export function ShareDialog({
  target,
  open,
  onOpenChange,
  title,
}: {
  target: Target;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Overrides the heading, e.g. right after a bill is recorded. */
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [includeAccount, setIncludeAccount] = React.useState(false);
  const [confirmStop, setConfirmStop] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const queryKey = ["share-links", listQuery(target)];
  const links = useQuery({ queryKey, queryFn: () => shareLinksApi.list(listQuery(target)), enabled: open });
  const active = (links.data ?? []).find((link) => matches(link, target, includeAccount)) ?? null;

  const create = useMutation({
    mutationFn: () => {
      const body: CreateShareLinkInput =
        target.kind === "INVOICE"
          ? { kind: "INVOICE", salesInvoiceId: target.salesInvoiceId, includeAccount }
          : target.kind === "CUSTOMER_ACCOUNT"
            ? { kind: "CUSTOMER_ACCOUNT", customerId: target.customerId }
            : { kind: "SUPPLIER_ACCOUNT", supplierId: target.supplierId };
      return shareLinksApi.create(body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["share-links"] }),
    onError: (err) => toast.error("Could not create the link", { description: err instanceof ApiError ? err.message : undefined }),
  });

  const stop = useMutation({
    mutationFn: (id: string) => shareLinksApi.revoke(id),
    onSuccess: () => {
      toast.success("Sharing stopped. The link no longer opens.");
      setConfirmStop(false);
      queryClient.invalidateQueries({ queryKey: ["share-links"] });
    },
    onError: (err) => toast.error("Could not stop sharing", { description: err instanceof ApiError ? err.message : undefined }),
  });

  const url = active && typeof window !== "undefined" ? `${window.location.origin}${sharePath(active.token)}` : "";

  const what =
    target.kind === "INVOICE"
      ? `invoice${target.invoiceNumber ? ` ${target.invoiceNumber}` : ""}`
      : "account statement";
  const message = `Hello${target.kind === "INVOICE" && target.customerName ? ` ${target.customerName}` : target.kind !== "INVOICE" ? ` ${target.name}` : ""}, here is your ${what}: ${url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the link and copy it.");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title ?? `Share ${target.kind === "INVOICE" ? "invoice" : "account"}`}</DialogTitle>
            <DialogDescription>
              Anyone with the link can see this {target.kind === "INVOICE" ? "bill" : "log book"} on their phone without
              logging in. They cannot change anything. It works until you stop sharing.
            </DialogDescription>
          </DialogHeader>

          {target.kind === "INVOICE" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What to share">
              {[
                { value: false, title: "This bill only", hint: "Just this invoice" },
                { value: true, title: "Bill + full account", hint: "Also every bill, payment and balance" },
              ].map((option) => (
                <label
                  key={String(option.value)}
                  className={`flex min-h-[64px] cursor-pointer flex-col justify-center rounded-lg border p-3 ${
                    includeAccount === option.value ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={includeAccount === option.value}
                    onChange={() => setIncludeAccount(option.value)}
                  />
                  <span className="text-sm font-medium">{option.title}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </label>
              ))}
            </div>
          ) : null}

          {links.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : active ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} className="min-w-0 flex-1" />
                <Button variant="outline" onClick={copy} aria-label="Copy link" className="shrink-0">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button asChild className="min-h-[44px] gap-1.5">
                  <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Send on WhatsApp
                  </a>
                </Button>
                <Button asChild variant="outline" className="min-h-[44px] gap-1.5">
                  <a href={url} target="_blank" rel="noreferrer">
                    <Link2 className="h-4 w-4" />
                    Open the page
                  </a>
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
                <SeenLine link={active} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setConfirmStop(true)}
                >
                  <Ban className="h-4 w-4" />
                  Stop sharing
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Opening the page yourself also counts as a view.
              </p>
            </div>
          ) : (
            <Button className="min-h-[44px] gap-1.5" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create link
            </Button>
          )}

          {title ? (
            <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
              {active ? "Done" : "Not now"}
            </Button>
          ) : null}

          {(links.data ?? []).some((link) => !link.isActive) ? (
            <p className="text-xs text-muted-foreground">
              Older links you stopped sharing no longer open.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop sharing this link?"
        confirmLabel="Stop sharing"
        destructive
        isPending={stop.isPending}
        onConfirm={() => active && stop.mutate(active.id)}
        description="Anyone who has the link will see “no longer available”. You can always create a new link later."
      />
    </>
  );
}
