import { PartyDetail } from "@/features/parties/party-detail";

export default function SupplierDetailPage({ params }: { params: { id: string } }) {
  return <PartyDetail kind="supplier" id={params.id} />;
}
