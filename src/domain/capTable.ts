import { parseIso } from "./dates";
import { D, type Dec, LedgerError, parseDec, wholeShares, ZERO } from "./num";
import type { CapEvent, CompanyFile, IsoDate, VestingTerms } from "./types";
import { vestedShares } from "./vesting";

export interface GrantState {
  grantId: string;
  holder: string;
  shares: Dec;
  strike: Dec;
  vesting: VestingTerms;
  exercised: Dec;
  forfeited: Dec;
  terminatedOn?: IsoDate;
}

export interface SafeState {
  safeId: string;
  holder: string;
  amount: Dec;
  postMoneyCap?: Dec;
  discount?: Dec;
}

export interface CapState {
  /** holder -> classId -> shares */
  positions: Map<string, Map<string, Dec>>;
  poolAuthorized: Dec;
  grants: Map<string, GrantState>;
  safes: SafeState[];
  lastDate?: IsoDate;
}

export interface Context {
  holders: Set<string>;
  classes: Set<string>;
  commonClassId: string;
}

export function contextOf(file: CompanyFile): Context {
  return {
    holders: new Set(file.stakeholders.map((s) => s.id)),
    classes: new Set(file.classes.map((c) => c.id)),
    commonClassId: file.company.commonClassId,
  };
}

export function emptyState(): CapState {
  return { positions: new Map(), poolAuthorized: ZERO, grants: new Map(), safes: [] };
}

export function holding(s: CapState, holder: string, classId: string): Dec {
  return s.positions.get(holder)?.get(classId) ?? ZERO;
}

function add(s: CapState, holder: string, classId: string, delta: Dec) {
  const byClass = s.positions.get(holder) ?? new Map<string, Dec>();
  byClass.set(classId, (byClass.get(classId) ?? ZERO).plus(delta));
  s.positions.set(holder, byClass);
}

/** Options still outstanding on a grant: granted minus exercised minus forfeited. */
export function outstandingOptions(g: GrantState): Dec {
  return g.shares.minus(g.exercised).minus(g.forfeited);
}

export function poolAvailable(s: CapState): Dec {
  let used = ZERO;
  for (const g of s.grants.values()) used = used.plus(g.shares).minus(g.forfeited);
  return s.poolAuthorized.minus(used);
}

/**
 * Applies one event to a state, validating it first. Throws LedgerError with a
 * plain-English reason when the event is not allowed (so the UI can show it).
 * The state passed in is mutated; callers clone via `replay`.
 */
export function apply(s: CapState, e: CapEvent, ctx: Context): void {
  parseIso(e.date);
  if (s.lastDate && e.date < s.lastDate) throw new LedgerError(`events must be in date order (${e.date} is before ${s.lastDate})`);
  const needHolder = (h: string) => {
    if (!ctx.holders.has(h)) throw new LedgerError(`unknown stakeholder "${h}"`);
  };
  const needClass = (c: string) => {
    if (!ctx.classes.has(c)) throw new LedgerError(`unknown share class "${c}"`);
  };

  switch (e.type) {
    case "issue": {
      needHolder(e.holder);
      needClass(e.classId);
      const price = parseDec(e.pricePerShare, "price per share");
      if (price.isNeg()) throw new LedgerError("price per share cannot be negative");
      add(s, e.holder, e.classId, wholeShares(e.shares));
      break;
    }
    case "transfer": {
      needHolder(e.from);
      needHolder(e.to);
      needClass(e.classId);
      if (e.from === e.to) throw new LedgerError("cannot transfer shares to the same stakeholder");
      const n = wholeShares(e.shares);
      const held = holding(s, e.from, e.classId);
      if (n.gt(held)) throw new LedgerError(`${e.from} holds ${held} ${e.classId} shares, cannot transfer ${n}`);
      add(s, e.from, e.classId, n.neg());
      add(s, e.to, e.classId, n);
      break;
    }
    case "cancel": {
      needHolder(e.holder);
      needClass(e.classId);
      const n = wholeShares(e.shares);
      const held = holding(s, e.holder, e.classId);
      if (n.gt(held)) throw new LedgerError(`${e.holder} holds ${held} ${e.classId} shares, cannot cancel ${n}`);
      if (!e.reason.trim()) throw new LedgerError("a cancellation needs a reason");
      add(s, e.holder, e.classId, n.neg());
      break;
    }
    case "poolIncrease":
      s.poolAuthorized = s.poolAuthorized.plus(wholeShares(e.shares));
      break;
    case "grant": {
      needHolder(e.holder);
      if (s.grants.has(e.grantId)) throw new LedgerError(`grant id "${e.grantId}" already exists`);
      const n = wholeShares(e.shares);
      const avail = poolAvailable(s);
      if (n.gt(avail)) throw new LedgerError(`option pool has ${avail} shares available, cannot grant ${n}`);
      const v = e.vesting;
      parseIso(v.start);
      if (!(v.months > 0) || v.cliffMonths < 0 || v.cliffMonths > v.months) throw new LedgerError("vesting needs months > 0 and 0 <= cliff <= months");
      const strike = parseDec(e.strike, "strike");
      if (strike.isNeg()) throw new LedgerError("strike cannot be negative");
      s.grants.set(e.grantId, { grantId: e.grantId, holder: e.holder, shares: n, strike, vesting: v, exercised: ZERO, forfeited: ZERO });
      break;
    }
    case "exercise": {
      const g = s.grants.get(e.grantId);
      if (!g) throw new LedgerError(`unknown grant "${e.grantId}"`);
      const n = wholeShares(e.shares);
      const vestCap = g.terminatedOn ? g.shares.minus(g.forfeited) : vestedShares(g.shares, g.vesting, e.date);
      const exercisable = vestCap.minus(g.exercised);
      if (n.gt(exercisable)) throw new LedgerError(`grant ${g.grantId} has ${exercisable} vested, unexercised options on ${e.date}, cannot exercise ${n}`);
      g.exercised = g.exercised.plus(n);
      add(s, g.holder, ctx.commonClassId, n);
      break;
    }
    case "terminate": {
      const g = s.grants.get(e.grantId);
      if (!g) throw new LedgerError(`unknown grant "${e.grantId}"`);
      if (g.terminatedOn) throw new LedgerError(`grant ${g.grantId} was already terminated on ${g.terminatedOn}`);
      // Unvested options go back to the pool; vested ones stay exercisable.
      g.forfeited = g.shares.minus(vestedShares(g.shares, g.vesting, e.date));
      g.terminatedOn = e.date;
      break;
    }
    case "safe": {
      needHolder(e.holder);
      if (s.safes.some((x) => x.safeId === e.safeId)) throw new LedgerError(`SAFE id "${e.safeId}" already exists`);
      const amount = parseDec(e.amount, "SAFE amount");
      if (amount.lte(0)) throw new LedgerError("SAFE amount must be above zero");
      const cap = e.postMoneyCap ? parseDec(e.postMoneyCap, "valuation cap") : undefined;
      const disc = e.discount ? parseDec(e.discount, "discount") : undefined;
      if (!cap && !disc) throw new LedgerError("a SAFE needs a valuation cap, a discount, or both");
      if (cap && cap.lte(amount)) throw new LedgerError("valuation cap must be larger than the SAFE amount");
      if (disc && (disc.lte(0) || disc.gte(1))) throw new LedgerError("discount must be between 0 and 1 (e.g. 0.2 for 20%)");
      s.safes.push({ safeId: e.safeId, holder: e.holder, amount, postMoneyCap: cap, discount: disc });
      break;
    }
    default: {
      const never: never = e;
      throw new LedgerError(`unknown event type ${(never as { type: string }).type}`);
    }
  }
  s.lastDate = e.date;
}

