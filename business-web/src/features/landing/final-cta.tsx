import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "./section-heading";
import { CTA } from "./site-config";

export function FinalCta() {
  return (
    <section aria-labelledby="final-cta-title" className="bg-background py-12 sm:py-20">
      <Container>
        <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-12 text-primary-foreground shadow-xl shadow-primary/20 sm:px-12 sm:py-16">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10" />
            <div className="absolute -bottom-28 -left-10 h-64 w-64 rounded-full bg-white/5" />
          </div>

          <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <h2
                id="final-cta-title"
                className="text-[1.75rem] font-extrabold leading-tight tracking-tight sm:text-4xl"
              >
                Ready to manage your business more easily?
              </h2>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-primary-foreground/85 sm:text-lg">
                Get your shop set up, then record sales, purchases and expenses from any device.
              </p>
            </div>

            <div className="flex flex-col gap-3 min-[420px]:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-white text-primary shadow-sm hover:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-primary"
              >
                <Link href={CTA.getStarted}>
                  Get Started
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/50 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground focus-visible:ring-white focus-visible:ring-offset-primary"
              >
                <Link href={CTA.login}>Login</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
