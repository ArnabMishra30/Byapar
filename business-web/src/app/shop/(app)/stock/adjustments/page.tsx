import { Suspense } from "react";
import { AdjustmentsPage } from "@/features/stock/adjustments-page";

export default function Page() {
  // useSearchParams (?productId=) needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={null}>
      <AdjustmentsPage />
    </Suspense>
  );
}
