import { PartyStatementPage } from "@/features/party-master/party-statement";

export default function Page({ params }: { params: { id: string } }) {
  return <PartyStatementPage id={params.id} />;
}
