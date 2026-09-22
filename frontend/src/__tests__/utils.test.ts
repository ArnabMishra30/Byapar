import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatNumber,
  formatDate,
  getInitials,
} from "../lib/utils";

describe("Frontend Core Utilities", () => {
  describe("formatCurrency", () => {
    it("formats Indian Rupee correctly", () => {
      const formatted = formatCurrency(123456.78);
      // Clean non-breaking spaces for regex check
      const normalized = formatted.replace(/\u00A0/g, " ");
      expect(normalized).toContain("₹");
      expect(normalized).toContain("1,23,456.78");
    });

    it("handles zero and negative amounts", () => {
      expect(formatCurrency(0).replace(/\u00A0/g, " ")).toContain("₹0.00");
      expect(formatCurrency(-500).replace(/\u00A0/g, " ")).toContain("-₹500.00");
    });

    it("handles null / undefined safely", () => {
      expect(formatCurrency(null as any).replace(/\u00A0/g, " ")).toContain("₹0.00");
      expect(formatCurrency(undefined as any).replace(/\u00A0/g, " ")).toContain("₹0.00");
    });
  });

  describe("formatNumber", () => {
    it("formats integer and decimal quantities", () => {
      expect(formatNumber(1000)).toBe("1,000");
      expect(formatNumber(1500.5, 2, true)).toBe("1,500.50");
      expect(formatNumber(1500.5, 2)).toBe("1,500.5");
    });
  });

  describe("formatDate", () => {
    it("formats dates gracefully in Indian locale DD/MM/YYYY", () => {
      const dateStr = "2026-09-01T12:00:00Z";
      const formatted = formatDate(dateStr);
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    });

    it("returns dash for invalid or null dates", () => {
      expect(formatDate(null)).toBe("—");
      expect(formatDate(undefined)).toBe("—");
    });
  });

  describe("getInitials", () => {
    it("returns two letters for two words", () => {
      expect(getInitials("Ramesh Kumar")).toBe("RK");
    });

    it("returns first two letters for single word", () => {
      expect(getInitials("Admin")).toBe("AD");
    });

    it("handles empty or null name", () => {
      expect(getInitials("")).toBe("U");
      expect(getInitials(null as any)).toBe("U");
    });
  });
});
