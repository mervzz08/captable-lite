import { describe, expect, it } from "vitest";
import { contextOf, replay, summarize } from "./capTable";
import { fullMonthsBetween } from "./dates";
import { append, buildLedger, verifyLedger } from "./ledger";
import { D } from "./num";
import { modelRound } from "./round";
import type { CapEvent, CompanyFile } from "./types";
import { vestedShares } from "./vesting";
import demo from "../../data/demo-company.json";

const base = (events: CapEvent[]): CompanyFile => ({
  company: { name: "Test Co", commonClassId: "CS" },
  classes: [
    { id: "CS", name: "Common", kind: "common" },
    { id: "PA", name: "Series A Preferred", kind: "preferred" },
  ],
  stakeholders: ["ana", "ben", "cy", "vc"].map((id) => ({ id, name: id, role: "founder" as const })),
  events,
});

const run = (events: CapEvent[]) => {
  const f = base(events);
  return replay(f.events, contextOf(f));
};

const issue = (holder: string, shares: string, date = "2024-01-01"): CapEvent => ({ type: "issue", date, holder, classId: "CS", shares, pricePerShare: "0.0001" });

describe("dates and vesting", () => {
  it("counts whole months", () => {
    expect(fullMonthsBetween("2024-01-15", "2024-02-14")).toBe(0);
    expect(fullMonthsBetween("2024-01-15", "2024-02-15")).toBe(1);
    expect(fullMonthsBetween("2024-01-31", "2025-01-31")).toBe(12);
    expect(fullMonthsBetween("2024-05-01", "2024-01-01")).toBe(0);
  });

  const terms = { start: "2024-01-01", months: 48, cliffMonths: 12 };
  it("vests nothing before the cliff, a lump at the cliff, then monthly", () => {
    const n = new D(4800);
    expect(vestedShares(n, terms, "2024-12-31").toString()).toBe("0");
    expect(vestedShares(n, terms, "2025-01-01").toString()).toBe("1200");
    expect(vestedShares(n, terms, "2025-02-01").toString()).toBe("1300");
    expect(vestedShares(n, terms, "2030-01-01").toString()).toBe("4800");
  });

  it("rounds down so vesting never exceeds the grant", () => {
    expect(vestedShares(new D(1000), { start: "2024-01-01", months: 3, cliffMonths: 0 }, "2024-02-01").toString()).toBe("333");
  });
});

describe("ledger hash chain", () => {
  it("verifies an untouched ledger and catches any edit", () => {
    const ledger = buildLedger([issue("ana", "100"), issue("ben", "50")]);
    expect(verifyLedger(ledger)).toEqual({ ok: true });
    const tampered = ledger.map((e) => ({ ...e, event: { ...e.event } }));
    (tampered[0].event as { shares: string }).shares = "1000";
    expect(verifyLedger(tampered)).toEqual({ ok: false, seq: 0 });
  });

  it("hashes are independent of key order", () => {
    const a = append([], { type: "poolIncrease", date: "2024-01-01", shares: "10" });
    const b = append([], { shares: "10", date: "2024-01-01", type: "poolIncrease" } as CapEvent);
    expect(a[0].hash).toBe(b[0].hash);
  });
});

