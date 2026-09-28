import { describe, expect, it } from "vitest";
import { parseCsv, rowsToRecords, toCsv } from "@/features/customers/csv";
import {
  IMPORT_COLUMNS,
  SAMPLE_CSV_ROWS,
  partySchema,
  toPartyPayload,
  validateImportRows,
  EMPTY_PARTY,
} from "@/features/customers/party-rules";
import { leftToAssign, isMore } from "@/features/money/form-helper";
import { daysOverdue } from "@/features/parties/party-tabs";

describe("CSV parser", () => {
  it("splits plain fields", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas, quotes and line breaks inside quoted fields", () => {
    const text = 'name,address\n"Ramesh ""RT"" Traders","12, MG Road\nPune"\n';
    expect(parseCsv(text)).toEqual([
      ["name", "address"],
      ['Ramesh "RT" Traders', "12, MG Road\nPune"],
    ]);
  });

  it("handles CRLF, lone CR, a BOM and blank lines", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n3,4\r5,6")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1,,")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["name", "address"],
      ['Say "hi"', "1, Road"],
      ["Line\nbreak", ""],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("neutralises spreadsheet formulas but not phone numbers", () => {
    expect(toCsv([["=SUM(A1)", "+91 98765"]])).toBe("'=SUM(A1),+91 98765");
  });

  it("parses the sample it offers for download", () => {
    const { records, missingHeaders } = rowsToRecords(parseCsv(toCsv(SAMPLE_CSV_ROWS)), IMPORT_COLUMNS);
    expect(missingHeaders).toEqual([]);
    expect(records).toHaveLength(2);
    expect(validateImportRows(records).every((row) => row.errors.length === 0)).toBe(true);
  });
});

describe("header matching", () => {
  it("matches headers loosely and reports unknown and missing ones", () => {
    const grid = parseCsv("Name,Credit Limit,credit_days,Notes\nA1 Store,100,30,x");
    const { records, unknownHeaders, missingHeaders } = rowsToRecords(grid, IMPORT_COLUMNS);
    expect(records[0]).toEqual({ line: 2, values: { name: "A1 Store", creditLimit: "100", creditDays: "30" } });
    expect(unknownHeaders).toEqual(["Notes"]);
    expect(missingHeaders).toContain("phone");
  });
});

describe("import validation mirrors the backend", () => {
  const run = (values: Record<string, string>[]) =>
    validateImportRows(values.map((v, i) => ({ line: i + 2, values: v })));

  it("requires a name of at least 2 characters", () => {
    expect(run([{ name: "" }])[0].errors[0]).toMatch(/at least 2/);
    expect(run([{ name: "A" }])[0].errors[0]).toMatch(/at least 2/);
    expect(run([{ name: "AB" }])[0].errors).toEqual([]);
  });

  it("checks email, phone, GSTIN, state code and numbers", () => {
    const [row] = run([
      {
        name: "Bad Row",
        email: "not-an-email",
        phone: "12",
        gstin: "27ABCDE1234F1Z",
        stateCode: "ABC",
        creditLimit: "-5",
        creditDays: "3651",
        openingBalance: "1.23456",
      },
    ]);
    expect(row.errors).toEqual(
      expect.arrayContaining([
        "Invalid email address",
        "Invalid phone number",
        "Invalid GSTIN format",
        "State code is exactly two digits",
        expect.stringMatching(/Credit limit/),
        expect.stringMatching(/Credit days/),
        expect.stringMatching(/Opening balance/),
      ]),
    );
  });

  it("accepts a valid GSTIN in lower case and pads a one-digit state", () => {
    const [row] = run([{ name: "Good Row", gstin: "27abcde1234f1z5", stateCode: "7" }]);
    expect(row.errors).toEqual([]);
    expect(row.values.gstin).toBe("27ABCDE1234F1Z5");
    expect(row.values.stateCode).toBe("07");
  });

  it("flags duplicate names and phones within the file", () => {
    const rows = run([
      { name: "Sita Store", phone: "98765 43210" },
      { name: "sita store", phone: "9876543210" },
    ]);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toEqual(["Same name as line 2", "Same phone as line 2"]);
  });
});

describe("party payload", () => {
  const values = { ...EMPTY_PARTY, name: " Asha ", gstin: "27abcde1234f1z5", creditDays: "15" };

  it("omits blanks on create and never sends GST fields for a non-GST shop", () => {
    expect(partySchema.safeParse(values).success).toBe(true);
    expect(toPartyPayload(values, { mode: "create", includeGst: false })).toEqual({ name: "Asha", creditDays: 15 });
  });

  it("clears blanks on update so an erased phone is really erased", () => {
    const body = toPartyPayload(values, { mode: "update", includeGst: true });
    expect(body).toMatchObject({ phone: null, email: null, creditLimit: "0", gstin: "27ABCDE1234F1Z5" });
  });
});

describe("payment form helper", () => {
  it("does exact decimal subtraction", () => {
    expect(leftToAssign("0.3", ["0.1", "0.2"])).toBe("0.00");
    expect(leftToAssign("1000", ["250.50", "100"])).toBe("649.50");
    expect(leftToAssign("100", ["150"])).toBe("-50.00");
    expect(isMore("100.01", "100")).toBe(true);
  });
});

describe("days overdue", () => {
  const today = new Date("2026-09-28T10:00:00Z");
  it("counts whole days past the due date", () => {
    expect(daysOverdue("2026-09-20", today)).toBe(8);
    expect(daysOverdue("2026-09-28", today)).toBeNull();
    expect(daysOverdue("2026-10-05", today)).toBeNull();
    expect(daysOverdue(null, today)).toBeNull();
  });
});
