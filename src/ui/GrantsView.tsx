import { type CapState, outstandingOptions } from "../domain/capTable";
import { fmtMoney, fmtShares } from "../domain/num";
import { vestedShares } from "../domain/vesting";
import { Bar } from "./CapTableView";

interface Props {
  state: CapState;
  name: (id: string) => string;
  asOf: string;
}

export function GrantsView({ state, name, asOf }: Props) {
  const grants = [...state.grants.values()];
  if (!grants.length) return <p className="muted">No option grants as of {asOf}.</p>;

  return (
    <section>
      <p className="muted">Vesting as of {asOf}. Change the date in the header to move through time.</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Grant</th>
              <th>Holder</th>
              <th className="num">Granted</th>
              <th className="num">Strike</th>
              <th>Schedule</th>
              <th className="num">Vested</th>
              <th className="num">Exercised</th>
              <th className="num">Forfeited</th>
              <th className="num">Outstanding</th>
              <th className="bar-col">Vesting</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => {
              const vested = g.terminatedOn ? g.shares.minus(g.forfeited) : vestedShares(g.shares, g.vesting, asOf);
              return (
                <tr key={g.grantId}>
                  <td>{g.grantId}</td>
                  <td>
                    {name(g.holder)}
                    {g.terminatedOn && <span className="tag">terminated {g.terminatedOn}</span>}
                  </td>
                  <td className="num">{fmtShares(g.shares)}</td>
                  <td className="num">{fmtMoney(g.strike)}</td>
                  <td>
                    {g.vesting.months} mo, {g.vesting.cliffMonths} mo cliff, from {g.vesting.start}
                  </td>
                  <td className="num">{fmtShares(vested)}</td>
                  <td className="num">{fmtShares(g.exercised)}</td>
                  <td className="num">{fmtShares(g.forfeited)}</td>
                  <td className="num">{fmtShares(outstandingOptions(g))}</td>
                  <td className="bar-col"><Bar frac={vested.div(g.shares).toNumber()} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
