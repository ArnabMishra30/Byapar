import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegisterScreen } from "@/features/landing/register-screen";
import * as publicApi from "@/lib/api/public";

// THE GET-STARTED PAGE.
//
// There is no self-service sign-up: the sales team registers a shop. So the
// most important property of this page is what it does NOT contain - a form
// that collects details and sends them nowhere.

const navigation = vi.hoisted(() => ({ search: "plan=6-months" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RegisterScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(publicApi, "fetchPublicPlans").mockResolvedValue([]);
  navigation.search = "plan=6-months";
});

describe("the get-started page", () => {
  it("explains that accounts are set up by the team", () => {
    renderScreen();
    expect(screen.getByText(/accounts are set up by our team/i)).toBeInTheDocument();
  });

  it("confirms the plan chosen on the pricing section", async () => {
    renderScreen();
    expect(await screen.findByText("6 Months")).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });

  it("says nothing about a plan it does not recognise", () => {
    navigation.search = "plan=platinum-forever";
    renderScreen();
    expect(screen.queryByText(/you picked the/i)).toBeNull();
  });

  // THE HONESTY ASSERTION.
  it("contains no form that would submit nowhere", () => {
    const { container } = renderScreen();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input, textarea, select")).toBeNull();
  });

  it("points existing customers at the shop login", () => {
    renderScreen();
    expect(screen.getByRole("link", { name: /log in to your shop/i }).getAttribute("href")).toBe(
      "/shop/login",
    );
  });

  it("does not render contact links when none are configured", () => {
    const { container } = renderScreen();
    expect(container.querySelector('a[href^="mailto:"], a[href^="tel:"]')).toBeNull();
    expect(screen.getByText(/sales representative/i)).toBeInTheDocument();
  });
});
