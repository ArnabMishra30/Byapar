import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every page.
 *
 * MOBILE DENSITY IS THE WHOLE POINT HERE. A phone screen is roughly 640px tall;
 * a title, a paragraph of description, a full-width button and a separator can
 * eat a third of it before any content appears. So on a phone:
 *
 *   - the title and the primary action sit on ONE row, not stacked
 *   - the description is small and secondary
 *   - the bottom border is tighter
 *
 * From `sm` up it opens out again, because a laptop has the room and the
 * breathing space reads better there.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b pb-3 sm:pb-5", className)}>
      {/* Title and action share a row on every width. The action is what a
          shopkeeper came to press; pushing it below a paragraph is wrong. */}
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:mt-1.5 sm:text-sm">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A row of filters under a page header.
 *
 * Exists so that "how do filters lay out" is answered once rather than in
 * fifteen pages. On a phone the children wrap and each one is free to be
 * full-width; from `sm` up they sit on a line.
 */
export function FilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
  );
}
