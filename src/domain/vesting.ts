import { fullMonthsBetween } from "./dates";
import { type Dec, ZERO } from "./num";
import type { IsoDate, VestingTerms } from "./types";

/**
 * Monthly vesting with a cliff: nothing vests before the cliff, then the
 * cliff's months vest at once, then one more month's worth each month.
 * Fractions are rounded down so the total never exceeds the grant.
 */
export function vestedShares(total: Dec, terms: VestingTerms, asOf: IsoDate): Dec {
  const elapsed = fullMonthsBetween(terms.start, asOf);
  if (asOf < terms.start || elapsed < terms.cliffMonths) return ZERO;
  if (elapsed >= terms.months) return total;
  return total.times(elapsed).div(terms.months).floor();
}
