import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  title: string;
  value: string | number | React.ReactNode;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: number | string;
    isPositive?: boolean;
    label?: string;
  };
  isLoading?: boolean;
  colorScheme?: "default" | "emerald" | "indigo" | "amber" | "rose" | "sky";
  badge?: React.ReactNode;
  className?: string;
}

const colorVariants = {
  default: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  isLoading,
  colorScheme = "default",
  badge,
  className,
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card className={cn("overflow-hidden", className)}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-36 mb-2" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all duration-200 hover:shadow-md hover:border-border/80",
        className
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {title}
            </span>
            {badge}
          </div>
          {Icon && (
            <div
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                colorVariants[colorScheme]
              )}
            >
              <Icon className="w-5 h-5" />
            </div>
          )}
        </div>

        <div className="text-2xl font-bold text-foreground tracking-tight mb-1">
          {value}
        </div>

        {(description || trend) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            {trend && (
              <span
                className={cn(
                  "inline-flex items-center font-medium",
                  trend.isPositive
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              >
                {trend.isPositive ? (
                  <TrendingUp className="w-3 h-3 mr-0.5" />
                ) : (
                  <TrendingDown className="w-3 h-3 mr-0.5" />
                )}
                {trend.value}
              </span>
            )}
            {description && <span>{description}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
