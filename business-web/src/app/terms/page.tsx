import type { Metadata } from "next";
import { LegalPlaceholder } from "@/features/landing/legal-placeholder";
import { MarketingShell } from "@/features/landing/marketing-shell";

export const metadata: Metadata = {
  title: "Terms of Service — Byapar",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <MarketingShell>
      <LegalPlaceholder title="Terms of Service" />
    </MarketingShell>
  );
}
