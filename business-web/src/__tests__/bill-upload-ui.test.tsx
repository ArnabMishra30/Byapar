import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UploadBillDialog } from "@/features/bills/bill-list";

// THE UPLOAD DIALOG, after the wording and camera changes.
//
// Two things worth locking down:
//
//   1. The direction reads IN / OUT. "I received it" and "I issued it" are two
//      first-person sentences that differ by one verb - read at counter speed,
//      they get picked wrongly.
//
//   2. Taking a photo is a first-class action, with the REAR camera. A file
//      picker on a phone means digging through a gallery for a photo the person
//      has not taken yet.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function renderDialog(props: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UploadBillDialog open onOpenChange={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the direction is IN or OUT", () => {
  it("labels the two choices IN and OUT", () => {
    renderDialog();

    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("OUT")).toBeInTheDocument();
  });

  it("says what each one becomes", () => {
    renderDialog();

    expect(screen.getByText("Purchase")).toBeInTheDocument();
    expect(screen.getByText("Sale")).toBeInTheDocument();
  });

  // THE WORDING THAT CAUSED THE CONFUSION.
  it("no longer uses the first-person sentences", () => {
    renderDialog();
    const text = document.body.textContent ?? "";

    expect(text).not.toMatch(/I received it/i);
    expect(text).not.toMatch(/I issued it/i);
  });

  it("defaults to IN and switches to OUT when pressed", () => {
    renderDialog();

    const inButton = screen.getByText("IN").closest("button")!;
    const outButton = screen.getByText("OUT").closest("button")!;

    expect(inButton.getAttribute("aria-pressed")).toBe("true");
    expect(outButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(outButton);

    expect(screen.getByText("OUT").closest("button")!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("IN").closest("button")!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("taking a photo", () => {
  it("offers the camera as the primary action", () => {
    renderDialog();

    const camera = screen.getByRole("button", { name: /take a photo/i });
    expect(camera).toBeInTheDocument();
    // A 56px target, filled, not a secondary link.
    expect(camera.className).toContain("h-14");
    expect(camera.className).toContain("bg-primary");
  });

  it("still allows choosing an existing file", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /choose a file instead/i })).toBeInTheDocument();
  });

  // THE ATTRIBUTE THAT MAKES A PHONE OPEN THE CAMERA.
  it("asks for the rear camera", () => {
    renderDialog();

    const capture = document.querySelector('input[type="file"][capture]');
    expect(capture).not.toBeNull();
    expect(capture?.getAttribute("capture")).toBe("environment");
    expect(capture?.getAttribute("accept")).toContain("image/");
  });

  it("keeps a separate input for files, so PDFs are still accepted", () => {
    renderDialog();

    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    expect(inputs.length).toBe(2);

    const filePicker = inputs.find((input) => !input.hasAttribute("capture"));
    expect(filePicker?.getAttribute("accept")).toContain("application/pdf");
  });

  it("states the accepted formats and the size limit", () => {
    renderDialog();
    expect(screen.getByText(/JPG, PNG, WEBP, HEIC or PDF · up to 10 MB/i)).toBeInTheDocument();
  });
});

describe("what the dialog promises", () => {
  it("says the bill is checked before anything is recorded", () => {
    renderDialog();
    const text = document.body.textContent ?? "";

    expect(text).toMatch(/you check it before anything is recorded/i);
  });

  it("never claims the bill is recorded automatically", () => {
    renderDialog();
    const text = document.body.textContent ?? "";

    expect(text).not.toMatch(/automatically record/i);
    expect(text).not.toMatch(/saved automatically/i);
  });
});
