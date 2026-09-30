import { PartyProfile } from "@/features/party-master/party-profile";

export default function Page({ params }: { params: { id: string } }) {
  return <PartyProfile id={params.id} />;
}
