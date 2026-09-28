import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native <select>, styled like <Input>.
 *
 * Native on purpose: on a phone it opens the OS picker, which is bigger, faster
 * and more familiar to a shopkeeper than any custom dropdown. One definition so
 * every filter and form looks the same.
 */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      // text-base below sm stops iOS Safari zooming the page on focus.
      // min-w-0: a select's natural width is its longest option; inside a grid
      // or flex row that would push the row past a 320px screen.
      "flex h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
