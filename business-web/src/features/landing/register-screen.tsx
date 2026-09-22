"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, LogIn, Mail, Phone, Store, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRupees, planSlug } from "./plan-format";
import { Container, Eyebrow } from "./section-heading";
import { CTA, SITE } from "./site-config";
import { usePlans } from "./use-plans";

/**
 * "Get Started", honestly.
 *
 * There is no self-service sign-up in this product: a business is registered by
 * the sales team, who create the owner's login and activate the plan in one step.
 * A sign-up form here would collect details and send them nowhere, so instead
 * this page says how getting started actually works.
 */

const STEPS = [
  {
    icon: Phone,
    title: "Get in touch",
    description: "Tell us about your shop and the plan you would like.",
  },
  {
    icon: Store,
    title: "We set up your business",
    description: "Your shop, your login and your plan are created for you.",
  },
  {
    icon: UserRoundCheck,
    title: "Sign in and start",
    description: "Log in on your phone or computer and start recording.",
  },
];

export function RegisterScreen() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("plan");
  const { plans } = usePlans();
  const chosen = requested ? plans.find((plan) => planSlug(plan) === requested) : undefined;
  const { email, phone } = SITE.contact;

  return (
    <section className="border-b border-border/70 bg-gradient-to-b from-accent/60 to-background py-12 sm:py-16">
      <Container className="max-w-3xl">
        <Eyebrow>Get started</Eyebrow>
        <h1 className="mt-4 text-[1.9rem] font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
          Let&apos;s get your shop set up
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Accounts are set up by our team, so your business, login and plan are ready before you
          start. There is nothing to install.
        </p>

        {chosen ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/25 bg-background p-4 shadow-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm text-foreground">
              You picked the <span className="font-semibold">{chosen.name}</span> plan —{" "}
              <span className="font-semibold tabular-nums">{formatRupees(chosen.price)}</span> for{" "}
              {chosen.durationLabel}. Mention it when you get in touch.
            </p>
          </div>
        ) : null}

        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {index + 1}
              </span>
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <step.icon className="h-4 w-4 text-primary" aria-hidden />
                {step.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-foreground">Talk to us</h2>

          {email || phone ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              {phone ? (
                <Button asChild size="lg">
                  <a href={`tel:${phone.replace(/\s+/g, "")}`}>
                    <Phone aria-hidden />
                    {phone}
                  </a>
                </Button>
              ) : null}
              {email ? (
                <Button asChild size="lg" variant="outline">
                  <a href={`mailto:${email}`}>
                    <Mail aria-hidden />
                    {email}
                  </a>
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Speak to a {SITE.brand} sales representative — they can register your business and
              activate your plan on the spot.
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Already have an account?</p>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <Button asChild variant="outline">
              <a href="/#pricing">Compare plans</a>
            </Button>
            <Button asChild>
              <Link href={CTA.login}>
                <LogIn aria-hidden />
                Log in to your shop
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
