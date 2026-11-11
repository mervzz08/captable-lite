import { useState } from "react";
import { type Context, replay } from "../domain/capTable";
import { append, verifyLedger } from "../domain/ledger";
import type { CapEvent, EventType, LedgerEntry } from "../domain/types";
import { type Book, download } from "./store";

interface Props {
  book: Book;
  setBook: (b: Book) => void;
  ctx: Context;
  name: (id: string) => string;
}

type Field = { key: string; label: string; kind: "holder" | "class" | "grant" | "text" | "date" | "number" };

const FIELDS: Record<EventType, Field[]> = {
  issue: [
    { key: "holder", label: "Holder", kind: "holder" },
    { key: "classId", label: "Class", kind: "class" },
    { key: "shares", label: "Shares", kind: "number" },
    { key: "pricePerShare", label: "Price / share", kind: "number" },
  ],
  transfer: [
    { key: "from", label: "From", kind: "holder" },
    { key: "to", label: "To", kind: "holder" },
    { key: "classId", label: "Class", kind: "class" },
    { key: "shares", label: "Shares", kind: "number" },
  ],
  cancel: [
    { key: "holder", label: "Holder", kind: "holder" },
    { key: "classId", label: "Class", kind: "class" },
    { key: "shares", label: "Shares", kind: "number" },
    { key: "reason", label: "Reason", kind: "text" },
  ],
  poolIncrease: [{ key: "shares", label: "Shares added to pool", kind: "number" }],
  grant: [
    { key: "grantId", label: "Grant id", kind: "text" },
    { key: "holder", label: "Holder", kind: "holder" },
    { key: "shares", label: "Options", kind: "number" },
    { key: "strike", label: "Strike", kind: "number" },
    { key: "vestStart", label: "Vesting start", kind: "date" },
    { key: "vestMonths", label: "Months", kind: "number" },
    { key: "cliffMonths", label: "Cliff months", kind: "number" },
  ],
  exercise: [
    { key: "grantId", label: "Grant", kind: "grant" },
    { key: "shares", label: "Options to exercise", kind: "number" },
  ],
  terminate: [{ key: "grantId", label: "Grant", kind: "grant" }],
  safe: [
    { key: "safeId", label: "SAFE id", kind: "text" },
    { key: "holder", label: "Investor", kind: "holder" },
    { key: "amount", label: "Amount ($)", kind: "number" },
    { key: "postMoneyCap", label: "Post-money cap ($, optional)", kind: "number" },
    { key: "discount", label: "Discount (0.2 = 20%, optional)", kind: "number" },
  ],
};

function toEvent(type: EventType, date: string, v: Record<string, string>): CapEvent {
  if (type === "grant") {
    const { vestStart, vestMonths, cliffMonths, ...rest } = v;
    return { type, date, ...rest, vesting: { start: vestStart || date, months: Number(vestMonths || 48), cliffMonths: Number(cliffMonths || 12) } } as CapEvent;
  }
  if (type === "safe") {
    return { type, date, safeId: v.safeId, holder: v.holder, amount: v.amount, postMoneyCap: v.postMoneyCap || undefined, discount: v.discount || undefined } as CapEvent;
  }
  return { type, date, ...v } as CapEvent;
}

function describe(raw: CapEvent, name: (id: string) => string): string {
  // Display only: add thousands separators to numeric fields.
  const n = (v: string) => (/^\d+(\.\d+)?$/.test(v) && Number(v) >= 1000 ? Number(v).toLocaleString("en-US") : v);
  const e = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" && k !== "date" ? n(v) : v])) as CapEvent;
  switch (e.type) {
    case "issue": return `Issued ${e.shares} ${e.classId} to ${name(e.holder)} at $${e.pricePerShare}`;
    case "transfer": return `${name(e.from)} transferred ${e.shares} ${e.classId} to ${name(e.to)}`;
    case "cancel": return `Cancelled ${e.shares} ${e.classId} from ${name(e.holder)} (${e.reason})`;
    case "poolIncrease": return `Option pool increased by ${e.shares}`;
    case "grant": return `Grant ${e.grantId}: ${e.shares} options to ${name(e.holder)} at $${e.strike}`;
    case "exercise": return `Exercised ${e.shares} options on ${e.grantId}`;
    case "terminate": return `Terminated ${e.grantId}; unvested options return to the pool`;
    case "safe": return `SAFE ${e.safeId}: $${e.amount} from ${name(e.holder)}${e.postMoneyCap ? `, cap $${e.postMoneyCap}` : ""}${e.discount ? `, ${Number(e.discount) * 100}% discount` : ""}`;
  }
}

