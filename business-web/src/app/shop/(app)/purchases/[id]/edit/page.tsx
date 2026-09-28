import { Suspense } from "react";
import { LoadingState } from "@/components/shared/states";
import { DocumentForm } from "@/features/documents/document-form";

export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<LoadingState rows={5} />}>
      <DocumentForm kind="purchase" id={params.id} />
    </Suspense>
  );
}
