import { BenefitsSection } from "./benefits-section";
import { BillImportSection } from "./bill-import-section";
import { FaqSection } from "./faq-section";
import { FeatureStrip } from "./feature-strip";
import { FeaturesSection } from "./features-section";
import { FinalCta } from "./final-cta";
import { HeroSection } from "./hero-section";
import { MarketingShell } from "./marketing-shell";
import { PricingSection } from "./pricing-section";

/**
 * The public marketing site, assembled from its sections.
 *
 * Not a client component. Only the parts that need the browser - the mobile
 * menu, the FAQ accordion and the live price list - opt in with "use client";
 * everything else is plain server-rendered HTML, which is what a search engine
 * and a slow phone connection both want.
 *
 * Content lives in site-config.ts. Sections live in their own files. This file
 * only decides the order.
 */
export function LandingPage() {
  return (
    <MarketingShell>
      <HeroSection />
      <FeatureStrip />
      <BillImportSection />
      <FeaturesSection />
      <PricingSection />
      <BenefitsSection />
      <FaqSection />
      <FinalCta />
    </MarketingShell>
  );
}
