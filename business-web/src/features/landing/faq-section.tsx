import Link from "next/link";
import { Headphones, LogIn, Mail, Phone } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Container, SectionHeading } from "./section-heading";
import { CTA, FAQS, SITE } from "./site-config";

export function FaqSection() {
  const { email, phone } = SITE.contact;

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="scroll-mt-20 border-b border-border/70 bg-background py-12 sm:py-20 lg:py-24"
    >
      {/*
        DOM ORDER IS READING ORDER ON A PHONE: heading, then the questions, then
        "still have questions?". Stacking the help card above the questions -
        which a two-column source order produced - asked people whether they had
        questions before showing them any answers.

        On large screens the grid lifts the help card back into the left column,
        under the heading, with the questions spanning both rows on the right.
      */}
      <Container className="grid gap-8 lg:grid-cols-[20rem_1fr] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-6">
        <SectionHeading
          id="faq-title"
          align="left"
          eyebrow="FAQ"
          title="Common questions"
          description="Straight answers about what the platform does — and what it does not."
          className="lg:col-start-1 lg:row-start-1"
        />

        <Accordion
          type="single"
          collapsible
          defaultValue={FAQS[0]?.id}
          className="rounded-2xl border border-border/70 bg-card px-4 shadow-sm sm:px-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
        >
          {FAQS.map((faq) => (
            <AccordionItem key={faq.id} value={faq.id} className="last:border-b-0">
              <AccordionTrigger>{faq.question}</AccordionTrigger>
              <AccordionContent>{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="rounded-2xl border border-border/70 bg-accent/40 p-5 lg:col-start-1 lg:row-start-2 lg:self-start">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-primary shadow-sm">
            <Headphones className="h-5 w-5" aria-hidden />
          </span>
          <p className="mt-3 text-base font-semibold text-foreground">Still have questions?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {email || phone
              ? "We are happy to help."
              : "The sales representative who set up your shop can help, or you can find out how to get started."}
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
            {email ? (
              <Button asChild variant="outline">
                <a href={`mailto:${email}`}>
                  <Mail aria-hidden />
                  Email us
                </a>
              </Button>
            ) : null}
            {phone ? (
              <Button asChild variant="outline">
                <a href={`tel:${phone.replace(/\s+/g, "")}`}>
                  <Phone aria-hidden />
                  Call us
                </a>
              </Button>
            ) : null}
            {!email && !phone ? (
              <Button asChild variant="outline">
                <Link href={CTA.getStarted}>
                  <LogIn aria-hidden />
                  How to get started
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}
