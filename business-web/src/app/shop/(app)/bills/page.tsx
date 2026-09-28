import { Suspense } from "react";
import { BillListScreen } from "@/features/bills/bill-list";
import { LoadingState } from "@/components/shared/states";

export default function BillsPage() {
  // useSearchParams (for ?upload=1) needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<LoadingState />}>
      <BillListScreen />
    </Suspense>
  );
}
