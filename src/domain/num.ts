import Decimal from "decimal.js";

/** One Decimal flavour for the whole app: high precision, no float drift. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

export function dec(v: string | number | Dec): Dec {
  return new D(v);
}

/** Parses a user/JSON value that must be a whole, positive number of shares. */
export function wholeShares(v: string, label = "shares"): Dec {
  const d = parseDec(v, label);
  if (!d.isInteger() || d.lte(0)) throw new LedgerError(`${label} must be a whole number above zero (got "${v}")`);
  return d;
}

export function parseDec(v: string, label: string): Dec {
  try {
    const d = new D(v);
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw new LedgerError(`${label} is not a number (got "${v}")`);
  }
}

export function pct(part: Dec, whole: Dec, dp = 2): string {
  if (whole.isZero()) return "0.00%";
  return part.div(whole).times(100).toFixed(dp) + "%";
}

export function fmtShares(d: Dec): string {
  return Number(d.toFixed(0)).toLocaleString("en-US");
}

export function fmtMoney(d: Dec, dp = 2): string {
  return "$" + Number(d.toFixed(dp)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}
