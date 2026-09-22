import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "credit" | "dues" | "cash";

const TONES: Record<StatTone, string> = {
  default: "bg-primary/10 text-primary",
  credit: "bg-warning/10 text-warning",
  dues: "bg-destructive/10 text-destructive",
  cash: "bg-success/10 text-success",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  isLoading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ElementType;
  tone?: StatTone;
  href?: string;
  isLoading?: boolean;
}) {
  const body = (
    <Card className={cn("h-full transition-colors", href && "hover:border-primary/40")}>
      <CardContent className="flex items-start gap-2.5 p-3 sm:gap-3 sm:p-4">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10", TONES[tone])}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">{label}</p>
          {isLoading ? (
            <Skeleton className="mt-1.5 h-5 w-20 sm:h-6 sm:w-24" />
          ) : (
            <p className="mt-0.5 truncate text-base font-bold tabular-nums text-foreground sm:text-xl">{value}</p>
          )}
          {hint && !isLoading ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
