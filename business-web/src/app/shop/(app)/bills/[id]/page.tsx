import { BillReviewScreen } from "@/features/bills/bill-review";

export default function Page({ params }: { params: { id: string } }) {
  return <BillReviewScreen billId={params.id} />;
}
