import { Suspense } from "react";
import { LoadingState } from "@/components/shared/states";
import { PurchaseBillList } from "@/features/purchases/purchase-bill-list";

// Suspense: the list reads ?tab= with useSearchParams.
export default function Page() {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <PurchaseBillList />
    </Suspense>
  );
}