/** Replays events from scratch. On a bad event, reports which one (0-based). */
export function replay(events: readonly CapEvent[], ctx: Context, upTo?: IsoDate): CapState {
  const s = emptyState();
  events.forEach((e, i) => {
    if (upTo && e.date > upTo) return;
    try {
      apply(s, e, ctx);
    } catch (err) {
      if (err instanceof LedgerError) throw new LedgerError(`event #${i} (${e.type}): ${err.message}`);
      throw err;
    }
  });
  return s;
}

export interface CapRow {
  holder: string;
  byClass: Record<string, Dec>;
  shares: Dec;
  options: Dec;
  fullyDiluted: Dec;
}

export interface CapSummary {
  rows: CapRow[];
  classTotals: Record<string, Dec>;
  totalShares: Dec;
  totalOptions: Dec;
  poolAvailable: Dec;
  fullyDiluted: Dec;
  safeTotal: Dec;
}

/** Outstanding = issued shares. Fully diluted = shares + outstanding options + unallocated pool. */
export function summarize(s: CapState): CapSummary {
  const rows = new Map<string, CapRow>();
  const row = (h: string) => {
    let r = rows.get(h);
    if (!r) rows.set(h, (r = { holder: h, byClass: {}, shares: ZERO, options: ZERO, fullyDiluted: ZERO }));
    return r;
  };
  const classTotals: Record<string, Dec> = {};
  for (const [h, byClass] of s.positions) {
    for (const [c, n] of byClass) {
      if (n.isZero()) continue;
      const r = row(h);
      r.byClass[c] = n;
      r.shares = r.shares.plus(n);
      classTotals[c] = (classTotals[c] ?? ZERO).plus(n);
    }
  }
  for (const g of s.grants.values()) {
    const o = outstandingOptions(g);
    if (o.gt(0)) row(g.holder).options = row(g.holder).options.plus(o);
  }
  let totalShares = ZERO;
  let totalOptions = ZERO;
  for (const r of rows.values()) {
    r.fullyDiluted = r.shares.plus(r.options);
    totalShares = totalShares.plus(r.shares);
    totalOptions = totalOptions.plus(r.options);
  }
  const avail = poolAvailable(s);
  return {
    rows: [...rows.values()].sort((a, b) => b.fullyDiluted.cmp(a.fullyDiluted)),
    classTotals,
    totalShares,
    totalOptions,
    poolAvailable: avail,
    fullyDiluted: totalShares.plus(totalOptions).plus(avail),
    safeTotal: s.safes.reduce((acc, x) => acc.plus(x.amount), new D(0)),
  };
}
