import { Suspense } from "react";
import { LoadingState } from "@/components/shared/states";
import { DocumentForm } from "@/features/documents/document-form";

// Suspense: the form reads the ?customerId / ?supplierId prefill.
export default function Page() {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <DocumentForm kind="sale" />
    </Suspense>
  );
}
