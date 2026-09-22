"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicPlan } from "@/lib/api/public";
import { cn } from "@/lib/utils";
import { bestValuePlanId, formatRupees, monthlyPrice, monthsIn, planSlug } from "./plan-format";
import { Container, SectionHeading } from "./section-heading";
import { CTA, PLAN_INCLUDES, SITE } from "./site-config";
import { usePlans } from "./use-plans";

function contactHref(): string {
  if (SITE.contact.email) return `mailto:${SITE.contact.email}`;
  if (SITE.contact.phone) return `tel:${SITE.contact.phone.replace(/\s+/g, "")}`;
  // No contact details configured: the get-started page explains onboarding.
  return CTA.getStarted;
}

function PlanCard({ plan, isBestValue }: { plan: PublicPlan; isBestValue: boolean }) {
  const perMonth = monthlyPrice(plan);
  const months = monthsIn(plan);

  return (
    <article
      className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-card p-6 shadow-sm",
        isBestValue
          ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/30"
          : "border-border/70",
      )}
    >
      {isBestValue ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground shadow-sm">
          Best value
        </span>
      ) : null}

      <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
      {plan.description ? (
        <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
      ) : null}

      <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span className="text-4xl font-extrabold tracking-tight tabular-nums text-foreground">
          {formatRupees(plan.price)}
        </span>
        <span className="text-sm text-muted-foreground">for {plan.durationLabel}</span>
      </p>

      {/* Only worth saying when the plan is longer than a month. */}
      {perMonth !== null && months !== null && months > 1 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          About {formatRupees(Math.round(perMonth))} a month
        </p>
      ) : null}

      <ul className="mt-5 flex-1 space-y-2.5">
        {PLAN_INCLUDES.map((line) => (
          <li key={line} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-muted-foreground">{line}</span>
          </li>
        ))}
      </ul>

      <Button asChild size="lg" variant={isBestValue ? "default" : "outline"} className="mt-6 w-full">
        <Link href={`${CTA.getStarted}?plan=${planSlug(plan)}`}>
          Get Started
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </article>
  );
}

export function PricingSection() {
  const { plans, isLoading } = usePlans();
  const bestValue = bestValuePlanId(plans);

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="scroll-mt-20 border-b border-border/70 bg-gradient-to-b from-accent/60 via-accent/20 to-background py-12 sm:py-20 lg:py-24"
    >
      <Container>
        <div className="grid gap-10 lg:grid-cols-[19rem_1fr] lg:gap-12">
          <div className="lg:pt-4">
            <SectionHeading
              id="pricing-title"
              align="left"
              eyebrow="Simple pricing"
              title="Affordable plans for every business"
              description="One price, every feature. No per-user charges and nothing held back for a higher tier."
            />

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  Subscriptions are activated by our team — there is no online payment in the
                  application.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>Plans and features may change as the product evolves.</span>
              </li>
            </ul>
          </div>

          <div className="grid gap-5 pt-3 sm:grid-cols-2 xl:grid-cols-3">
            {isLoading ? (
              <>
                <Skeleton className="h-[26rem] w-full rounded-2xl" />
                <Skeleton className="h-[26rem] w-full rounded-2xl" />
              </>
            ) : (
              plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} isBestValue={plan.id === bestValue} />
              ))
            )}

            <aside className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-primary/30 bg-background/70 p-6 sm:col-span-2 xl:col-span-1">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarCheck className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">Need help choosing?</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Talk to us and we will help you pick the right plan for your shop.
              </p>
              <Button asChild variant="outline" className="mt-5 w-full sm:w-auto xl:w-full">
                <a href={contactHref()}>Contact us</a>
              </Button>
            </aside>
          </div>
        </div>
      </Container>
    </section>
  );
}
