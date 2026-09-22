import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/landing-page";

// THE PUBLIC MARKETING SITE.
//
// This used to be a redirect gate that bounced everyone to /login. The shop
// application now lives under /shop, which frees the root for what a visitor
// who has never heard of us should actually see.
//
// Deliberately NOT a client component at the top level: the marketing page is
// the one thing here that benefits from being server-rendered, for the people
// who find it through a search engine.

export const metadata: Metadata = {
  title: "Byapar — Business accounting made simple",
  description:
    "Record sales, purchases and expenses in plain language. Track customer credit and supplier dues, photograph bills to import them, and get proper books without the bookkeeping.",
};

export default function Page() {
  return <LandingPage />;
}
