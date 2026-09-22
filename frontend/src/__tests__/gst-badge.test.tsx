import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GstBadge } from "../components/shared/gst-badge";

describe("GstBadge Component", () => {
  it("renders Non-GST (Local Shop) badge by default or when unregistered", () => {
    render(<GstBadge isGstEnabled={false} registrationType="UNREGISTERED" />);
    expect(screen.getByText("Non-GST (Local Shop)")).toBeInTheDocument();
  });

  it("renders GST Registered badge when enabled", () => {
    render(<GstBadge isGstEnabled={true} registrationType="REGULAR" />);
    expect(screen.getByText("GST Registered")).toBeInTheDocument();
  });
});
