import type { IsoDate } from "./types";
import { LedgerError } from "./num";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIso(d: IsoDate): { y: number; m: number; day: number } {
  const match = ISO.exec(d);
  if (!match) throw new LedgerError(`date must be YYYY-MM-DD (got "${d}")`);
  const [y, m, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, day));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) throw new LedgerError(`"${d}" is not a real date`);
  return { y, m, day };
}

/** Whole calendar months from `a` to `b` (0 if b is before a). Jan 31 -> Feb 28 counts as 0. */
export function fullMonthsBetween(a: IsoDate, b: IsoDate): number {
  const x = parseIso(a);
  const y = parseIso(b);
  let months = (y.y - x.y) * 12 + (y.m - x.m);
  if (y.day < x.day) months -= 1;
  return Math.max(0, months);
}

export function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}
