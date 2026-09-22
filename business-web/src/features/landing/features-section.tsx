import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./section-heading";
import { FEATURES, type FeatureTone } from "./site-config";

/**
 * A deliberately small palette. Literal class strings, because Tailwind only
 * generates classes it can see written out in full.
 */
const TONES: Record<FeatureTone, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  sky: "bg-sky-50 text-sky-700 ring-sky-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100",
};

export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="scroll-mt-20 border-b border-border/70 bg-background py-12 sm:py-20 lg:py-24"
    >
      <Container>
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Everything you need to manage your business"
          description="Built for shop owners, without the complexity of accounting software."
        />

        <ul className="mt-8 grid gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="group flex h-full gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md motion-reduce:transform-none"
            >
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1",
                  TONES[feature.tone],
                )}
              >
                <feature.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
