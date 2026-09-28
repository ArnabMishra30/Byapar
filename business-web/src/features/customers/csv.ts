/**
 * A small, dependency-free CSV reader and writer for the customer import.
 *
 * WHY NOT split(","). A shop's address column is exactly where commas live
 * ("12, MG Road, Pune"), Excel quotes such cells and doubles any quote inside
 * them, and a file saved on Windows ends its lines with CRLF. A naive split
 * silently shifts every column after the first comma - the phone lands in the
 * email field and the row looks valid. This parser follows RFC 4180:
 *
 *   - fields may be wrapped in double quotes
 *   - inside quotes, commas and line breaks are data, and "" is one quote
 *   - lines end in CRLF, LF or a lone CR
 *   - a UTF-8 byte-order mark (Excel adds one) is dropped
 *   - completely blank lines are skipped
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A line with nothing on it at all is spacing, not a record.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      // A quote opens a quoted field only at the start of one; elsewhere it is
      // kept as a literal character, which is what spreadsheet apps do.
      if (field === "") inQuotes = true;
      else field += ch;
      i += 1;
    } else if (ch === ",") {
      endField();
      i += 1;
    } else if (ch === "\r") {
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
    } else if (ch === "\n") {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  // The last line usually has no line break after it.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Turns the parsed grid into one object per data row, keyed by the header.
 *
 * Headers are matched loosely ("Credit Limit", "credit_limit", "creditLimit"
 * all mean creditLimit) because a shop owner edits the sample in Excel and
 * nobody should fail an import over the spelling of a column name.
 */
export function rowsToRecords(
  grid: string[][],
  knownHeaders: readonly string[],
): { records: { line: number; values: Record<string, string> }[]; unknownHeaders: string[]; missingHeaders: string[] } {
  if (grid.length === 0) return { records: [], unknownHeaders: [], missingHeaders: [...knownHeaders] };

  const normalise = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const lookup = new Map(knownHeaders.map((key) => [normalise(key), key]));

  const header = grid[0].map((cell) => lookup.get(normalise(cell)) ?? null);
  const unknownHeaders = grid[0].filter((cell, index) => header[index] === null && cell.trim() !== "");
  const missingHeaders = knownHeaders.filter((key) => !header.includes(key));

  const records = grid.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    header.forEach((key, column) => {
      if (key) values[key] = (cells[column] ?? "").trim();
    });
    // Line numbers as the spreadsheet shows them: the header is line 1.
    return { line: index + 2, values };
  });

  return { records, unknownHeaders, missingHeaders };
}

/** One cell, quoted only when it has to be. */
function escapeCell(value: string): string {
  let cell = value;
  // A cell starting with = or @ is run as a formula when the file is opened in
  // a spreadsheet. A leading apostrophe makes it plain text. "+" and "-" are
  // left alone because phone numbers (+91...) legitimately start with them.
  if (/^[=@]/.test(cell)) cell = `'${cell}`;
  if (/[",\r\n]/.test(cell) || cell !== cell.trim()) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) => row.map((cell) => escapeCell(cell == null ? "" : String(cell))).join(","))
    .join("\r\n");
}

/** Hands the browser a file to save. No server round trip. */
export function downloadCsv(filename: string, csv: string) {
  // The BOM makes Excel read the file as UTF-8, so names like "Café" survive.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the download has started first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
