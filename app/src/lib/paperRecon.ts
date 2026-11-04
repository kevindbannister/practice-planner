// Working paper helpers for the fixed asset schedule and for reconciling each section to the trial balance:
//  - which asset classes the fixed asset summary shows (hidden when the trial balance has nothing for them, unless the user ticks them on)
//  - this year's additions, listed from the registers (so an asset in a register's breakdown is always in the additions)
//  - the depreciation journal that makes the trial balance agree to the registers
//  - whether a section's schedules agree to the trial balance
import { Line, Section, Setup, leadRows, linesFor, registerTotals, setupKey, setupOf, subValue, subsFor } from "./papers";
import { Row } from "./schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (x: unknown) => Number(x) || 0;

// ------------------------------------------------------------------ the columns of the fixed asset summary

/**
 * Whether an asset class's column shows. A tick the user has made wins. Otherwise a class shows unless there is a trial balance and
 * it has nothing for that class (no cost and no depreciation) and the register has no figures either. A register with figures but
 * no trial balance balance stays on show, because that is a difference worth seeing.
 */
export function classShown(o: { override?: boolean; hasTb: boolean; tbCost?: number; tbDep?: number; hasFigures: boolean }): boolean {
  if (o.override !== undefined) return o.override;
  if (!o.hasTb) return true;
  return !!o.tbCost || !!o.tbDep || o.hasFigures;
}

// ------------------------------------------------------------------ this year's additions

export type AdditionRow = { classKey: string; cls: string; date: string; asset: string; details: string; amount: number };

/** Every register line with an addition in the year, class by class. */
export function additionsFromRegisters(regs: { key: string; title: string; lines: Line[] }[]): AdditionRow[] {
  const out: AdditionRow[] = [];
  for (const r of regs) {
    for (const l of r.lines) {
      const amount = round2(num(l.f.add));
      if (!amount) continue;
      out.push({ classKey: r.key, cls: r.title, date: String(l.f.date || ""), asset: l.Detail || "", details: l.Remark || "", amount });
    }
  }
  return out;
}

// ------------------------------------------------------------------ disposals

export type DisposalRow = {
  classKey: string; cls: string; asset: string; boughtOn: string; disposedOn: string;
  cost: number; depElim: number; nbv: number;
  /** proceeds typed on the line (undefined until entered) */ proceeds: number | undefined;
  /** proceeds less NBV; undefined until proceeds are entered */ profit: number | undefined;
  line: Line;
};

