/**
 * Spreadsheet export.
 *
 * A CSV, not an .xlsx: every spreadsheet opens one, nothing has to be
 * bundled to write one, and the file is readable in a text editor when
 * somebody wants to check what left the building. Three details make
 * it open cleanly rather than "mostly":
 *
 *  - A UTF-8 byte-order mark at the top. Without it Excel on Windows
 *    reads the file as the local code page and a landlord called
 *    "Peña" arrives as "PeÃ±a".
 *  - RFC 4180 quoting. Any field holding a comma, a quote, or a line
 *    break is wrapped in quotes with inner quotes doubled — notes fields
 *    hold all three.
 *  - Formula neutralisation. A cell beginning with = + - @ or a tab is
 *    executed by Excel and Sheets as a formula when the file is opened.
 *    A note that starts with "=HYPERLINK(...)" typed by anyone whose
 *    text ends up in a row is an attack on whoever opens the export, so
 *    such cells are prefixed with an apostrophe, which spreadsheets
 *    treat as "this is text".
 *
 * Columns are declared, not inferred from object keys, so what leaves is
 * exactly what is written down here and a new field on a type does not
 * silently ride along.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** One cell, quoted when it has to be and never executable. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  let s = v;
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole file: header row, then one line per row, CRLF-terminated. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(","));
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

/** A file name that is safe on every desktop: letters, digits, dashes. */
export function csvFileName(stem: string, date = new Date()): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "export";
  return `${slug}-${date.toISOString().slice(0, 10)}.csv`;
}

/**
 * Hand the file to the browser. Client only — a Blob URL on an anchor,
 * clicked and revoked. Nothing is uploaded anywhere; the rows go from
 * this tab's memory to this person's disk.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Let the click land before the URL is pulled out from under it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
