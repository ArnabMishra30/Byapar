import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Shield, Store } from "lucide-react";

interface GstBadgeProps {
  isGstEnabled?: boolean;
  registrationType?: string;
  className?: string;
}

export function GstBadge({
  isGstEnabled,
  registrationType = "UNREGISTERED",
  className,
}: GstBadgeProps) {
  const isRegistered =
    isGstEnabled ||
    (registrationType && registrationType !== "UNREGISTERED");

  if (isRegistered) {
    return (
      <Badge
        variant="info"
        className={cn(
          "gap-1 font-medium bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800",
          className
        )}
      >
        <Shield className="w-3 h-3 text-sky-600 dark:text-sky-400" />
        <span>GST Registered</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
        className
      )}
    >
      <Store className="w-3 h-3 text-slate-500" />
      <span>Non-GST (Local Shop)</span>
    </Badge>
  );
}
