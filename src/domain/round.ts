import type { CapState, CapSummary } from "./capTable";
import { D, type Dec, LedgerError, ZERO } from "./num";

export interface RoundInput {
  /** Pre-money valuation, in dollars. */
  preMoney: Dec;
  /** New money invested in the round. */
  newMoney: Dec;
  /** Target unallocated pool as a fraction of post-money fully diluted (0 = no top-up). */
  targetPoolPct: Dec;
}

export interface SafeConversion {
  safeId: string;
  holder: string;
  amount: Dec;
  price: Dec;
  shares: Dec;
  method: "cap" | "discount";
}

export interface ProFormaRow {
  holder: string;
  before: Dec;
  after: Dec;
  pctAfter: Dec;
}

export interface RoundResult {
  pricePerShare: Dec;
  preMoneyFD: Dec;
  postMoneyFD: Dec;
  newInvestorShares: Dec;
  poolTopUp: Dec;
  poolAfter: Dec;
  conversions: SafeConversion[];
  rows: ProFormaRow[];
  iterations: number;
}

export const NEW_INVESTOR = "New investor (this round)";
export const POOL = "Unallocated option pool";

/**
 * Models a priced round with post-money SAFEs converting and an option pool
 * top-up counted in the pre-money (the usual "pool shuffle").
 *
 * The three quantities depend on each other: the price depends on the pre-money
 * share count, which includes the SAFE shares and pool top-up, which in turn
 * depend on the price. We solve by fixed-point iteration, which converges
 * because SAFE ownership plus the pool target is below 100%.
 *
 * - Capped SAFE (post-money): price = cap / company capitalization, where
 *   capitalization = existing fully diluted + all converting SAFE shares
 *   (the pool top-up for this round is excluded).
 * - Discount: price = round price x (1 - discount).
 * A SAFE with both converts at whichever price is lower (more shares).
 */
export function modelRound(summary: CapSummary, state: CapState, input: RoundInput): RoundResult {
  const { preMoney: V, newMoney: M, targetPoolPct: t } = input;
  if (V.lte(0) || M.lte(0)) throw new LedgerError("pre-money valuation and new money must be above zero");
  if (t.isNeg() || t.gte(0.5)) throw new LedgerError("target pool must be between 0% and 50%");

  const S0 = summary.fullyDiluted;
  const A = summary.poolAvailable;
  if (S0.lte(0)) throw new LedgerError("the company has no shares yet");

  const safeShares = (P: Dec, C: Dec) =>
    state.safes.map((sf) => {
      const capPrice = sf.postMoneyCap ? sf.postMoneyCap.div(C) : undefined;
      const discPrice = sf.discount ? P.times(new D(1).minus(sf.discount)) : undefined;
      const useCap = capPrice && (!discPrice || capPrice.lte(discPrice));
      const price = (useCap ? capPrice : discPrice)!;
      return { sf, price, method: (useCap ? "cap" : "discount") as "cap" | "discount", shares: sf.amount.div(price) };
    });

  let preFD = S0;
  let C = S0;
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    const P = V.div(preFD);
    // Which SAFEs use their cap depends on C; given that split, C has a closed
    // form: C = (S0 + discount-SAFE shares) / (1 - sum of capped amount/cap).
    const split = safeShares(P, C);
    let capShare = ZERO;
    let discShares = ZERO;
    for (const c of split) {
      if (c.method === "cap") capShare = capShare.plus(c.sf.amount.div(c.sf.postMoneyCap!));
      else discShares = discShares.plus(c.shares);
    }
    if (capShare.gte(1)) throw new LedgerError("SAFEs would own 100% or more of the company at their caps");
    const nextC = S0.plus(discShares).div(new D(1).minus(capShare));
    const conv = safeShares(P, nextC);
    const safeTotal = conv.reduce((acc, c) => acc.plus(c.shares), ZERO);
    const topUp = D.max(ZERO, t.times(preFD).times(V.plus(M)).div(V).minus(A));
    const next = S0.plus(safeTotal).plus(topUp);
    const done = next.minus(preFD).abs().lt(1e-9) && nextC.minus(C).abs().lt(1e-9);
    preFD = next;
    C = nextC;
    if (done) break;
  }
  if (iterations >= 200) throw new LedgerError("round did not converge; check SAFE caps against the valuation");

  // Final, whole-share numbers. Price is kept to 6 decimals, shares round down.
  const price = V.div(preFD).toDecimalPlaces(6, D.ROUND_DOWN);
  const conversions: SafeConversion[] = safeShares(V.div(preFD), C).map((c) => ({
    safeId: c.sf.safeId,
    holder: c.sf.holder,
    amount: c.sf.amount,
    price: c.price.toDecimalPlaces(6, D.ROUND_DOWN),
    // Trim iteration residue (e.g. 999999.9999999999) before rounding down.
    shares: c.shares.toDecimalPlaces(6).floor(),
    method: c.method,
  }));
  const safeTotal = conversions.reduce((acc, c) => acc.plus(c.shares), ZERO);
  const poolTopUp = D.max(ZERO, t.times(preFD).times(V.plus(M)).div(V).minus(A)).ceil();
  const newInvestorShares = M.div(price).floor();
  const preMoneyFD = S0.plus(safeTotal).plus(poolTopUp);
  const postMoneyFD = preMoneyFD.plus(newInvestorShares);
  const poolAfter = A.plus(poolTopUp);

  const after = new Map<string, { before: Dec; after: Dec }>();
  const bump = (h: string, before: Dec, add: Dec) => {
    const cur = after.get(h) ?? { before: ZERO, after: ZERO };
    after.set(h, { before: cur.before.plus(before), after: cur.after.plus(before).plus(add) });
  };
  for (const r of summary.rows) bump(r.holder, r.fullyDiluted, ZERO);
  for (const c of conversions) bump(c.holder, ZERO, c.shares);
  bump(POOL, A, poolTopUp);
  bump(NEW_INVESTOR, ZERO, newInvestorShares);

  const rows = [...after.entries()]
    .map(([holder, v]) => ({ holder, before: v.before, after: v.after, pctAfter: v.after.div(postMoneyFD) }))
    .sort((a, b) => b.after.cmp(a.after));

  return { pricePerShare: price, preMoneyFD, postMoneyFD, newInvestorShares, poolTopUp, poolAfter, conversions, rows, iterations };
}
