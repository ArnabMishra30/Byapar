import * as React from "react";
import { cn } from "@/lib/utils";

/** The small pill above a section title. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Eyebrow, title and lead paragraph, in one consistent shape.
 *
 * Every section uses this, so heading sizes and spacing cannot drift from one
 * part of the page to the next.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  id,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  /** Set when a section's aria-labelledby should point at this title. */
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        id={id}
        className="mt-4 text-[1.75rem] font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">{description}</p>
      ) : null}
    </div>
  );
}

/** The page's single content width, so every section lines up. */
export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}
