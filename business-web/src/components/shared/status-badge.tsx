import { Badge } from "@/components/ui/badge";

/**
 * A document status, in words a shopkeeper uses.
 *
 * "Draft" and "Posted" are the two that matter: a draft has changed nothing,
 * a posted document has moved stock and money and cannot be edited.
 */
const LABELS: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  POSTED: { label: "Posted", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
  REVERSED: { label: "Reversed", variant: "warning" },
  OPEN: { label: "Unpaid", variant: "warning" },
  PARTIALLY_PAID: { label: "Part paid", variant: "warning" },
  PAID: { label: "Paid", variant: "success" },
  CREDITED: { label: "Credited", variant: "outline" },
  CLOSED: { label: "Closed", variant: "destructive" },
  ACTIVE: { label: "Active", variant: "success" },
  INACTIVE: { label: "Inactive", variant: "outline" },
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const entry = LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
