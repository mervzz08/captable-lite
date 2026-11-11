import { useState } from "react";
import type { CapState, CapSummary } from "../domain/capTable";
import { D, fmtMoney, fmtShares } from "../domain/num";
import { modelRound, NEW_INVESTOR, POOL, type RoundResult } from "../domain/round";
import { Bar } from "./CapTableView";

interface Props {
  summary: CapSummary;
  state: CapState;
  name: (id: string) => string;
}

export function RoundView({ summary, state, name }: Props) {
  const [preMoney, setPreMoney] = useState("20000000");
  const [newMoney, setNewMoney] = useState("5000000");
  const [pool, setPool] = useState("10");

  let result: RoundResult | undefined;
  let error: string | undefined;
  try {
    result = modelRound(summary, state, {
      preMoney: new D(preMoney || 0),
      newMoney: new D(newMoney || 0),
      targetPoolPct: new D(pool || 0).div(100),
    });
  } catch (e) {
    error = (e as Error).message;
  }
  const label = (h: string) => (h === NEW_INVESTOR || h === POOL ? h : name(h));

  return (
    <section>
      <p className="muted">
        Pro-forma for a priced round. Post-money SAFEs convert, the option pool is topped up to the target as part of the pre-money, and the
        circular price is solved by fixed-point iteration. Nothing here is written to the ledger.
      </p>
      <div className="form-row">
        <label>
          Pre-money valuation ($)
          <input inputMode="numeric" value={preMoney} onChange={(e) => setPreMoney(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label>
          New money ($)
          <input inputMode="numeric" value={newMoney} onChange={(e) => setNewMoney(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label>
          Target pool, post-money (%)
          <input inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <div className="stats">
            <div className="stat"><div className="muted">Price per share</div><div className="stat-value">{fmtMoney(result.pricePerShare, 4)}</div></div>
            <div className="stat"><div className="muted">Post-money</div><div className="stat-value">{fmtMoney(new D(preMoney).plus(newMoney), 0)}</div></div>
            <div className="stat"><div className="muted">New shares to investor</div><div className="stat-value">{fmtShares(result.newInvestorShares)}</div></div>
            <div className="stat"><div className="muted">Pool top-up</div><div className="stat-value">{fmtShares(result.poolTopUp)}</div></div>
          </div>

          {result.conversions.length > 0 && (
            <>
              <h3>SAFE conversions</h3>
              <div className="scroll">
                <table>
                  <thead>
                    <tr><th>SAFE</th><th>Holder</th><th className="num">Amount</th><th>Converts at</th><th className="num">Price</th><th className="num">Shares</th></tr>
                  </thead>
                  <tbody>
                    {result.conversions.map((c) => (
                      <tr key={c.safeId}>
                        <td>{c.safeId}</td>
                        <td>{name(c.holder)}</td>
                        <td className="num">{fmtMoney(c.amount, 0)}</td>
                        <td>{c.method === "cap" ? "valuation cap" : "discount"}</td>
                        <td className="num">{fmtMoney(c.price, 4)}</td>
                        <td className="num">{fmtShares(c.shares)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h3>Ownership after the round</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Holder</th><th className="num">FD before</th><th className="num">FD after</th><th className="num">% after</th><th className="bar-col" aria-hidden /></tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.holder} className={r.holder === NEW_INVESTOR ? "hl" : r.holder === POOL ? "muted-row" : ""}>
                    <td>{label(r.holder)}</td>
                    <td className="num">{fmtShares(r.before)}</td>
                    <td className="num">{fmtShares(r.after)}</td>
                    <td className="num">{r.pctAfter.times(100).toFixed(2)}%</td>
                    <td className="bar-col"><Bar frac={r.pctAfter.toNumber()} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
