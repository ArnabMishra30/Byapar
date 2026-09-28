import { Suspense } from "react";
import { MoneyPage } from "@/features/money/money-page";

export default function Page() {
  // Reads ?supplierId= from the query string, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <MoneyPage kind="out" />
    </Suspense>
  );
}
