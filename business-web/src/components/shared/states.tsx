import * as React from "react";
import { AlertCircle, Inbox, Lock, RefreshCw, SearchX, ShieldAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";

/**
 * The six states every screen must be able to show.
 *
 * A blank screen is the worst possible answer: the user cannot tell whether the
 * app is thinking, empty, or broken. Nothing in this application renders nothing.
 */

function StateShell({
  icon: Icon,
  tone = "muted",
  title,
  description,
  action,
  className,
}: {
  icon: React.ElementType;
  tone?: "muted" | "danger" | "warning";
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    muted: "border-dashed border-border bg-muted/30 text-muted-foreground",
    danger: "border-destructive/20 bg-destructive/5 text-destructive",
    warning: "border-warning/25 bg-warning/5 text-warning",
  } as const;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border px-4 py-6 text-center sm:p-8",
        tones[tone],
        className,
      )}
      role={tone === "danger" ? "alert" : undefined}
    >
      <Icon className="mb-2.5 h-7 w-7 sm:mb-3 sm:h-8 sm:w-8" aria-hidden />
      <h3 className="text-sm font-semibold text-foreground sm:text-base">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-3 sm:mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-xl sm:h-16" />
      ))}
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
  icon = Inbox,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ElementType;
  className?: string;
}) {
  return <StateShell icon={icon} title={title} description={description} action={action} className={className} />;
}

export function NoResultsState({ onClear }: { onClear?: () => void }) {
  return (
    <StateShell
      icon={SearchX}
      title="No matches"
      description="Nothing matched what you searched for. Try a different word, or clear the filters."
      action={
        onClear ? (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

export function ForbiddenState({ message }: { message?: string }) {
  return (
    <StateShell
      icon={Lock}
      tone="warning"
      title="You do not have access to this"
      description={message ?? "Ask an admin in your business to do this for you, or to change your role."}
    />
  );
}

export function NotFoundState({ description }: { description?: string }) {
  return (
    <StateShell
      icon={ShieldAlert}
      title="Not found"
      description={description ?? "This may have been deleted, or it belongs to another business."}
    />
  );
}

/**
 * Turns any failure into something a shopkeeper can act on.
 *
 * Never shows a stack trace, a SQL string or an internal error. The backend
 * sends a plain business message; anything else gets a generic one.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;

  if (api?.isForbidden) return <ForbiddenState message={api.message} />;
  if (api?.isNotFound) return <NotFoundState description={api.message} />;

  if (api?.isOffline) {
    return (
      <StateShell
        icon={WifiOff}
        tone="danger"
        title="Cannot reach the server"
        description="Check your internet connection. Your work is not lost."
        action={
          onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <StateShell
      icon={AlertCircle}
      tone="danger"
      title="Something went wrong"
      description={api?.message ?? "Please try again in a moment."}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
