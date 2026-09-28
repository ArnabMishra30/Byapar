"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye, HandCoins, MoreVertical, Pencil, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DOC_CONFIG, type DocKind } from "./config";
import { isPositive, type DocRow } from "./doc-helpers";

/**
 * The "⋮" menu on one row of a sale or purchase list.
 *
 * Only actions that make sense for THIS document's state appear, and only
 * those this user may take. Editing is for drafts; paying and returning are for
 * completed documents; cancelling is for drafts (a completed one is undone by a
 * return, never cancelled).
 */
export function DocRowActions({ kind, row }: { kind: DocKind; row: DocRow }) {
  const config = DOC_CONFIG[kind];
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const isDraft = row.status === "DRAFT";
  const isPosted = row.status === "POSTED";

  const cancel = useMutation({
    mutationFn: () => config.api.cancel(row.id),
    onSuccess: () => {
      toast.success("Draft cancelled");
      setConfirmCancel(false);
      queryClient.invalidateQueries({ queryKey: [kind] });
    },
    onError: (err) => {
      setConfirmCancel(false);
      toast.error("Could not cancel", {
        description: err instanceof ApiError ? err.message : undefined,
      });
    },
  });

  return (
    // The row itself may be clickable (opens the document); the menu must not
    // trigger that as well.
    <div onClick={(event) => event.stopPropagation()} className="inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-8 sm:w-8"
            aria-label={`Actions for ${row.number || "document"}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={config.detailHref(row.id)}>
              <Eye className="h-4 w-4" />
              View
            </Link>
          </DropdownMenuItem>
          {isDraft && can(config.draftCapability) ? (
            <DropdownMenuItem asChild>
              <Link href={config.editHref(row.id)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={`${config.detailHref(row.id)}?print=1`}>
              <Printer className="h-4 w-4" />
              Print
            </Link>
          </DropdownMenuItem>
          {isPosted && row.partyId && isPositive(row.due) && can(config.paymentCapability) ? (
            <DropdownMenuItem asChild>
              <Link href={config.paymentHref(row.partyId)}>
                <HandCoins className="h-4 w-4" />
                {config.paymentLabel}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {isPosted && can(config.returnCapability) ? (
            <DropdownMenuItem asChild>
              <Link href={config.returnHref(row.id)}>
                <Undo2 className="h-4 w-4" />
                Return items
              </Link>
            </DropdownMenuItem>
          ) : null}
          {isDraft && can(config.postCapability) ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmCancel(true)}
              >
                <Ban className="h-4 w-4" />
                Cancel draft
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this draft?"
        confirmLabel="Cancel draft"
        destructive
        isPending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        description={`${row.number || "This draft"} will be marked cancelled. It was never completed, so no stock or money moved and nothing needs undoing.`}
      />
    </div>
  );
}
