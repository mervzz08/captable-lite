# captable-lite

A minimalist cap table that runs entirely in the browser. It has no server, no database and no cloud bill. GitHub Pages hosts it, GitHub Actions tests and deploys it, and the demo company is a JSON file in this repo.

**Live demo:** https://mervzz08.github.io/captable-lite/

## What it does

- **Append-only, hash-chained ledger.** Every change is an event: issue, transfer, cancel, pool increase, option grant, exercise, termination, or SAFE. Each entry stores the SHA-256 of its content plus the previous entry's hash, so editing history breaks the chain at that point. The **Simulate tampering** button shows this. Imports with a broken chain are refused.
- **Cap table by replay.** The current table (or the table on any past date) is computed by replaying the ledger. You never edit totals directly. Shows outstanding % and fully diluted % (shares + outstanding options + unallocated pool).
- **Validation in plain English.** Each new event is checked against the full history first. Transfers can't exceed holdings, grants can't exceed the pool, only vested options can be exercised, and events stay in date order. The error names the event that failed.
- **Vesting.** Monthly vesting with a cliff, rounded down so it never over-vests. On termination, unvested options go back to the pool.
- **Priced-round modeler.** Post-money SAFEs (cap, discount, or both, whichever is better for the holder) convert, and the option pool is topped up to a post-money target inside the pre-money. The price, SAFE shares and pool top-up depend on each other, so they're solved together: closed form for the capped SAFEs, fixed-point iteration for the rest.
- **Exact math.** All share and money arithmetic uses `decimal.js`, never floats.
- **Portable.** Export the cap table as CSV, or the whole ledger as JSON (re-importable, verified on import).

## Stack

TypeScript, React 18, Vite, decimal.js, @noble/hashes, Vitest. The calculation engine in `src/domain/` is pure TypeScript with no UI or I/O, so it can be tested and reused on its own.

```
src/domain/   pure engine: ledger (hash chain), capTable (replay + validation), vesting, round (SAFE/pool modeling)
src/ui/       React views; state persisted to localStorage
data/         demo company (fictional) as plain JSON
```

## Run it

```bash
npm install
npm test        # engine tests
npm run dev     # http://localhost:5173
```

## Design choices

| Choice | Why |
|---|---|
| Static site instead of a backend | A cap table for one company is small. Replaying a few thousand events in the browser takes milliseconds, so there's no server to secure, pay for or keep alive. |
| Events, not mutable rows | An audit trail comes for free, "as of" any date is just a replay, and a correction is a visible new event, not a silent edit. |
| Hash chain | It's cheap tamper evidence. It doesn't stop someone with write access, but it makes any change to history detectable. |
| Decimal strings in JSON | Share counts and prices round-trip exactly. |

## Limits

This is a portfolio project, not legal or financial advice. It models one common share class plus preferred classes without liquidation preferences, and the SAFE math follows the common post-money convention. Real financings have terms it doesn't cover.

All names and numbers in the demo are fictional. The project was written from scratch, inspired by cap-table work in 2026, and contains no proprietary code.

## License

MIT
