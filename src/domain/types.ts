/** ISO calendar date, YYYY-MM-DD. */
export type IsoDate = string;

export interface ShareClass {
  id: string;
  name: string;
  kind: "common" | "preferred";
}

export interface Stakeholder {
  id: string;
  name: string;
  role: "founder" | "employee" | "investor" | "advisor";
}

export interface VestingTerms {
  start: IsoDate;
  months: number;
  cliffMonths: number;
}

/**
 * Every change to the cap table is one of these events. Events are only ever
 * appended; corrections are new events (e.g. a `cancel`), never edits.
 * Share counts and money are decimal strings so they survive JSON exactly.
 */
export type CapEvent =
  | { type: "issue"; date: IsoDate; holder: string; classId: string; shares: string; pricePerShare: string }
  | { type: "transfer"; date: IsoDate; from: string; to: string; classId: string; shares: string }
  | { type: "cancel"; date: IsoDate; holder: string; classId: string; shares: string; reason: string }
  | { type: "poolIncrease"; date: IsoDate; shares: string }
  | { type: "grant"; date: IsoDate; grantId: string; holder: string; shares: string; strike: string; vesting: VestingTerms }
  | { type: "exercise"; date: IsoDate; grantId: string; shares: string }
  | { type: "terminate"; date: IsoDate; grantId: string }
  | { type: "safe"; date: IsoDate; safeId: string; holder: string; amount: string; postMoneyCap?: string; discount?: string };

export type EventType = CapEvent["type"];

export interface LedgerEntry {
  seq: number;
  event: CapEvent;
  prevHash: string;
  hash: string;
}

export interface CompanyFile {
  company: { name: string; commonClassId: string };
  classes: ShareClass[];
  stakeholders: Stakeholder[];
  events: CapEvent[];
}
