import { Suspense } from "react";
import { LoadingState } from "@/components/shared/states";
import { DocumentDetail } from "@/features/documents/document-detail";

// Suspense: the detail reads ?print=1.
export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <DocumentDetail kind="sale" id={params.id} />
    </Suspense>
  );
}
