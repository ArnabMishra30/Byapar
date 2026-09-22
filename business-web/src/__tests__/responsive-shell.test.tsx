import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { PageHeader, FilterBar } from "@/components/shared/page-header";
import { DateRangeFilter } from "@/components/shared/date-range";
import { StatCard } from "@/components/shared/stat-card";
import { Wallet } from "lucide-react";

// THE RESPONSIVE CONTRACTS.
//
// These are the rules the polish pass established. They are easy to undo by
// accident - one `w-[200px]` added to a filter, one `grid-cols-1` left on a stat
// row - and the damage only shows on a phone, which is exactly where nobody
// looks during development.
//
// So the rules are asserted, not just applied.

const SRC = path.resolve(__dirname, "..");

/** Every .tsx under a directory, recursively. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the page header stays compact on a phone", () => {
  it("keeps the title and the primary action on one row", () => {
    const { container } = render(
      <PageHeader title="Expenses" description="Something" actions={<button>Add</button>} />,
    );

    // Title and action share a flex row at every width - the action is what the
    // user came to press, and stacking it under a paragraph buries it.
    const row = container.querySelector(".flex.items-start.justify-between");
    expect(row).not.toBeNull();
    expect(row?.querySelector("h1")).not.toBeNull();
    expect(row?.querySelector("button")).not.toBeNull();
  });

  it("scales the title down below sm", () => {
    render(<PageHeader title="Expenses" />);
    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading.className).toContain("text-lg");
    expect(heading.className).toContain("sm:text-2xl");
  });

  it("truncates a long title instead of pushing the action off screen", () => {
    render(<PageHeader title={"A very long business name ".repeat(6)} />);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("truncate");
  });

  it("renders a filter bar that wraps", () => {
    const { container } = render(<FilterBar>{<span>filter</span>}</FilterBar>);
    expect(container.firstElementChild?.className).toContain("flex-wrap");
  });
});

describe("the date range fits a 320px screen", () => {
  it("puts the two dates in a two-column grid, not fixed widths", () => {
    const { container } = render(<DateRangeFilter value={{}} onChange={() => {}} />);

    const grid = container.querySelector(".grid.grid-cols-2");
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll('input[type="date"]').length).toBe(2);
  });

  it("never gives a date input a fixed pixel width", () => {
    const { container } = render(<DateRangeFilter value={{}} onChange={() => {}} />);

    for (const input of Array.from(container.querySelectorAll("input"))) {
      expect(input.className).not.toMatch(/w-\[\d+(px|rem)\]/);
    }
  });

  it("keeps the presets on one scrollable row", () => {
    const { container } = render(<DateRangeFilter value={{}} onChange={() => {}} />);

    const chips = container.querySelector(".overflow-x-auto");
    expect(chips).not.toBeNull();
    // Five shortcuts, one row, no wrapping into a second.
    expect(chips?.querySelectorAll("button").length).toBe(5);
    expect(chips?.className).not.toContain("flex-wrap");
  });

  it("marks the active preset, so the current filter is never a guess", () => {
    const today = new Date().toISOString().slice(0, 10);
    render(<DateRangeFilter value={{ fromDate: today, toDate: today }} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("labels both inputs for screen readers", () => {
    render(<DateRangeFilter value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText("From date")).toBeInTheDocument();
    expect(screen.getByLabelText("To date")).toBeInTheDocument();
  });
});

describe("stat cards survive two-per-row at 320px", () => {
  it("uses a smaller icon and tighter padding below sm", () => {
    const { container } = render(
      <StatCard label="Sales today" value="₹1,23,456.00" icon={Wallet} />,
    );

    const icon = container.querySelector("span.rounded-lg");
    expect(icon?.className).toContain("h-8");
    expect(icon?.className).toContain("sm:h-10");
  });

  it("truncates a large amount rather than overflowing the card", () => {
    render(<StatCard label="Cash" value="₹12,34,56,789.00" icon={Wallet} />);
    expect(screen.getByText("₹12,34,56,789.00").className).toContain("truncate");
  });
});

describe("no page reintroduces a mobile overflow", () => {
  const pages = filesUnder(path.join(SRC, "features")).concat(
    filesUnder(path.join(SRC, "app")),
  );

  it("finds pages to check", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  // A width of 280px or more cannot fit inside a 320px screen once page padding
  // is taken off. A max-width can - it only ever caps, never forces.
  it("has no fixed width wide enough to overflow a 320px screen", () => {
    const offenders: string[] = [];

    for (const file of pages) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?<!max-)\bw-\[(\d+)px\]/g)) {
        if (Number(match[1]) >= 280) {
          offenders.push(`${path.relative(SRC, file)}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives every fixed-width control a mobile fallback", () => {
    const offenders: string[] = [];

    for (const file of pages) {
      const source = fs.readFileSync(file, "utf8");
      // A className that pins a width without an sm: escape hatch, on an input
      // or a select trigger, is the pattern that stacked the old filter rows.
      for (const match of source.matchAll(
        /className="([^"]*\bw-\[\d+(?:px|rem)\][^"]*)"/g,
      )) {
        const cls = match[1];
        if (/\bmax-w-\[/.test(cls)) continue; // caps are fine
        if (/w-full|sm:w-\[/.test(cls)) continue; // already has a fallback
        offenders.push(`${path.relative(SRC, file)}: ${cls}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
