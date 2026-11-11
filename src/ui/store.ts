import { buildLedger } from "../domain/ledger";
import type { CompanyFile, LedgerEntry } from "../domain/types";
import demo from "../../data/demo-company.json";

/** Everything the app keeps: company metadata plus the hash-chained ledger. */
export interface Book {
  meta: Omit<CompanyFile, "events">;
  ledger: LedgerEntry[];
}

const KEY = "captable-lite:v1";

export function demoBook(): Book {
  const { events, ...meta } = demo as CompanyFile;
  return { meta, ledger: buildLedger(events) };
}

export function loadBook(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Book;
  } catch {
    /* private mode or corrupt data: fall back to the demo */
  }
  return demoBook();
}

export function saveBook(book: Book): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    /* storage unavailable: the session still works in memory */
  }
}

export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
