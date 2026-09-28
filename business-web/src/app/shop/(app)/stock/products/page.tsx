import { Suspense } from "react";
import { ProductsPage } from "@/features/products/products-page";

export default function Page() {
  // useSearchParams (?new=1) needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={null}>
      <ProductsPage />
    </Suspense>
  );
}
