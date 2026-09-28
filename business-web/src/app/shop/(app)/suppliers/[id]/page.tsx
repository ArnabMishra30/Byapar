import { Suspense } from "react";
import { PartyDetail } from "@/features/parties/party-detail";

export default function SupplierDetailPage({ params }: { params: { id: string } }) {
  // ?tab=statement (from the credit book) is read from the query string.
  return (
    <Suspense fallback={null}>
      <PartyDetail kind="supplier" id={params.id} />
    </Suspense>
  );
}
