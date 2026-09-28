import { Suspense } from "react";
import { PartyDetail } from "@/features/parties/party-detail";

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  // ?tab=statement (from the credit book) is read from the query string.
  return (
    <Suspense fallback={null}>
      <PartyDetail kind="customer" id={params.id} />
    </Suspense>
  );
}
