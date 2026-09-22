import type { Metadata } from "next";
import { LegalPlaceholder } from "@/features/landing/legal-placeholder";
import { MarketingShell } from "@/features/landing/marketing-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — Byapar",
  // A placeholder should not be indexed as if it were the policy.
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <MarketingShell>
      <LegalPlaceholder title="Privacy Policy" />
    </MarketingShell>
  );
}
