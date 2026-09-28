import { ReturnDetail } from "@/features/returns/return-detail";

export default function Page({ params }: { params: { id: string } }) {
  return <ReturnDetail kind="purchase" id={params.id} />;
}
