import { Suspense } from "react";
import { PartyList } from "@/features/parties/party-list";

export default function CustomersPage() {
  // PartyList reads the query string; Next needs a Suspense boundary for that.
  return (
    <Suspense fallback={null}>
      <PartyList kind="customer" />
    </Suspense>
  );
}
