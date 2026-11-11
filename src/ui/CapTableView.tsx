import type { CapState, CapSummary } from "../domain/capTable";
import { fmtMoney, fmtShares, pct } from "../domain/num";
import { type Book, csvCell, download } from "./store";

interface Props {
  book: Book;
  summary: CapSummary;
  state: CapState;
  name: (id: string) => string;
  asOf: string;
}

export function CapTableView({ book, summary: s, state, name, asOf }: Props) {
  const classes = book.meta.classes.filter((c) => s.classTotals[c.id]);

  const exportCsv = () => {
    const head = ["Stakeholder", ...classes.map((c) => c.name), "Options", "Fully diluted", "Outstanding %", "Fully diluted %"];
    const lines = s.rows.map((r) => [
      name(r.holder),
      ...classes.map((c) => (r.byClass[c.id] ?? 0).toString()),
      r.options.toString(),
      r.fullyDiluted.toString(),
      pct(r.shares, s.totalShares),
      pct(r.fullyDiluted, s.fullyDiluted),
    ]);
    lines.push(["Unallocated option pool", ...classes.map(() => ""), "", s.poolAvailable.toString(), "", pct(s.poolAvailable, s.fullyDiluted)]);
    const csv = [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\n");
    download(`cap-table-${asOf}.csv`, csv, "text/csv");
  };

  return (
    <section>
      <div className="stats">
        <Stat label="Shares outstanding" value={fmtShares(s.totalShares)} />
        <Stat label="Options outstanding" value={fmtShares(s.totalOptions)} />
        <Stat label="Pool available" value={fmtShares(s.poolAvailable)} />
        <Stat label="Fully diluted" value={fmtShares(s.fullyDiluted)} />
        <Stat label="SAFEs (unconverted)" value={fmtMoney(s.safeTotal, 0)} />
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Stakeholder</th>
              {classes.map((c) => (
                <th key={c.id} className="num">{c.name}</th>
              ))}
              <th className="num">Options</th>
              <th className="num">Fully diluted</th>
              <th className="num">Outstanding %</th>
              <th className="num">FD %</th>
              <th className="bar-col" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.holder}>
                <td>{name(r.holder)}</td>
                {classes.map((c) => (
                  <td key={c.id} className="num">{r.byClass[c.id] ? fmtShares(r.byClass[c.id]) : "–"}</td>
                ))}
                <td className="num">{r.options.gt(0) ? fmtShares(r.options) : "–"}</td>
                <td className="num">{fmtShares(r.fullyDiluted)}</td>
                <td className="num">{pct(r.shares, s.totalShares)}</td>
                <td className="num">{pct(r.fullyDiluted, s.fullyDiluted)}</td>
                <td className="bar-col"><Bar frac={r.fullyDiluted.div(s.fullyDiluted).toNumber()} /></td>
              </tr>
            ))}
            <tr className="muted-row">
              <td>Unallocated option pool</td>
              {classes.map((c) => <td key={c.id} />)}
              <td />
              <td className="num">{fmtShares(s.poolAvailable)}</td>
              <td />
              <td className="num">{pct(s.poolAvailable, s.fullyDiluted)}</td>
              <td className="bar-col"><Bar frac={s.poolAvailable.div(s.fullyDiluted).toNumber()} /></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {classes.map((c) => (
                <td key={c.id} className="num">{fmtShares(s.classTotals[c.id])}</td>
              ))}
              <td className="num">{fmtShares(s.totalOptions)}</td>
              <td className="num">{fmtShares(s.fullyDiluted)}</td>
              <td className="num">100.00%</td>
              <td className="num">100.00%</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {state.safes.length > 0 && (
        <p className="muted">
          SAFEs are not counted in the share totals until a priced round converts them. Try the Round modeler tab.
        </p>
      )}
      <button onClick={exportCsv}>Export CSV</button>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function Bar({ frac }: { frac: number }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
    </div>
  );
}
