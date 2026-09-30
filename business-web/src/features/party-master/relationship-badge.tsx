import { Badge } from "@/components/ui/badge";
import { RELATIONSHIP_LABEL, type PartyRelationship } from "@/lib/api/parties";

/** Customer, Supplier or Both, in one consistent colour each. */
export function RelationshipBadge({ relationship }: { relationship: PartyRelationship | "NONE" }) {
  const variant = relationship === "BOTH" ? "default" : relationship === "CUSTOMER" ? "success" : relationship === "SUPPLIER" ? "warning" : "outline";
  return (
    <Badge variant={variant} className="whitespace-nowrap">
      {RELATIONSHIP_LABEL[relationship]}
    </Badge>
  );
}
