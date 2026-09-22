import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./section-heading";
import { BENEFITS } from "./site-config";

export function BenefitsSection() {
  return (
    <section
      id="benefits"
      aria-labelledby="benefits-title"
      className="scroll-mt-20 border-b border-border/70 bg-background py-12 sm:py-20 lg:py-24"
    >
      <Container className="grid gap-12 lg:grid-cols-[20rem_1fr] lg:items-center lg:gap-16">
        <SectionHeading
          id="benefits-title"
          align="left"
          eyebrow="Why choose us"
          title="Built for real business needs"
          description="Running a shop leaves little time for paperwork. This is built to give some of that time back, and to make the numbers easy to trust."
        />

        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-y-8 xl:grid-cols-5">
          {BENEFITS.map((benefit, index) => (
            <li
              key={benefit.title}
              className={cn(
                "flex flex-col items-center text-center",
                index === BENEFITS.length - 1 && "col-span-2 sm:col-span-1",
              )}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary ring-8 ring-primary/5 sm:h-16 sm:w-16">
                <benefit.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-semibold leading-snug text-foreground sm:text-base">
                {benefit.title}
              </h3>
              <p className="mt-1 text-xs leading-snug text-muted-foreground sm:text-sm">
                {benefit.description}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
