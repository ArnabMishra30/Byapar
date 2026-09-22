import * as React from "react";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";

/**
 * Header, main and footer for every public page.
 *
 * `data-marketing-site` is what globals.css keys smooth scrolling on, so anchor
 * links glide on the public site without changing scroll behaviour inside the
 * shop application.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-marketing-site className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <LandingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <LandingFooter />
    </div>
  );
}
