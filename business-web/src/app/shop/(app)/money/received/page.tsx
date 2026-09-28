import { Suspense } from "react";
import { MoneyPage } from "@/features/money/money-page";

export default function Page() {
  // Reads ?customerIdId from the query string, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <MoneyPage kind="in" />
    </Suspense>
  );
}
