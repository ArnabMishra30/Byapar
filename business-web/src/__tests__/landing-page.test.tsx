import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LandingPage } from "@/features/landing/landing-page";
import * as publicApi from "@/lib/api/public";
import { BILL_STEPS, FAQS, FEATURES, NAV_LINKS } from "@/features/landing/site-config";

// THE PUBLIC MARKETING PAGE.
//
// The property worth protecting is HONESTY. A landing page that oversells is a
// support ticket with a delay on it, so these tests assert what the page must
// NOT say as firmly as what it must.
//
// Pricing: the backend's plan records win when present; the configured
// 3 Months / 6 Months list stands in only when the backend has none.

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LandingPage />
    </QueryClientProvider>,
  );
}

const BACKEND_PLANS = [
  {
    id: "p1",
    name: "3 Months",
    description: null,
    price: "300.00",
    currency: "INR",
    durationValue: 3,
    durationUnit: "MONTH" as const,
    durationLabel: "3 months",
  },
  {
    id: "p2",
    name: "6 Months",
    description: null,
    price: "500.00",
    currency: "INR",
    durationValue: 6,
    durationUnit: "MONTH" as const,
    durationLabel: "6 months",
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(publicApi, "fetchPublicPlans").mockResolvedValue([]);
});

describe("the landing page", () => {
  it("renders the brand and both calls to action", () => {
    renderPage();

    expect(screen.getAllByText(/byapar/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /login/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /get started/i }).length).toBeGreaterThan(0);
  });

  it("has exactly one h1", () => {
    renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("sends every login link to the shop login", () => {
    renderPage();
    for (const link of screen.getAllByRole("link", { name: /login/i })) {
      expect(link.getAttribute("href")).toBe("/shop/login");
    }
  });

  it("sends every Get Started link to the get-started page", () => {
    renderPage();
    for (const link of screen.getAllByRole("link", { name: /get started/i })) {
      expect(link.getAttribute("href")).toMatch(/^\/register(\?|$)/);
    }
  });

  // An anchor that points at nothing is a dead link that looks alive.
  it("has a section for every navigation link", () => {
    const { container } = renderPage();
    for (const link of NAV_LINKS) {
      const id = link.href.split("#")[1];
      expect(container.querySelector(`#${id}`), `${link.href} must have a target`).not.toBeNull();
    }
  });

  it("lists every configured feature", () => {
    renderPage();
    for (const feature of FEATURES) {
      expect(screen.getByRole("heading", { name: feature.title })).toBeInTheDocument();
    }
  });

  it("shows the five-step bill flow in order", () => {
    const { container } = renderPage();
    const steps = container.querySelectorAll("#how-it-works ol > li");

    expect(steps).toHaveLength(BILL_STEPS.length);
    BILL_STEPS.forEach((step, index) => {
      expect(steps[index].textContent).toContain(step.title);
      expect(steps[index].textContent).toContain(String(index + 1));
    });
  });
});

describe("the page does not oversell", () => {
  it("never advertises a payment gateway or a mobile app", async () => {
    vi.mocked(publicApi.fetchPublicPlans).mockResolvedValue(BACKEND_PLANS);
    const { container } = renderPage();
    await screen.findByText("6 Months");

    const text = container.textContent ?? "";
    for (const forbidden of [
      /razorpay/i,
      /stripe/i,
      /paypal/i,
      /pay (now|online)/i,
      /download .*(app|android|ios)/i,
      /app store/i,
      /play store/i,
    ]) {
      expect(text, `must not claim ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("never claims the AI is instant, perfect or unsupervised", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";

    for (const forbidden of [
      /100\s*%/,
      /in seconds/i,
      /instantly/i,
      /fully automatic/i,
      /always accurate/i,
      /never (makes|make) mistakes/i,
    ]) {
      expect(text, `must not claim ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("says the owner reviews every bill before it is saved", () => {
    const { container } = renderPage();
    const section = container.querySelector("#how-it-works") as HTMLElement;

    expect(within(section).getByText(/nothing\s+reaches your books until you confirm it/i)).toBeInTheDocument();
    expect(section.textContent).toMatch(/review & edit/i);
  });

  it("keeps the review promise on the AI feature card", () => {
    renderPage();
    expect(
      screen.getByText(/it is read for you, you check it, and only then is it recorded/i),
    ).toBeInTheDocument();
  });

  it("says plainly there is no online payment", () => {
    renderPage();
    expect(screen.getByText(/no online payment in the application/i)).toBeInTheDocument();
  });

  it("marks the dashboard preview as sample data and hides it from screen readers", () => {
    const { container } = renderPage();

    expect(screen.getByText(/sample figures shown for illustration/i)).toBeInTheDocument();
    // The rupee amounts in the drawing belong to nobody; a screen reader should
    // hear the caption, not the numbers.
    const drawings = container.querySelectorAll('figure [aria-hidden="true"], figure [aria-hidden]');
    expect(drawings.length).toBeGreaterThan(0);
    expect(within(container.querySelector("figure") as HTMLElement).getByText(/illustration of the dashboard/i)).toBeInTheDocument();
  });
});

describe("pricing", () => {
  it("shows the plans the backend returns", async () => {
    vi.mocked(publicApi.fetchPublicPlans).mockResolvedValue(BACKEND_PLANS);
    renderPage();

    expect(await screen.findByText("3 Months")).toBeInTheDocument();
    expect(screen.getByText("6 Months")).toBeInTheDocument();
    expect(screen.getByText("₹300")).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });

  it("lets a backend price list replace the configured one entirely", async () => {
    // Proves the configured list is a fallback, not a hardcoded override.
    vi.mocked(publicApi.fetchPublicPlans).mockResolvedValue([
      { ...BACKEND_PLANS[0], id: "x", name: "Annual", price: "1999.00", durationValue: 12, durationLabel: "1 year" },
    ]);
    renderPage();

    expect(await screen.findByText("Annual")).toBeInTheDocument();
    expect(screen.getByText("₹1,999")).toBeInTheDocument();
    expect(screen.queryByText("3 Months")).not.toBeInTheDocument();
  });

  it("falls back to the configured 3 and 6 month plans when the backend has none", async () => {
    renderPage();

    expect(await screen.findByText("3 Months")).toBeInTheDocument();
    expect(screen.getByText("6 Months")).toBeInTheDocument();
    expect(screen.getByText("₹300")).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });

  // "Best value" is computed, not asserted: the lowest monthly rate.
  it("badges the plan with the lowest monthly price, and only that one", async () => {
    renderPage();

    const sixMonths = (await screen.findByText("6 Months")).closest("article") as HTMLElement;
    const threeMonths = screen.getByText("3 Months").closest("article") as HTMLElement;

    expect(within(sixMonths).getByText(/best value/i)).toBeInTheDocument();
    expect(within(threeMonths).queryByText(/best value/i)).toBeNull();
    expect(within(sixMonths).getByText("About ₹83 a month")).toBeInTheDocument();
  });

  it("never calls a plan popular, which is a claim with no data behind it", async () => {
    renderPage();
    await screen.findByText("6 Months");
    expect(screen.queryByText(/most popular|popular/i)).toBeNull();
  });

  it("carries the chosen plan into the get-started link", async () => {
    renderPage();
    const card = (await screen.findByText("6 Months")).closest("article") as HTMLElement;

    expect(within(card).getByRole("link", { name: /get started/i }).getAttribute("href")).toBe(
      "/register?plan=6-months",
    );
  });

  it("notes that plans may change", async () => {
    renderPage();
    expect(screen.getByText(/plans and features may change as the product evolves/i)).toBeInTheDocument();
  });
});

describe("the FAQ accordion", () => {
  it("includes every configured question", () => {
    renderPage();
    for (const faq of FAQS) {
      expect(screen.getByRole("button", { name: faq.question })).toBeInTheDocument();
    }
  });

  it("answers what the brief asked, including editing before saving", () => {
    renderPage();
    for (const question of [
      /who is this platform for/i,
      /upload bills instead of entering everything manually/i,
      /track customer credit and supplier dues/i,
      /how do subscriptions work/i,
      /use it on my phone/i,
      /edit extracted bill information before saving/i,
      /do i need a gst registration/i,
      /what happens when my subscription ends/i,
      /is my data separate from other shops/i,
    ]) {
      expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
    }
  });

  it("opens the first answer by default and keeps the rest closed", () => {
    renderPage();
    expect(screen.getByRole("button", { name: FAQS[0].question }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /do i need a gst registration/i }).getAttribute("aria-expanded")).toBe("false");
  });

  it("expands an answer, and wires the button to its region", () => {
    renderPage();
    const question = screen.getByRole("button", { name: /do i need a gst registration/i });

    fireEvent.click(question);

    expect(question.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(question.getAttribute("aria-controls") as string);
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.getAttribute("aria-labelledby")).toBe(question.id);
    expect(region?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText(/gst is entirely optional/i)).toBeInTheDocument();
  });

  it("closes the previously open answer when another opens", () => {
    renderPage();
    const first = screen.getByRole("button", { name: FAQS[0].question });
    const gst = screen.getByRole("button", { name: /do i need a gst registration/i });

    fireEvent.click(gst);

    expect(first.getAttribute("aria-expanded")).toBe("false");
    const firstRegion = document.getElementById(first.getAttribute("aria-controls") as string);
    expect(firstRegion?.hasAttribute("hidden")).toBe(true);
  });

  it("collapses an open answer when clicked again", () => {
    renderPage();
    const first = screen.getByRole("button", { name: FAQS[0].question });
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the mobile menu", () => {
  it("is a 44px touch target shown only below md", () => {
    renderPage();
    const toggle = screen.getByRole("button", { name: /open menu/i });

    expect(toggle.className).toContain("h-11");
    expect(toggle.className).toContain("w-11");
    expect(toggle.className).toContain("md:hidden");
  });

  it("opens and closes, and hides its panel when closed", () => {
    renderPage();
    const panel = document.getElementById("landing-mobile-menu") as HTMLElement;
    const toggle = screen.getByRole("button", { name: /open menu/i });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hasAttribute("hidden")).toBe(true);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /close menu/i }).getAttribute("aria-expanded")).toBe("true");
    expect(panel.hasAttribute("hidden")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /close menu/i }));
    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
    expect(panel.hasAttribute("hidden")).toBe(true);
  });

  it("closes on Escape", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: /open menu/i }).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when a link in it is followed", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

    const panel = document.getElementById("landing-mobile-menu") as HTMLElement;
    fireEvent.click(within(panel).getByRole("link", { name: "Pricing" }));

    expect(panel.hasAttribute("hidden")).toBe(true);
  });
});