/** Every register line with a disposal in the year: cost disposed, depreciation eliminated, NBV, and (once typed) proceeds and the profit or loss. */
export function disposalsFromRegisters(regs: { key: string; title: string; lines: Line[] }[]): DisposalRow[] {
  const out: DisposalRow[] = [];
  for (const r of regs) {
    for (const l of r.lines) {
      const cost = round2(num(l.f.disp)), depElim = round2(num(l.f.depDisp));
      if (!cost && !depElim) continue;
      const nbv = round2(cost - depElim);
      const typed = l.f.proceeds === undefined || l.f.proceeds === "" ? undefined : round2(num(l.f.proceeds));
      out.push({ classKey: r.key, cls: r.title, asset: l.Detail || "", boughtOn: String(l.f.date || ""), disposedOn: String(l.f.disposedOn || ""), cost, depElim, nbv, proceeds: typed, profit: typed === undefined ? undefined : round2(typed - nbv), line: l });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the depreciation journal

export type Acct = { code: string; name: string };
export type DepClass = {
  key: string; title: string;
  /** depreciation carried forward per the register */ depCf: number;
  /** depreciation per the trial balance and the other journals (a credit balance is positive), before this journal */ tbDep: number;
  /** the trial balance account to credit, when there is one */ creditAcct?: Acct;
};
export type DepJournalLine = { Code: string; Detail: string; dr: number; cr: number; Remark?: string };
export type DepJournal = {
  lines: DepJournalLine[];
  /** accounts the journal makes (they aren't on the trial balance), with where they go in the papers */
  newAccounts: { code: string; name: string; dest: string }[];
  perClass: { key: string; title: string; amount: number }[];
  notes: string[];
};

/** IRIS puts a class's depreciation on a /21 account of the class's code (523 plant, 524 fixtures, 525 motor, 526 computer). */
const IRIS_CLASS: Record<string, string> = { plant: "523", fixtures: "524", motor: "525", computer: "526" };

/**
 * The journal that brings the trial balance's depreciation up to the registers': for each class, credit its depreciation account
 * with what the register has and the trial balance hasn't, and debit the depreciation charge for the total. A class that already agrees
 * (or where the trial balance has more) has no line. Accounts that don't exist yet are listed so the journal can create them.
 */
export function depreciationJournal(classes: DepClass[], chargeAcct: Acct | undefined, dateText: string): DepJournal {
  const lines: DepJournalLine[] = [];
  const newAccounts: DepJournal["newAccounts"] = [];
  const perClass: DepJournal["perClass"] = [];
  const notes: string[] = [];
  let total = 0;
  for (const c of classes) {
    const amount = round2(c.depCf - c.tbDep);
    if (Math.abs(amount) < 0.005) continue;
    if (amount < 0) {
      notes.push(`${c.title}: the trial balance has £${Math.abs(amount).toFixed(2)} more depreciation than the register, so there's nothing to journal. Check the register or the trial balance.`);
      continue;
    }
    const acct = c.creditAcct || { code: IRIS_CLASS[c.key] ? `${IRIS_CLASS[c.key]}/21` : "", name: `${c.title} depreciation` };
    if (!c.creditAcct) newAccounts.push({ code: acct.code, name: acct.name, dest: `fixed/${c.key}#dep` });
    lines.push({ Code: acct.code, Detail: acct.name, dr: 0, cr: amount });
    perClass.push({ key: c.key, title: c.title, amount });
    total = round2(total + amount);
  }
  if (!total) return { lines: [], newAccounts: [], perClass, notes };
  const charge = chargeAcct || { code: "", name: "Depreciation" };
  if (!chargeAcct) newAccounts.push({ code: charge.code, name: charge.name, dest: "expenditure/depreciation" });
  lines.unshift({ Code: charge.code, Detail: charge.name, dr: total, cr: 0, Remark: `Being depreciation charge for the year ended ${dateText}` });
  return { lines, newAccounts, perClass, notes };
}

/** The journal as stored: what each account is debited and credited, to tell whether the registers have changed since. */
export function journalSignature(lines: { Code: string; Detail: string; dr: number; cr: number }[]): string {
  const by = new Map<string, number>();
  for (const l of lines) {
    const k = `${l.Code.trim().toLowerCase()}|${l.Detail.trim().toLowerCase()}`;
    by.set(k, round2((by.get(k) || 0) + l.dr - l.cr));
  }
  return [...by.entries()].filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(";");
}

// ------------------------------------------------------------------ does a section agree to the trial balance

export type ReconDiff = { label: string; diff: number };
export type Recon = { checked: number; diffs: ReconDiff[] };

/**
 * Whether a section's schedules agree to the trial balance (after journals): for each schedule that has been filled in and has a figure
 * on the trial balance, its own figure against the trial balance's. `checks` is the trial balance total for each place in the papers.
 */
export function sectionRecon(sec: Section, papers: Row[], paperLines: Row[], clientKey: string, period: string, checks: Map<string, number> | undefined): Recon {
  const out: Recon = { checked: 0, diffs: [] };
  if (!checks) return out;
  const compare = (label: string, mine: number, tb: number | undefined) => {
    if (tb === undefined) return;
    out.checked++;
    const d = round2(mine - tb);
    if (Math.abs(d) > 0.004) out.diffs.push({ label, diff: d });
  };
  if (sec.summary === "lead") {
    for (const r of leadRows(sec, papers, paperLines, clientKey, period, { now: checks })) {
      if (r.fromTb) continue;
      const key = `${sec.key}/${r.sub.key}`;
      const t = r.sub.split ? (r.after ? checks.get(`${key}#after`) : checks.get(key)) : checks.get(key);
      compare(`${sec.title} › ${r.label}`, r.now, t);
    }
  }
  const registers = sec.summary === "assets" ? subsFor(sec, papers, clientKey, period).filter((x) => x.kind === "register") : [];
  for (const sb of registers) {
    const lines = linesFor(paperLines, clientKey, period, sec.key, sb.key);
    if (!lines.length) continue;
    const t = registerTotals(lines, { ...setupOf(papers, clientKey, period, setupKey(sec.key, sb.key)), _period: period });
    compare(`${sb.title}: cost`, t.costCf, checks.get(`${sec.key}/${sb.key}#cost`) ?? 0);
    compare(`${sb.title}: depreciation`, t.depCf, checks.get(`${sec.key}/${sb.key}#dep`) ?? 0);
  }
  if (sec.summary !== "lead" && sec.summary !== "assets") {
    for (const sb of subsFor(sec, papers, clientKey, period)) {
      if (!["account", "expense", "list"].includes(sb.kind) || sb.key === "additions") continue;
      const key = `${sec.key}/${sb.key}`;
      const tb = checks.get(key);
      const s: Setup = { ...setupOf(papers, clientKey, period, setupKey(sec.key, sb.key)), _period: period };
      const lines = linesFor(paperLines, clientKey, period, sec.key, sb.key);
      const filled = lines.length > 0 || (sb.kind === "account" && s.bf !== undefined);
      if (!filled) continue;
      compare(`${sb.title}`, subValue(sb, lines, s), tb);
    }
  }
  return out;
}
