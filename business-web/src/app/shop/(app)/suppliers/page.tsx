import { Suspense } from "react";
import { PartyList } from "@/features/parties/party-list";

export default function SuppliersPage() {
  // ?new=1 opens the add dialog; reading it needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <PartyList kind="supplier" />
    </Suspense>
  );
}
