import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingShell } from "@/features/landing/marketing-shell";
import { RegisterScreen } from "@/features/landing/register-screen";

export const metadata: Metadata = {
  title: "Get started — Byapar",
  description: "How to get your shop set up on Byapar.",
};

export default function Page() {
  return (
    <MarketingShell>
      {/* useSearchParams needs a Suspense boundary for static rendering. */}
      <Suspense fallback={null}>
        <RegisterScreen />
      </Suspense>
    </MarketingShell>
  );
}
