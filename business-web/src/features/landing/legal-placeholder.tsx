import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "./section-heading";
import { CTA, SITE } from "./site-config";

/**
 * A placeholder for a legal document that has not been written yet.
 *
 * It says so plainly. A generated "privacy policy" full of promises nobody has
 * reviewed would be worse than an honest notice - it would be a set of
 * commitments the business never actually made.
 */
export function LegalPlaceholder({ title }: { title: string }) {
  const { email } = SITE.contact;

  return (
    <section className="py-16 sm:py-24">
      <Container className="max-w-2xl text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileText className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          We are finalising our {title.toLowerCase()}. It will be published on this page.
          {email ? (
            <>
              {" "}
              For questions in the meantime, write to{" "}
              <a href={`mailto:${email}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {email}
              </a>
              .
            </>
          ) : null}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 min-[420px]:flex-row">
          <Button asChild variant="outline">
            <Link href="/">Back to home</Link>
          </Button>
          <Button asChild>
            <Link href={CTA.getStarted}>Get Started</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
