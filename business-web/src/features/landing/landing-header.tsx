"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./brand-mark";
import { CTA, NAV_LINKS } from "./site-config";

/**
 * The sticky site header.
 *
 * On a phone the navigation collapses into an inline panel under the bar rather
 * than a slide-over: four links and two buttons do not justify a modal, and an
 * inline panel keeps the page's own scroll position and focus order intact.
 */
export function LandingHeader() {
  const [open, setOpen] = React.useState(false);

  // Escape closes the menu, as it would any other disclosure.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Tablet width cannot fit the tagline beside the full nav, so it waits for lg. */}
        <BrandMark taglineClassName="md:hidden lg:block" />

        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex lg:gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 text-sm font-medium lg:px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button variant="outline" asChild className="border-primary/40 text-primary hover:text-primary">
            <Link href={CTA.login}>Login</Link>
          </Button>
          <Button asChild>
            <Link href={CTA.getStarted}>
              Get Started
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        {/* A full 44px touch target, not an icon floating in whitespace. */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="landing-mobile-menu"
          onClick={() => setOpen((value) => !value)}
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      <div
        id="landing-mobile-menu"
        hidden={!open}
        className="border-t border-border/70 bg-background md:hidden"
      >
        <nav aria-label="Mobile" className="mx-auto flex w-full max-w-6xl flex-col px-4 py-2">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={close}
              className="flex h-12 items-center rounded-lg px-2 text-base font-medium text-foreground transition-colors hover:bg-accent"
            >
              {link.label}
            </a>
          ))}
          <div className="grid grid-cols-2 gap-2 py-3">
            <Button variant="outline" size="lg" asChild>
              <Link href={CTA.login} onClick={close}>
                Login
              </Link>
            </Button>
            <Button size="lg" asChild>
              <Link href={CTA.getStarted} onClick={close}>
                Get Started
              </Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
