// Mapping a trial balance: each account in the software's trial balance is given an IRIS Elements
// code and a place in the working papers (which schedule it belongs to). Suggestions come from, in
// order: the same account code last year for this company, the same account name at another
// company, the IRIS chart (when loaded), and the account's name and type. Once mapped, balances go
// into the list schedules as lines, and the other schedules (registers, accounts, expenses, VAT)
// show the trial balance figure beside their own as a check.
import { Line, SECTIONS, linesFor, priorPeriod } from "./papers";
import { Row } from "./schema";

export type Dest = { key: string; label: string; section: string; sub: string; part?: "cost" | "dep"; side: "dr" | "cr"; post: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every place a trial balance account can go. Lists get the balance as a line; the rest are checks. */
export const DESTS: Dest[] = (() => {
  const out: Dest[] = [];
  const crSections = new Set(["creditors", "loans", "capital", "income"]);
  for (const s of SECTIONS) {
    for (const sb of s.subs) {
      const side: "dr" | "cr" = sb.normal || (crSections.has(s.key) ? "cr" : "dr");
      if (sb.kind === "register") {
        out.push({ key: `${s.key}/${sb.key}#cost`, label: `${s.title} › ${sb.title} (cost)`, section: s.key, sub: sb.key, part: "cost", side: "dr", post: false });
        out.push({ key: `${s.key}/${sb.key}#dep`, label: `${s.title} › ${sb.title} (depreciation)`, section: s.key, sub: sb.key, part: "dep", side: "cr", post: false });
      } else if (sb.kind === "list" && sb.key !== "additions") {
        out.push({ key: `${s.key}/${sb.key}`, label: `${s.title} › ${sb.title}`, section: s.key, sub: sb.key, side, post: true });
      } else if (sb.kind === "account" || sb.kind === "expense") {
        out.push({ key: `${s.key}/${sb.key}`, label: `${s.title} › ${sb.title}`, section: s.key, sub: sb.key, side: sb.kind === "expense" ? "dr" : side, post: false });
      }
    }
  }
  out.push({ key: "ignore", label: "Leave out", section: "", sub: "", side: "dr", post: false });
  return out;
})();
export const DEST_BY_KEY = new Map(DESTS.map((d) => [d.key, d]));

/** A trial balance line's balance: debit positive, credit negative. */
export const tbBalance = (l: Line) => round2((Number(l.f.dr) || 0) - (Number(l.f.cr) || 0));
/** The balance as the schedule shows it: an asset or expense as a debit, a liability or income as a credit. */
export const onSide = (balance: number, side: "dr" | "cr") => round2(side === "dr" ? balance : -balance);

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The likely place for an account from its name, type and balance (debit or credit). */
export function guessDest(name: string, type: string, balance: number): string {
  const n = norm(name), ty = norm(type);
  const credit = balance < 0;
  const isPl = /revenue|income|sales|expense|overhead|direct cost|cost of sales|depreciation|other income/.test(ty);
  const dep = /depreciation|amortisation|amortization|accumulated/.test(n);
  const fixed = (c: string) => `fixed/${c}#${dep ? "dep" : "cost"}`;
  const liability = /liabilit|equity/.test(ty) || /hire purchase|\bhp\b|loan|finance lease|creditor/.test(n);
  if ((!isPl || /fixed|non current asset/.test(ty)) && !liability) {
    if (/goodwill/.test(n)) return `goodwill/goodwill#${dep ? "dep" : "cost"}`;
    if (/intangible|patent|trademark|software development/.test(n)) return `goodwill/intangible#${dep ? "dep" : "cost"}`;
    if (/motor|vehicle|van\b|car\b|cars\b/.test(n) && !/expense|running|fuel|insurance/.test(n)) return fixed("motor");
    if (/fixture|fitting|furniture/.test(n)) return fixed("fixtures");
    if (/computer|it equipment|laptop/.test(n) && !/software subscription/.test(n)) return fixed("computer");
    if (/plant|machinery|equipment|tools/.test(n)) return fixed("plant");
    if (/freehold|leasehold|land|building|property/.test(n) && !/rent|repair/.test(n)) return fixed("freehold");
  }
  if (!isPl) {
    if (/debtors? control|trade debtors|accounts receivable|^debtors$/.test(n)) return "debtors/trade";
    if (/prepay/.test(n)) return "debtors/prepayments";
    if (/accrued income/.test(n)) return "debtors/accrued";
    if (/creditors? control|trade creditors|accounts payable|^creditors$/.test(n)) return "creditors/trade";
    if (/accrual/.test(n)) return "creditors/accruals";
    if (/director/.test(n) && /loan|current|account/.test(n)) return "creditors/dla";
    if (/hire purchase|\bhp\b|finance lease/.test(n)) return "creditors/hp";
    if (/corporation tax|\bct\b/.test(n)) return "creditors/tax";
    if (/vat|paye|national insurance|\bni\b|pension|hmrc|social security|wages control|net wages/.test(n)) return "creditors/ssot";
    if (/bank loan|bounce back|cbils|mortgage/.test(n)) return "creditors/loan";
    if (/share capital|ordinary share|called up/.test(n)) return "capital/shares";
    if (/profit and loss|retained|reserve|dividend|p and l/.test(n)) return "capital/reserves";
    if (/petty cash|cash in hand|^cash$/.test(n)) return "bank/cash";
    if (/deposit|saver|savings|reserve account/.test(n)) return "bank/deposit";
    if (/\beur\b|euro/.test(n)) return "bank/eur";
    if (/\busd\b|dollar/.test(n)) return "bank/usd";
    if (/bank|current account|barclays|lloyds|natwest|hsbc|santander|monzo|starling|tide|metro/.test(n)) return "bank/current";
    if (/work in progress|\bwip\b/.test(n)) return "stock/wip";
    if (/stock|inventory/.test(n)) return "stock/stock";
    if (/investment/.test(n)) return "investments/main";
    if (/loan/.test(n)) return credit ? "creditors/other" : "debtors/other";
    if (/equity|capital/.test(ty)) return "capital/reserves";
    if (/liabilit/.test(ty) && /non current|long term/.test(ty)) return "loans/main";
    if (/liabilit/.test(ty)) return "creditors/other";
    if (/asset/.test(ty)) return credit ? "creditors/other" : "debtors/other";
  }
  if (/cost of sales|cost of goods|purchases|direct cost|materials|subcontract/.test(n) || /direct cost|cost of sales/.test(ty)) return credit && /discount/.test(n) ? "income/other" : "expenditure/cos";
  if (/interest/.test(n) && (credit || /income|revenue/.test(ty))) return "income/interest";
  if (/revenue|income|sales/.test(ty) || /sales|turnover|fees? (income|received)|revenue/.test(n)) return /other|grant|sundry|rent received|commission/.test(n) ? "income/other" : "income/sales";
  if (/accountancy|accounting fees/.test(n)) return "expenditure/accountancy";
  if (isPl || !type) return credit ? "income/other" : "expenditure/tb";
  return credit ? "creditors/other" : "debtors/other";
}

// ------------------------------------------------------------------ the IRIS chart

export type ChartRow = { code: string; name: string; dest?: string };

/** An IRIS chart pasted or loaded from CSV: code and name on each row (a heading row is skipped). */
export function parseChart(text: string): ChartRow[] {
  const out: ChartRow[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    const cells = raw.includes("\t") ? raw.split("\t") : splitCsv(raw);
    const [a, b, c] = cells.map((x) => x.trim().replace(/^"|"$/g, ""));
    if (!a || !b) continue;
    // the code is whichever of the first two cells looks like one (short, with a digit in it)
    const isCode = (x: string) => /^(?=.*\d)[A-Z0-9.\-/]{1,12}$/i.test(x);
    if (!isCode(a) && !isCode(b)) continue; // a heading row
    const [code, name] = isCode(a) ? [a, b] : [b, a];
    out.push({ code, name, dest: c && DEST_BY_KEY.has(c) ? c : undefined });
  }
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cell = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

/** Where an IRIS code's balances go: as set on the chart, else from its name. */
export const chartDest = (c: ChartRow, balance: number) => c.dest || guessDest(c.name, "", balance);

/** The IRIS code whose name best matches an account name (all the words of one in the other). */
export function guessIris(name: string, chart: ChartRow[]): ChartRow | undefined {
  const n = norm(name);
  if (!n) return undefined;
  const exact = chart.find((c) => norm(c.name) === n);
  if (exact) return exact;
  const words = new Set(n.split(" ").filter((w) => w.length > 2));
  let best: ChartRow | undefined, score = 0;
  for (const c of chart) {
    const cw = norm(c.name).split(" ").filter((w) => w.length > 2);
    if (!cw.length) continue;
    const hit = cw.filter((w) => words.has(w)).length;
    const s = hit / Math.max(cw.length, words.size);
    if (hit && s > score) { best = c; score = s; }
  }
  return score >= 0.5 ? best : undefined;
}

// ------------------------------------------------------------------ suggestions for a whole trial balance

export type Mapping = { line: Line; balance: number; iris: string; dest: string; saved: boolean; why: string };

/**
 * What each trial balance line maps to: what's saved on the line, else a suggestion. `allTb` is every
 * company's trial balance lines (to learn from), `clientKey`/`period` the paper being mapped.
 */
export function mapTb(tb: Line[], allTb: Row[], clientKey: string, period: string, chart: ChartRow[]): Mapping[] {
  const prior = linesFor(allTb, clientKey, priorPeriod(period), "tb", "main");
  const byCode = new Map(prior.filter((l) => l.Code && (l.f.dest || l.f.iris)).map((l) => [l.Code.trim(), l]));
  // the same account name mapped at another company (most recent first)
  const byName = new Map<string, { iris?: string; dest?: string }>();
  for (const r of [...allTb].reverse()) {
    if (r.SectionKey !== "tb" || r.ClientKey === clientKey && r.PeriodEnd === period) continue;
    const l = linesFor([r], String(r.ClientKey), String(r.PeriodEnd), "tb", String(r.SubKey || "main"))[0];
    const k = norm(l?.Detail || "");
    if (k && (l.f.dest || l.f.iris) && !byName.has(k)) byName.set(k, { iris: l.f.iris as string, dest: l.f.dest as string });
  }
  const chartByCode = new Map(chart.map((c) => [c.code, c]));
  return tb.map((line) => {
    const balance = tbBalance(line);
    const savedDest = String(line.f.dest || ""), savedIris = String(line.f.iris || "");
    if (savedDest) return { line, balance, iris: savedIris, dest: savedDest, saved: true, why: "" };
    const last = byCode.get(line.Code.trim());
    if (last) return { line, balance, iris: savedIris || String(last.f.iris || ""), dest: String(last.f.dest || "") || guessDest(line.Detail, String(line.f.type || ""), balance), saved: false, why: "As last year" };
    const other = byName.get(norm(line.Detail));
    if (other?.dest) return { line, balance, iris: savedIris || other.iris || "", dest: other.dest, saved: false, why: "As at another company" };
    const ic = savedIris ? chartByCode.get(savedIris) : guessIris(line.Detail, chart);
    if (ic) return { line, balance, iris: ic.code, dest: chartDest(ic, balance), saved: false, why: `IRIS ${ic.code} ${ic.name}` };
    return { line, balance, iris: savedIris, dest: guessDest(line.Detail, String(line.f.type || ""), balance), saved: false, why: "From the name" };
  });
}

/** The lines to put into each list schedule from the mapped trial balance (balance on the schedule's side). */
export function postings(maps: Mapping[]): { dest: Dest; tbKey: string; Code: string; Detail: string; Amount: number }[] {
  const out: { dest: Dest; tbKey: string; Code: string; Detail: string; Amount: number }[] = [];
  for (const m of maps) {
    const d = DEST_BY_KEY.get(m.dest);
    if (!d?.post || !m.balance) continue;
    out.push({ dest: d, tbKey: m.line.Key, Code: m.line.Code, Detail: m.line.Detail, Amount: onSide(m.balance, d.side) });
  }
  return out;
}

/** The trial balance total going to each place (on that place's side), for checking a schedule against it. */
export function tbTotals(maps: Mapping[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of maps) {
    const d = DEST_BY_KEY.get(m.dest);
    if (!d || d.key === "ignore") continue;
    out.set(d.key, round2((out.get(d.key) || 0) + onSide(m.balance, d.side)));
  }
  return out;
}

/** Whether an account is a control account (or a suspense account), and what that means for checking it. */
export function controlNote(name: string, dest: string): { label: string; hint: string } | undefined {
  const n = norm(name);
  if (/suspense/.test(n)) return { label: "Suspense account", hint: "Should be nil: clear it to the right account." };
  if (/debtors? control|accounts receivable|sales ledger/.test(n) || (dest === "debtors/trade" && /control/.test(n)))
    return { label: "Debtors control account", hint: "The total of the sales ledger. The customers behind it come from the aged debtors report." };
  if (/creditors? control|accounts payable|purchase ledger/.test(n) || (dest === "creditors/trade" && /control/.test(n)))
    return { label: "Creditors control account", hint: "The total of the purchase ledger. The suppliers behind it come from the aged creditors report." };
  if (/vat/.test(n) && /control|liability|account/.test(n) || /\bvat\b/.test(n) && dest === "creditors/ssot")
    return { label: "VAT control account", hint: "Should agree to the VAT return: owed to HMRC (credit) or due back (debit)." };
  if (/wages control|payroll control|net wages|paye|national insurance|pension/.test(n))
    return { label: "Payroll control account", hint: "Agree to the payroll reports: PAYE, NI, pensions and net pay still to pay." };
  if (/control/.test(n)) return { label: "Control account", hint: "The total of a ledger kept elsewhere. Agree it to that ledger." };
  return undefined;
}
