import { useEffect, useMemo, useState } from "react";
import { type CapState, contextOf, replay, summarize } from "../domain/capTable";
import { today } from "../domain/dates";
import { verifyLedger } from "../domain/ledger";
import type { CompanyFile } from "../domain/types";
import { CapTableView } from "./CapTableView";
import { GrantsView } from "./GrantsView";
import { LedgerView } from "./LedgerView";
import { RoundView } from "./RoundView";
import { type Book, demoBook, loadBook, saveBook } from "./store";

const TABS = ["Cap table", "Ledger", "Options & vesting", "Round modeler"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [book, setBook] = useState<Book>(loadBook);
  const [tab, setTab] = useState<Tab>("Cap table");
  const [asOf, setAsOf] = useState(today());

  useEffect(() => saveBook(book), [book]);

  const file: CompanyFile = useMemo(() => ({ ...book.meta, events: book.ledger.map((e) => e.event) }), [book]);
  const ctx = useMemo(() => contextOf(file), [file]);
  const integrity = useMemo(() => verifyLedger(book.ledger), [book.ledger]);

  const computed = useMemo((): { state: CapState; error?: undefined } | { state?: undefined; error: string } => {
    try {
      return { state: replay(file.events, ctx, asOf) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [file, ctx, asOf]);

  const names = useMemo(() => new Map(book.meta.stakeholders.map((s) => [s.id, s.name])), [book.meta]);
  const name = (id: string) => names.get(id) ?? id;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>{book.meta.company.name}</h1>
          <p className="muted">Cap table built from an append-only, hash-chained event ledger. Demo data, stored only in your browser.</p>
        </div>
        <div className="controls">
          <label>
            As of <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          </label>
          <span className={integrity.ok ? "badge ok" : "badge bad"} title="Every entry's SHA-256 hash is recomputed on each change">
            {integrity.ok ? `Ledger verified: ${book.ledger.length} entries` : `Ledger tampered at entry #${integrity.seq}`}
          </span>
          <button
            className="ghost"
            onClick={() => {
              setBook(demoBook());
              setAsOf(today());
            }}
          >
            Reset demo
          </button>
        </div>
      </header>

      <nav role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <main>
        {computed.error !== undefined && <p className="error">Cannot replay the ledger: {computed.error}</p>}
        {tab === "Ledger" && <LedgerView book={book} setBook={setBook} ctx={ctx} name={name} />}
        {computed.state && tab === "Cap table" && <CapTableView book={book} summary={summarize(computed.state)} state={computed.state} name={name} asOf={asOf} />}
        {computed.state && tab === "Options & vesting" && <GrantsView state={computed.state} name={name} asOf={asOf} />}
        {computed.state && tab === "Round modeler" && <RoundView summary={summarize(computed.state)} state={computed.state} name={name} />}
      </main>

      <footer className="muted">
        captable-lite · TypeScript, React, decimal.js, SHA-256 · no server, no database · <a href="https://github.com/mervzz08/captable-lite">source</a>
      </footer>
    </div>
  );
}
