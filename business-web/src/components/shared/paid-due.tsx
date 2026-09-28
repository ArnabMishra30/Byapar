import { Money } from "./money";
import { cn } from "@/lib/utils";

/**
 * "PAID ₹1,000 · DUE ₹825" - the answer a shopkeeper wants from any bill.
 *
 * Both figures come from the backend (the receivable or payable behind the
 * document). Nothing is subtracted here: if the backend did not say, the
 * figure is not shown.
 */
export function PaidDue({
  paid,
  due,
  total,
  size = "sm",
  className,
}: {
  paid?: string | null;
  due?: string | null;
  total?: string | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  const hasDue = due != null && Number(due) > 0;
  const label = size === "lg" ? "text-xs" : "text-[10px]";
  const value = size === "lg" ? "text-lg font-bold sm:text-xl" : "text-sm font-semibold";

  return (
    <div className={cn("flex flex-wrap items-stretch gap-2", className)}>
      {total != null ? (
        <Figure label="Total" labelClass={label}>
          <Money value={total} className={value} />
        </Figure>
      ) : null}
      {paid != null ? (
        <Figure label="Paid" labelClass={cn(label, "text-success")} tone="paid">
          <Money value={paid} className={cn(value, "text-success")} />
        </Figure>
      ) : null}
      {due != null ? (
        <Figure
          label={hasDue ? "Due" : "Nothing due"}
          labelClass={cn(label, hasDue ? "text-warning" : "text-muted-foreground")}
          tone={hasDue ? "due" : undefined}
        >
          <Money value={due} className={cn(value, hasDue ? "text-warning" : "text-muted-foreground")} />
        </Figure>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  labelClass,
  tone,
  children,
}: {
  label: string;
  labelClass: string;
  tone?: "paid" | "due";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border px-3 py-1.5",
        tone === "paid" && "border-success/30 bg-success/5",
        tone === "due" && "border-warning/40 bg-warning/5",
      )}
    >
      <p className={cn("font-semibold uppercase tracking-wide", labelClass)}>{label}</p>
      <div className="truncate">{children}</div>
    </div>
  );
}
