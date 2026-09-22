import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "./dashboard-preview";
import { Container, Eyebrow } from "./section-heading";
import { CTA, TRUST_POINTS } from "./site-config";

export function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden border-b border-border/70">
      {/* Soft green wash. Inside overflow-hidden, so the blurred shapes can never
          push the page sideways on a narrow phone. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-accent via-accent/40 to-background" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -left-40 bottom-0 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <Container className="grid items-center gap-10 py-10 sm:gap-12 sm:py-16 lg:grid-cols-2 lg:gap-10 lg:py-20">
        <div>
          <Eyebrow>For shops, retailers and small businesses</Eyebrow>

          <h1
            id="hero-title"
            className="mt-5 text-[2rem] font-extrabold leading-[1.08] tracking-tight text-foreground min-[400px]:text-[2.5rem] sm:text-5xl lg:text-[2.75rem] xl:text-5xl"
          >
            {/*
              One phrase per line. At 56px "Track your business." measured wider
              than its half-width column and broke into four lines; 44px (lg) and
              48px (xl) fit. nowrap applies only from lg - below that, words wrap
              naturally rather than risking overflow on a phone.
            */}
            <span className="block lg:whitespace-nowrap">Run your shop.</span>
            <span className="block lg:whitespace-nowrap">Track your business.</span>
            <span className="block text-primary lg:whitespace-nowrap">Stay in control.</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Manage sales, purchases, inventory, customers, suppliers, expenses and credit from one
            simple platform.
          </p>

          <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
            <Button size="lg" asChild>
              <Link href={CTA.getStarted}>
                Get Started
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={CTA.howItWorks}>
                <PlayCircle aria-hidden className="text-primary" />
                See How It Works
              </a>
            </Button>
          </div>

          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {TRUST_POINTS.map((point) => (
              <li key={point.title} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-background text-primary shadow-sm">
                  <point.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{point.title}</span>
                  <span className="block text-xs text-muted-foreground">{point.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <DashboardPreview />
      </Container>
    </section>
  );
}
