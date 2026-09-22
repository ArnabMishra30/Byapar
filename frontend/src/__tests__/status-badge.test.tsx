import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../components/shared/status-badge";

describe("StatusBadge Component", () => {
  it("renders Active status properly", () => {
    render(<StatusBadge status="ACTIVE" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders Inactive status properly", () => {
    render(<StatusBadge status="INACTIVE" />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("renders Draft status properly", () => {
    render(<StatusBadge status="DRAFT" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders Posted status properly", () => {
    render(<StatusBadge status="POSTED" />);
    expect(screen.getByText("Posted")).toBeInTheDocument();
  });

  it("renders Cancelled status properly", () => {
    render(<StatusBadge status="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("renders Partially Paid status properly", () => {
    render(<StatusBadge status="PARTIALLY_PAID" />);
    expect(screen.getByText("Partially Paid")).toBeInTheDocument();
  });

  it("renders boolean true/false as Active/Inactive", () => {
    const { rerender } = render(<StatusBadge status={true} />);
    expect(screen.getByText("Active")).toBeInTheDocument();

    rerender(<StatusBadge status={false} />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("renders null gracefully", () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
