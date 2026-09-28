import { ReturnDetail } from "@/features/returns/return-detail";

export default function Page({ params }: { params: { id: string } }) {
  return <ReturnDetail kind="sale" id={params.id} />;
}