describe("cap table replay", () => {
  it("issues, transfers and cancels", () => {
    const s = run([
      issue("ana", "6000000"),
      issue("ben", "4000000"),
      { type: "transfer", date: "2024-02-01", from: "ben", to: "cy", classId: "CS", shares: "1000000" },
      { type: "cancel", date: "2024-03-01", holder: "cy", classId: "CS", shares: "500000", reason: "repurchase" },
    ]);
    const sum = summarize(s);
    expect(sum.totalShares.toString()).toBe("9500000");
    expect(sum.rows.map((r) => [r.holder, r.shares.toString()])).toEqual([
      ["ana", "6000000"],
      ["ben", "3000000"],
      ["cy", "500000"],
    ]);
  });

  it("rejects bad events with a reason that names the event", () => {
    expect(() => run([issue("ana", "100"), { type: "transfer", date: "2024-02-01", from: "ana", to: "ben", classId: "CS", shares: "101" }])).toThrow(/event #1 \(transfer\): ana holds 100/);
    expect(() => run([issue("ghost", "1")])).toThrow(/unknown stakeholder/);
    expect(() => run([issue("ana", "1.5")])).toThrow(/whole number/);
    expect(() => run([issue("ana", "1", "2024-05-01"), issue("ben", "1", "2024-04-01")])).toThrow(/date order/);
  });

  const grantEvents: CapEvent[] = [
    issue("ana", "9000000"),
    { type: "poolIncrease", date: "2024-01-01", shares: "1000000" },
    { type: "grant", date: "2024-01-01", grantId: "G1", holder: "cy", shares: "480000", strike: "0.10", vesting: { start: "2024-01-01", months: 48, cliffMonths: 12 } },
  ];

  it("counts options and unallocated pool in fully diluted", () => {
    const sum = summarize(run(grantEvents));
    expect(sum.totalOptions.toString()).toBe("480000");
    expect(sum.poolAvailable.toString()).toBe("520000");
    expect(sum.fullyDiluted.toString()).toBe("10000000");
  });

  it("only lets vested options be exercised", () => {
    expect(() => run([...grantEvents, { type: "exercise", date: "2024-06-01", grantId: "G1", shares: "1" }])).toThrow(/0 vested/);
    const sum = summarize(run([...grantEvents, { type: "exercise", date: "2025-01-01", grantId: "G1", shares: "120000" }]));
    const cy = sum.rows.find((r) => r.holder === "cy")!;
    expect([cy.shares.toString(), cy.options.toString()]).toEqual(["120000", "360000"]);
  });

  it("returns unvested options to the pool on termination", () => {
    const s = run([...grantEvents, { type: "terminate", date: "2025-07-01", grantId: "G1" }]);
    const sum = summarize(s);
    expect(sum.totalOptions.toString()).toBe("180000"); // 18 of 48 months vested
    expect(sum.poolAvailable.toString()).toBe("820000");
  });

  it("cannot grant more than the pool has left", () => {
    const vesting = { start: "2024-02-01", months: 48, cliffMonths: 12 };
    expect(() => run([...grantEvents, { type: "grant", date: "2024-02-01", grantId: "G2", holder: "ben", shares: "520001", strike: "0.1", vesting }])).toThrow(/520000 shares available/);
  });
});

describe("priced round modeling", () => {
  const close = (a: InstanceType<typeof D>, b: number, tol = 0.0001) => expect(Math.abs(a.toNumber() - b)).toBeLessThan(tol);

  it("plain round: 2.5M on 10M pre is 20% post", () => {
    const s = run([issue("ana", "10000000")]);
    const r = modelRound(summarize(s), s, { preMoney: new D(10e6), newMoney: new D(2.5e6), targetPoolPct: new D(0) });
    expect(r.pricePerShare.toString()).toBe("1");
    expect(r.newInvestorShares.toString()).toBe("2500000");
    close(r.newInvestorShares.div(r.postMoneyFD), 0.2);
  });

  it("pool top-up comes out of the pre-money and lands at the target", () => {
    const s = run([issue("ana", "10000000")]);
    const r = modelRound(summarize(s), s, { preMoney: new D(10e6), newMoney: new D(2.5e6), targetPoolPct: new D(0.1) });
    close(r.pricePerShare, 0.875);
    close(r.poolAfter.div(r.postMoneyFD), 0.1);
    close(r.newInvestorShares.div(r.postMoneyFD), 0.2);
  });

  it("post-money capped SAFE gets exactly amount / cap of the pre-round company", () => {
    const s = run([issue("ana", "9000000"), { type: "safe", date: "2024-02-01", safeId: "S1", holder: "vc", amount: "1000000", postMoneyCap: "10000000" }]);
    const r = modelRound(summarize(s), s, { preMoney: new D(20e6), newMoney: new D(5e6), targetPoolPct: new D(0) });
    expect(r.conversions[0].method).toBe("cap");
    expect(r.conversions[0].shares.toString()).toBe("1000000");
    close(r.pricePerShare, 2);
    close(r.newInvestorShares.div(r.postMoneyFD), 0.2);
  });

  it("discount-only SAFE converts at a discount to the round price", () => {
    const s = run([issue("ana", "10000000"), { type: "safe", date: "2024-02-01", safeId: "S1", holder: "vc", amount: "500000", discount: "0.2" }]);
    const r = modelRound(summarize(s), s, { preMoney: new D(10e6), newMoney: new D(1e6), targetPoolPct: new D(0) });
    close(r.pricePerShare, 0.9375);
    close(r.conversions[0].price, 0.75);
    expect(r.conversions[0].shares.toString()).toBe("666666");
  });

  it("cap+discount SAFE takes the better price", () => {
    const s = run([issue("ana", "9000000"), { type: "safe", date: "2024-02-01", safeId: "S1", holder: "vc", amount: "1000000", postMoneyCap: "10000000", discount: "0.2" }]);
    // Round at $5M pre: price ~0.5, discount price ~0.4 beats cap price 1.00.
    const r = modelRound(summarize(s), s, { preMoney: new D(5e6), newMoney: new D(1e6), targetPoolPct: new D(0) });
    expect(r.conversions[0].method).toBe("discount");
  });
});

describe("demo data", () => {
  it("replays cleanly and its ledger verifies", () => {
    const f = demo as CompanyFile;
    const sum = summarize(replay(f.events, contextOf(f)));
    expect(sum.totalShares.gt(0)).toBe(true);
    expect(verifyLedger(buildLedger(f.events))).toEqual({ ok: true });
  });
});
