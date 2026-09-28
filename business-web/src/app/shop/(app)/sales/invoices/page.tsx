import { Suspense } from "react";
import { LoadingState } from "@/components/shared/states";
import { InvoiceList } from "@/features/sales/invoice-list";

// Suspense: the list reads ?tab= with useSearchParams.
export default function Page() {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <InvoiceList />
    </Suspense>
  );
}
