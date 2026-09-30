import { Suspense } from "react";
import { NewPartyPage } from "@/features/party-master/new-party-page";

export default function Page() {
  // ?relationship=SUPPLIER&name=... pre-fills the form; Next needs a Suspense
  // boundary to read the query string.
  return (
    <Suspense fallback={null}>
      <NewPartyPage />
    </Suspense>
  );
}
