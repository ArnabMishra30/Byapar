import { cn } from "@/lib/utils";
import { Container } from "./section-heading";
import { STRIP_FEATURES } from "./site-config";

/** The five headline capabilities, directly under the hero. */
export function FeatureStrip() {
  return (
    <section aria-label="What you can manage" className="border-b border-border/70 bg-background">
      <Container className="py-8 sm:py-10">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
          {STRIP_FEATURES.map((feature, index) => (
            <li
              key={feature.title}
              className={cn(
                "flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm sm:flex-row sm:items-start sm:p-4",
                // Five items in two columns leaves one alone; let it span.
                index === STRIP_FEATURES.length - 1 && "col-span-2 lg:col-span-1",
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug text-foreground">
                  {feature.title}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {feature.description}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
