import { Suspense } from "react";
import { ReturnForm } from "@/features/returns/return-form";

export default function Page() {
  return (
    // useSearchParams (the preselected document) needs a Suspense boundary for the static build.
    <Suspense fallback={null}>
      <ReturnForm kind="sale" />
    </Suspense>
  );
}
