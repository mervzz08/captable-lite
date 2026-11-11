import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { CapEvent, LedgerEntry } from "./types";

export const GENESIS = "0".repeat(64);

/** JSON with sorted keys, so the same event always hashes the same way. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashEntry(seq: number, prevHash: string, event: CapEvent): string {
  return bytesToHex(sha256(utf8ToBytes(`${seq}|${prevHash}|${canonical(event)}`)));
}

/** Appends an event. Returns a new array; the input ledger is never mutated. */
export function append(ledger: readonly LedgerEntry[], event: CapEvent): LedgerEntry[] {
  const seq = ledger.length;
  const prevHash = seq === 0 ? GENESIS : ledger[seq - 1].hash;
  return [...ledger, { seq, event, prevHash, hash: hashEntry(seq, prevHash, event) }];
}

export function buildLedger(events: readonly CapEvent[]): LedgerEntry[] {
  return events.reduce<LedgerEntry[]>((acc, e) => append(acc, e), []);
}

/** Recomputes every hash. Returns the first broken sequence number, or null when intact. */
export function verifyLedger(ledger: readonly LedgerEntry[]): { ok: true } | { ok: false; seq: number } {
  let prev = GENESIS;
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.seq !== i || e.prevHash !== prev || e.hash !== hashEntry(i, prev, e.event)) return { ok: false, seq: i };
    prev = e.hash;
  }
  return { ok: true };
}
