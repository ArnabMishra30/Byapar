"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An accessible accordion with the shadcn/ui API shape, and no new dependency.
 *
 * shadcn's own accordion wraps @radix-ui/react-accordion, which this project
 * does not install. Rather than add a package for one FAQ list, this follows the
 * WAI-ARIA accordion pattern directly:
 *
 *   - each header is a real <button> inside a heading, so Tab, Enter and Space
 *     work with no extra code
 *   - the button carries aria-expanded and aria-controls
 *   - the panel is a labelled region, and uses the `hidden` attribute when
 *     closed, so screen readers skip it and aria-controls never points at an
 *     element that does not exist
 */

interface AccordionContextValue {
  isOpen: (value: string) => boolean;
  toggle: (value: string) => void;
  baseId: string;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);
const ItemContext = React.createContext<string | null>(null);

function useAccordion() {
  const context = React.useContext(AccordionContext);
  if (!context) throw new Error("Accordion parts must be rendered inside <Accordion>.");
  return context;
}

function useItemValue() {
  const value = React.useContext(ItemContext);
  if (value === null) throw new Error("AccordionTrigger/Content must be inside <AccordionItem>.");
  return value;
}

function idsFor(baseId: string, value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-");
  return { trigger: `${baseId}-trigger-${safe}`, content: `${baseId}-content-${safe}` };
}

export function Accordion({
  type = "single",
  defaultValue,
  collapsible = true,
  className,
  children,
}: {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  /** For type="single": whether the open item can be closed again. */
  collapsible?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<string[]>(() =>
    defaultValue === undefined ? [] : Array.isArray(defaultValue) ? defaultValue : [defaultValue],
  );

  // useId returns ":r0:"; colons are legal in an id but awkward in selectors.
  const baseId = React.useId().replace(/:/g, "");

  const value = React.useMemo<AccordionContextValue>(
    () => ({
      isOpen: (item) => open.includes(item),
      toggle: (item) =>
        setOpen((current) => {
          const isOpen = current.includes(item);
          if (type === "multiple") {
            return isOpen ? current.filter((entry) => entry !== item) : [...current, item];
          }
          if (isOpen) return collapsible ? [] : current;
          return [item];
        }),
      baseId,
    }),
    [open, type, collapsible, baseId],
  );

  return (
    <AccordionContext.Provider value={value}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { isOpen } = useAccordion();
  return (
    <ItemContext.Provider value={value}>
      <div data-state={isOpen(value) ? "open" : "closed"} className={cn("border-b", className)}>
        {children}
      </div>
    </ItemContext.Provider>
  );
}

export function AccordionTrigger({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { isOpen, toggle, baseId } = useAccordion();
  const value = useItemValue();
  const open = isOpen(value);
  const { trigger, content } = idsFor(baseId, value);

  return (
    <h3 className="flex">
      <button
        type="button"
        id={trigger}
        aria-expanded={open}
        aria-controls={content}
        onClick={() => toggle(value)}
        className={cn(
          "flex w-full items-center justify-between gap-4 rounded-md py-4 text-left text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-base",
          className,
        )}
      >
        <span>{children}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180 text-primary",
          )}
        />
      </button>
    </h3>
  );
}

export function AccordionContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { isOpen, baseId } = useAccordion();
  const value = useItemValue();
  const { trigger, content } = idsFor(baseId, value);

  return (
    <div
      id={content}
      role="region"
      aria-labelledby={trigger}
      hidden={!isOpen(value)}
      className={cn("pb-4 pr-8 text-sm leading-relaxed text-muted-foreground", className)}
    >
      {children}
    </div>
  );
}
