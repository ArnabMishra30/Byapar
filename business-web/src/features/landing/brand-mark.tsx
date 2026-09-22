import Link from "next/link";
import { Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE } from "./site-config";

/** The logo, name and tagline. Used in the header and the footer. */
export function BrandMark({
  className,
  showTagline = true,
  taglineClassName,
}: {
  className?: string;
  showTagline?: boolean;
  taglineClassName?: string;
}) {
  return (
    <Link
      href="/"
      aria-label={`${SITE.brand} home`}
      className={cn(
        // min-h-11: a 44px touch target. Measured in Chrome at 36px without it.
        "flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
        <Store className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-lg font-bold tracking-tight text-foreground">{SITE.brand}</span>
        {showTagline ? (
          // Hidden on the narrowest phones, where the header also needs room for
          // the menu button.
          <span
            className={cn(
              "hidden truncate text-[11px] text-muted-foreground min-[380px]:block",
              taglineClassName,
            )}
          >
            {SITE.tagline}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