export function LedgerView({ book, setBook, ctx, name }: Props) {
  const lastDate = book.ledger.at(-1)?.event.date ?? "2022-01-01";
  const [type, setType] = useState<EventType>("issue");
  const [date, setDate] = useState(lastDate);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const integrity = verifyLedger(book.ledger);
  const grantIds = book.ledger.flatMap((e) => (e.event.type === "grant" ? [e.event.grantId] : []));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!integrity.ok) {
      setMessage({ ok: false, text: "The ledger failed its hash check, so nothing new can be appended to it. Use Reset demo to restore it." });
      return;
    }
    const event = toEvent(type, date, values);
    try {
      // Validate by replaying the whole history plus the new event.
      replay([...book.ledger.map((e) => e.event), event], ctx);
      setBook({ ...book, ledger: append(book.ledger, event) });
      setValues({});
      setMessage({ ok: true, text: `Appended entry #${book.ledger.length}.` });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  };

  const tamper = () => {
    // Edit an old entry *without* re-hashing, the way a direct database edit would.
    const i = book.ledger.findIndex((e) => e.event.type === "issue");
    const ledger: LedgerEntry[] = book.ledger.map((e, j) =>
      j === i && e.event.type === "issue" ? { ...e, event: { ...e.event, shares: String(Number(e.event.shares) + 1_000_000) } } : e,
    );
    setBook({ ...book, ledger });
    setMessage({ ok: false, text: `Entry #${i} was edited in place. The hash check now fails at that entry.` });
  };

  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Book;
      if (!data.meta || !Array.isArray(data.ledger)) throw new Error("not a captable-lite export");
      const check = verifyLedger(data.ledger);
      if (!check.ok) throw new Error(`hash chain broken at entry #${check.seq}; refusing to import`);
      setBook(data);
      setMessage({ ok: true, text: `Imported ${data.ledger.length} verified entries.` });
    } catch (e) {
      setMessage({ ok: false, text: `Import failed: ${(e as Error).message}` });
    }
  };

  return (
    <section>
      <form className="card" onSubmit={submit}>
        <h3>Append an event</h3>
        <p className="muted">History is never edited. To fix a mistake, append a correcting event. Each new event is validated against the full history first.</p>
        <div className="form-row">
          <label>
            Type
            <select value={type} onChange={(e) => { setType(e.target.value as EventType); setValues({}); }}>
              {Object.keys(FIELDS).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {FIELDS[type].map((f) => (
            <label key={f.key}>
              {f.label}
              <FieldInput field={f} value={values[f.key] ?? ""} onChange={(v) => setValues({ ...values, [f.key]: v })} book={book} grantIds={grantIds} />
            </label>
          ))}
        </div>
        <button type="submit" disabled={!integrity.ok}>Append</button>
        {message && <p className={message.ok ? "okmsg" : "error"}>{message.text}</p>}
      </form>

      <div className="toolbar">
        <button className="ghost" onClick={() => download("captable-ledger.json", JSON.stringify(book, null, 2), "application/json")}>Export JSON</button>
        <label className="button ghost">
          Import JSON
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
        <button className="ghost danger" onClick={tamper} disabled={!integrity.ok}>Simulate tampering</button>
      </div>

      <ol className="ledger">
        {[...book.ledger].reverse().map((e) => {
          const broken = !integrity.ok && e.seq >= integrity.seq;
          return (
            <li key={e.seq} className={broken ? "broken" : ""}>
              <div className="ledger-head">
                <span className="seq">#{e.seq}</span>
                <span className="date">{e.event.date}</span>
                <span>{describe(e.event, name)}</span>
              </div>
              <code title={`prev ${e.prevHash}`}>{e.hash.slice(0, 16)}… ← {e.prevHash.slice(0, 8)}…</code>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FieldInput({ field, value, onChange, book, grantIds }: { field: Field; value: string; onChange: (v: string) => void; book: Book; grantIds: string[] }) {
  const options =
    field.kind === "holder" ? book.meta.stakeholders.map((s) => [s.id, s.name]) :
    field.kind === "class" ? book.meta.classes.map((c) => [c.id, c.name]) :
    field.kind === "grant" ? grantIds.map((g) => [g, g]) : null;
  if (options) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose…</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  }
  const optional = field.label.includes("optional");
  return <input type={field.kind === "date" ? "date" : "text"} inputMode={field.kind === "number" ? "decimal" : undefined} value={value} onChange={(e) => onChange(e.target.value)} required={!optional && field.key !== "vestStart"} />;
}
