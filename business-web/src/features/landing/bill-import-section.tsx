import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./section-heading";
import { BILL_STEPS, CTA } from "./site-config";

/**
 * The AI bill import story - the product's main selling point.
 *
 * WHAT THIS SECTION IS CAREFUL NOT TO SAY: that reading is instant, that it is
 * always right, or that anything is saved without the owner. None of those is
 * true. The bill is read, the owner checks it, and only their confirmation
 * records it. That honesty is also the pitch: the software does the typing, the
 * owner stays in charge.
 */

/** A photographed invoice inside a phone, drawn in CSS. Decorative. */
function BillVisual() {
  return (
    <figure className="mx-auto w-full max-w-[15rem] sm:max-w-[16rem] lg:mx-0">
      <figcaption className="sr-only">Illustration of a bill being scanned on a phone.</figcaption>

      <div aria-hidden className="relative rotate-[-3deg]">
        <div className="rounded-[2.2rem] border-[7px] border-foreground bg-foreground shadow-2xl shadow-primary/20">
          <div className="relative overflow-hidden rounded-[1.7rem] bg-slate-100 p-3">
            {/* the paper */}
            <div className="rounded-md bg-white p-3 shadow-sm">
              <p className="text-center text-[11px] font-bold tracking-[0.2em] text-slate-700">INVOICE</p>
              <p className="mt-1 text-center text-[8px] font-semibold text-slate-600">ABC Traders</p>
              <div className="mx-auto mt-1 h-1 w-20 rounded bg-slate-200" />

              <div className="mt-3 flex justify-between text-[7px] text-slate-500">
                <span>Bill no. 1042</span>
                <span>12/09/2026</span>
              </div>

              <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
                {[
                  ["Sugar 1kg × 10", "450"],
                  ["Rice 5kg × 4", "1,120"],
                  ["Tea 250g × 6", "540"],
                  ["Oil 1L × 5", "725"],
                ].map(([item, amount]) => (
                  <div key={item} className="flex justify-between gap-2 text-[7px] text-slate-600">
                    <span className="truncate">{item}</span>
                    <span className="tabular-nums">{amount}</span>
                  </div>
                ))}
                {[70, 55, 80].map((width) => (
                  <div key={width} className="h-1 rounded bg-slate-100" style={{ width: `${width}%` }} />
                ))}
              </div>

              <div className="mt-2 flex justify-between border-t border-slate-200 pt-1.5 text-[8px] font-bold text-slate-700">
                <span>Total</span>
                <span className="tabular-nums">₹2,835</span>
              </div>
            </div>

            {/* scan frame corners */}
            {[
              "left-2 top-2 border-l-2 border-t-2 rounded-tl-lg",
              "right-2 top-2 border-r-2 border-t-2 rounded-tr-lg",
              "bottom-2 left-2 border-b-2 border-l-2 rounded-bl-lg",
              "bottom-2 right-2 border-b-2 border-r-2 rounded-br-lg",
            ].map((position) => (
              <span key={position} className={cn("absolute h-6 w-6 border-primary", position)} />
            ))}
            <span className="absolute inset-x-5 top-1/2 h-px bg-primary/60 shadow-[0_0_12px_2px_hsl(var(--primary)/0.4)]" />
          </div>
        </div>

        <span className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/20 bg-background px-3 py-1.5 text-[11px] font-semibold text-primary shadow-md">
          <Sparkles className="h-3.5 w-3.5" />
          Reading the bill…
        </span>
      </div>
    </figure>
  );
}

export function BillImportSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="scroll-mt-20 overflow-hidden border-b border-border/70 bg-gradient-to-b from-accent/70 via-accent/30 to-background py-12 sm:py-20 lg:py-24"
    >
      <Container>
        <div className="grid items-center gap-10 sm:gap-12 lg:grid-cols-[16rem_1fr] lg:gap-16">
          <BillVisual />

          <div>
            <SectionHeading
              id="how-it-works-title"
              align="left"
              eyebrow="Save time with AI"
              title="Turn bill photos into business records."
              description="Upload a photo or PDF of a bill instead of typing it in. The details are read for you, you check them, and only then is anything saved."
            />

            <div className="mt-6 flex max-w-xl items-start gap-3 rounded-xl border border-primary/20 bg-background/80 p-4 shadow-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <p className="text-sm leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">You stay in charge.</span> Nothing
                reaches your books until you confirm it. A creased or blurry photo can be misread,
                which is exactly why you review every bill — and anything that cannot be read
                clearly is left blank for you to fill in.
              </p>
            </div>

            <Button asChild className="mt-6">
              <Link href={CTA.getStarted}>
                Get Started
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        <ol className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:mt-16 lg:grid-cols-5 lg:gap-4">
          {BILL_STEPS.map((step, index) => (
            <li
              key={step.title}
              className={cn(
                "relative flex gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm lg:flex-col lg:gap-3 lg:p-5",
                index === BILL_STEPS.length - 1 && "sm:col-span-2 lg:col-span-1",
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-sm shadow-primary/30">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground sm:text-base">
                  <step.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {step.title}
                </span>
                <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                  {step.description}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
