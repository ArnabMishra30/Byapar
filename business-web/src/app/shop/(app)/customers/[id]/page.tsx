import { PartyDetail } from "@/features/parties/party-detail";

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  return <PartyDetail kind="customer" id={params.id} />;
}
