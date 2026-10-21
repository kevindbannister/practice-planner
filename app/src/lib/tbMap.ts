// Mapping a trial balance: each account in the software's trial balance is given an IRIS Elements
// code and a place in the working papers (which schedule it belongs to). Suggestions come from, in
// order: the same account code last year for this company, the same account name at another
// company, the IRIS chart (when loaded), and the account's name and type. Once mapped, balances go
// into the list schedules as lines, and the other schedules (registers, accounts, expenses, VAT)
// show the trial balance figure beside their own as a check.
import { Line, SECTIONS, TbRow, finalTb, linesFor, priorPeriod, readSetup, setupOf } from "./papers";
import { Row } from "./schema";

export type Dest = { key: string; label: string; section: string; sub: string; part?: "cost" | "dep" | "after"; side: "dr" | "cr"; post: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every place a trial balance account can go. */
export const DESTS: Dest[] = (() => {
  const out: Dest[] = [];
  const crSections = new Set(["creditors", "loans", "capital", "income", "provisions"]);
  for (const s of SECTIONS) {
    for (const sb of s.subs) {
      const side: "dr" | "cr" = sb.normal || (crSections.has(s.key) ? "cr" : "dr");
      if (sb.kind === "register") {
        out.push({ key: `${s.key}/${sb.key}#cost`, label: `${s.title} › ${sb.title} (cost)`, section: s.key, sub: sb.key, part: "cost", side: "dr", post: false });
        out.push({ key: `${s.key}/${sb.key}#dep`, label: `${s.title} › ${sb.title} (depreciation)`, section: s.key, sub: sb.key, part: "dep", side: "cr", post: false });
      } else if (sb.split) {
        out.push({ key: `${s.key}/${sb.key}`, label: `${s.title} › ${sb.title} (due within one year)`, section: s.key, sub: sb.key, side, post: false });
        out.push({ key: `${s.key}/${sb.key}#after`, label: `${s.title} › ${sb.title} (due after one year)`, section: s.key, sub: sb.key, part: "after", side, post: false });
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

/** Rules that hold whatever the account type says (IRIS account names read well through these). */
function nameRule(n: string, credit: boolean): string | undefined {
  if (/(profit|loss|gain) (and |or )?(loss )?on (the )?(sale|disposal)|profit loss on sale|loss on disposal|profit on disposal/.test(n)) return credit ? "income/other" : "expenditure/tb";
  if (/^interest on (paye|vat|corporation tax|late)|^(late payment|hmrc) interest|interest (paid|payable|charged)\b/.test(n) && !credit) return "expenditure/tb";
  if (/accrued expense|^accruals?\b/.test(n)) return "creditors/accruals";
  if (/dividend/.test(n)) return "capital/dividends";
  if (/amts owed by to group|amounts owed (by|to) group|group undertak|intercompany|inter company/.test(n)) return credit ? "creditors/other" : "debtors/group";
  if (/directors? curr|directors? current|directors? loan/.test(n)) return "creditors/dla";
  if (/credit card/.test(n)) return "creditors/card";
  if (/suspense/.test(n)) return "creditors/other";
  if (/deferred tax timing|deferred taxation provision|provision for deferred/.test(n)) return "provisions/deferred";
  if (/^deferred tax$/.test(n)) return "taxation/deferred";
  if (/corporation tax p and l|corporation tax charge|prior year adjustment tax|^tax on profit|tax charge/.test(n)) return "taxation/current";
  const after = /more than (one|1)|after (one|1)|1 2 years|2 5 years|over (one|1)|greater than 1|long term|less than more year/.test(n);
  if (/hire purchase|^hp\b|\bhp gross|finance lease/.test(n) && !/interest|charges?$/.test(n)) return after ? "creditors/hp#after" : "creditors/hp";
  if (/bank loans?|^loans?\b|bounce back|cbils|mortgage/.test(n) && !/interest|to |receivable/.test(n)) return after ? "creditors/loan#after" : "creditors/loan";
  if (/unlisted investment|other investments|listed investment|\binvestments?\b/.test(n) && !/income|interest|property/.test(n)) return "investments/main";
  if (/^opening stock|^closing stock|^purchases|materials purchased|sub ?contractors?|direct (wages|labour|costs)/.test(n)) return "expenditure/cos";
  if (/^depn of|^depreciation$|depreciation \(3/.test(n)) return "expenditure/tb";
  if (/other revenue|other operating income|miscellaneous income|sundry income/.test(n)) return "income/other";
  return undefined;
}

/** The fixed asset class an account name points to, if any. */
function fixedClass(n: string): string | undefined {
  if (/goodwill/.test(n)) return "goodwill/goodwill";
  if (/intangible|patent|trademark|software development/.test(n)) return "goodwill/intangible";
  if (/motor|vehicle|van\b|car\b|cars\b/.test(n) && !/expense|running|fuel|insurance|repair|licen|lease|hire/.test(n)) return "fixed/motor";
  if (/fixture|fitting|furniture/.test(n)) return "fixed/fixtures";
  if (/computer|it equipment|laptop/.test(n) && !/software subscription|costs?$|support|consultancy|expenses?/.test(n)) return "fixed/computer";
  if (/plant|machin|equipment|tools/.test(n) && !/hire|maintenance|rental/.test(n)) return "fixed/plant";
  if (/freehold|leasehold|land|building|property/.test(n) && !/rent|repair|rates|insurance|development|loan|income/.test(n)) return "fixed/freehold";
  return undefined;
}

/** The likely place for an account from its name, type and balance (debit or credit). */
export function guessDest(name: string, type: string, balance: number): string {
  const n = norm(name), ty = norm(type);
  const credit = balance < 0;
  const ruled = nameRule(n, credit);
  if (ruled) return ruled;
  const isPl = /revenue|income|sales|expense|overhead|direct cost|cost of sales|depreciation|other income/.test(ty);
  const dep = /depreciation|amortisation|amortization|accumulated|depn|charge for (the )?year|eliminated on disposal/.test(n);
  const liability = /liabilit|equity/.test(ty) || /hire purchase|\bhp\b|loan|finance lease|creditor/.test(n);
  const cls = fixedClass(n);
  if (cls && (!isPl || /fixed|non current asset/.test(ty)) && !liability) return `${cls}#${dep ? "dep" : "cost"}`;
  if (!isPl) {
    if (/debtors? control|trade debtors|accounts receivable|^debtors$/.test(n)) return "debtors/trade";
    if (/prepay/.test(n)) return "debtors/prepayments";
    if (/accrued income/.test(n)) return "debtors/accrued";
    if (/creditors? control|trade creditors|accounts payable|^creditors$/.test(n)) return "creditors/trade";
    if (/corporation tax|\bct\b|^tax$/.test(n)) return "creditors/tax";
    if (/vat|paye|national insurance|\bni\b|pension|hmrc|social security|wages control|net wages/.test(n)) return "creditors/ssot";
    if (/share capital|ordinary share|called up/.test(n)) return "capital/shares";
    if (/profit and loss|retained|reserve|p and l/.test(n)) return "capital/reserves";
    if (/petty cash|cash in hand|^cash$|till/.test(n)) return "bank/cash";
    if (/deposit account|saver|savings|reserve account/.test(n)) return "bank/deposit";
    if (/\beur\b|euro/.test(n)) return "bank/eur";
    if (/\busd\b|dollar/.test(n)) return "bank/usd";
    if (/bank|current account|barclays|lloyds|natwest|hsbc|santander|monzo|starling|tide|metro|revolut|wise/.test(n) && !/charges?|interest|fees?/.test(n)) return "bank/current";
    if (/work in progress|\bwip\b/.test(n)) return "stock/wip";
    if (/stock|inventory/.test(n)) return "stock/stock";
    if (/loan/.test(n)) return credit ? "creditors/other" : "debtors/other";
    if (/retention|cis|deposit/.test(n) && !credit) return "debtors/other";
    if (/equity|capital/.test(ty)) return "capital/reserves";
    if (/liabilit/.test(ty) && /non current|long term/.test(ty)) return "loans/main";
    if (/liabilit/.test(ty)) return "creditors/other";
    if (/asset/.test(ty)) return credit ? "creditors/other" : "debtors/other";
  }
  if (/cost of sales|cost of goods|purchases|direct cost|materials|subcontract/.test(n) || /direct cost|cost of sales/.test(ty)) return credit && /discount/.test(n) ? "income/other" : "expenditure/cos";
  if (/interest/.test(n) && (credit || /income|revenue/.test(ty)) && !/paye|corporation|paid|payable|loan|hp|hire/.test(n)) return "income/interest";
  if (/revenue|income|sales/.test(ty) || /sales|turnover|fees? (income|received)|revenue|commissions? received/.test(n)) return /other|grant|sundry|rent received|commission/.test(n) ? "income/other" : "income/sales";
  if (/accountancy|accounting fees/.test(n)) return "expenditure/accountancy";
  // with no type, anything else is most likely a profit and loss account: an expense if a debit
  if (isPl || !type) return credit ? "income/other" : "expenditure/tb";
  return credit ? "creditors/other" : "debtors/other";
}

/**
 * Where an IRIS Accounts Production code goes, from the IRIS numbering: profit and loss below 500
 * (turnover, cost of sales, overheads, interest, tax, dividends), then fixed assets, current assets,
 * creditors, provisions and capital. A "/21" or higher sub-code on a fixed asset is depreciation.
 */
export function irisRangeDest(code: string, acctName: string, balance: number): string | undefined {
  const m = /^(\d{1,4})(?:\/(\d+))?/.exec(code.trim());
  if (!m) return undefined;
  const c = Number(m[1]), subCode = m[2] === undefined ? undefined : Number(m[2]);
  const n = norm(acctName), credit = balance < 0;
  const part = subCode !== undefined && subCode >= 20 ? "dep" : "cost";
  if (c < 18) return "income/sales";
  if (c < 100) return "expenditure/cos";
  if (c >= 120 && c < 140) return "income/interest";
  if (c < 200) return "income/other";
  if (c === 285 || c === 286) return "expenditure/accountancy";
  if (c < 440) return "expenditure/tb";
  if (c < 450) return "taxation/current";
  if (c < 460) return "taxation/deferred";
  if (c < 500) return "capital/dividends";
  if (c < 510) return `goodwill/${c < 505 ? "goodwill" : "intangible"}#${part}`;
  if (c < 520) return `fixed/freehold#${part}`;
  if (c === 524) return `fixed/fixtures#${part}`;
  if (c === 525) return `fixed/motor#${part}`;
  if (c === 526) return `fixed/computer#${part}`;
  if (c < 530) return `fixed/plant#${part}`;
  if (c < 569) return "investments/main";
  if (c < 570) return "stock/stock";
  if (c < 580) return "stock/wip";
  if (c < 590) return "debtors/trade";
  if (c < 610) return "debtors/other";
  if (c < 620) return /accrued income/.test(n) ? "debtors/accrued" : "debtors/prepayments";
  if (c < 690) return "debtors/other";
  if (c < 700) return /cash|petty|till/.test(n) ? "bank/cash" : /deposit|saver|savings/.test(n) ? "bank/deposit" : "bank/current";
  if (c < 710) return "creditors/loan";
  if (c < 720) return credit ? "creditors/other" : "debtors/group";
  if (c < 730) return "creditors/dla";
  if (c < 737) return "creditors/ssot";
  if (c < 740) return "creditors/trade";
  if (c < 750) return "creditors/tax";
  if (c < 770) return "creditors/ssot";
  if (c < 780) return "creditors/card";
  if (c < 800) return "creditors/accruals";
  if (c < 900) return "creditors/other";
  if (c < 930) return /more than|after|over|1 2 years|2 5 years/.test(n) ? "creditors/hp#after" : "creditors/hp";
  if (c < 950) return "provisions/deferred";
  if (c < 960) return "loans/main";
  if (c < 968) return "capital/shares";
  return "capital/reserves";
}

/**
 * IRIS codes and names seen in Kevin's papers, used until his own IRIS chart is loaded. Names are as
 * IRIS shortens them. Codes with "*1" are the first director's.
 */
export const IRIS_BUILT_IN: ChartRow[] = ([
  ["512/1", "Freehold prop Cost/valuation b"], ["512/3", "Freehold prop Disposals"],
  ["523/1", "Plant & machin Cost/valuation"], ["523/21", "Plant & machin Depreciation b/"], ["523/22", "Plant & machin Charge for year"],
  ["524/1", "Fixtures & fittings Cost/valua"], ["524/2", "Fixtures & fittings Additions"], ["524/21", "Fixtures & fittings Depreciati"], ["524/22", "Fixtures & fittings Charge for the year"],
  ["525/1", "Motor vehicles Cost/valuation"], ["525/2", "Motor vehicles Additions"], ["525/21", "Motor vehicles Depreciation b/"], ["525/22", "Motor vehicles Charge for year"],
  ["526/1", "Computer equipmt Cost/valuatio"], ["526/2", "Computer equipmt Additions"], ["526/21", "Computer equipmt Depreciation"], ["526/22", "Computer equipmt Charge for year"],
  ["569", "Stocks"], ["586", "Trade Debtors"], ["594", "Other Debtors"], ["614", "Prepayments"], ["692", "Bank account no. 1"], ["693", "Bank account no. 2"],
  ["715/1", "Amts owed by/to group undertak"], ["727/1*1", "Directors' curr accs less 1yr - Balance brought forward"],
  ["727/2*1", "Directors' curr accs less 1yr - Capital introduced"], ["727/21*1", "Directors' curr accs less 1yr - Drawings"],
  ["735", "VAT"], ["737", "Trade creditors"], ["747", "Tax"], ["755", "Social security and other tax"], ["756", "Net wages"], ["768", "Pension payable"],
  ["770", "Credit card"], ["786", "Accrued expenses"], ["909", "HP - gross - less than 1 yr"], ["931/1", "Deferred tax timing difference - Accelerated capital allowances"],
  ["966/1", "Called up share capital - Share capital 1"], ["968/1", "Profit and loss account - Brought forward"],
  ["1", "Sales"], ["18", "Opening stock"], ["27", "Purchases"], ["53", "Sub contractors"], ["74", "Closing stock"], ["130", "Deposit account interest"],
  ["227", "Other operating leases - rent"], ["230", "Rates and water"], ["232", "Insurance"], ["233", "Light and heat"], ["234", "Repairs to Property"],
  ["254/1*1", "Directors' remuneration"], ["254/5*1", "Directors' social security"], ["254/8*1", "Directors' pensions paid"],
  ["255", "Wages"], ["256", "Social security"], ["257", "Pensions"], ["260", "Hire of plant and machinery"], ["263", "Telephone"], ["264", "Post and stationery"],
  ["265", "Advertising"], ["267", "Motor and travel expenses"], ["272", "Repairs and renewals"], ["274", "Household and cleaning"], ["275", "Protective clothing"],
  ["279", "Computer costs"], ["280", "Sundry expenses"], ["285", "Accountancy"], ["288", "Commission"], ["290", "Legal and professional fees"], ["321", "Entertainment"],
  ["325", "Staff welfare and training"], ["378", "Bank Charges"], ["390/12", "Depn of plant & machinery"], ["390/13", "Depn of fixtures & fittings"],
  ["390/14", "Depn of motor vehicles"], ["390/15", "Depn of computer equipment"], ["392/1", "Profit/loss on sale tang f a"], ["414", "Bank loan interest"],
  ["416", "Interest on corporation tax"], ["426", "Hire purchase"], ["442", "Tax"], ["450", "Deferred tax"], ["471/1", "Dividends - interim"],
] as [string, string][]).map(([code, name]) => ({ code, name }));

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

/** Where an IRIS code's balances go: as set on the chart, else from the IRIS numbering, else from its name. */
export const chartDest = (c: ChartRow, balance: number, acctName = "") => c.dest || irisRangeDest(c.code, `${c.name} ${acctName}`, balance) || guessDest(c.name, "", balance);

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
    const sc = hit / Math.max(cw.length, words.size);
    if (hit && sc > score) { best = c; score = sc; }
  }
  return score >= 0.5 ? best : undefined;
}

const looksLikeCode = (x: string) => /^\d{1,4}(\/\d+)?(\*\d+)?$/.test(x.trim());
const plHint = (name: string) => /p ?(and|&) ?l\b|charge|prior year|expense|paid|payable on profit/.test(norm(name));

/**
 * The IRIS code for an account from the IRIS column of the trial balance: a code as it is; a name
 * looked up on the chart (exactly, or the chart's shortened name at the start of it). Where IRIS uses
 * one name for two codes (Tax: the liability and the charge), the account's name decides.
 */
export function irisOf(raw: string, acctName: string, chart: ChartRow[]): { code: string; name: string } {
  const t = raw.trim();
  if (!t) return { code: "", name: "" };
  if (looksLikeCode(t)) return { code: t, name: chart.find((c) => c.code === t)?.name || "" };
  const n = norm(t);
  let hits = chart.filter((c) => norm(c.name) === n);
  if (!hits.length) {
    const starts = chart.filter((c) => norm(c.name).length >= 3 && n.startsWith(norm(c.name)));
    const longest = Math.max(0, ...starts.map((c) => norm(c.name).length));
    hits = starts.filter((c) => norm(c.name).length === longest);
  }
  if (hits.length > 1) {
    const pl = plHint(acctName);
    hits = hits.filter((c) => (Number(c.code.split("/")[0]) < 500) === pl).concat(hits).slice(0, 1);
  }
  return { code: hits[0]?.code || "", name: t };
}

// ------------------------------------------------------------------ suggestions for a whole trial balance

export type Mapping = {
  acct: TbRow; balance: number; swBalance: number; jBalance: number;
  iris: string; irisName: string; dest: string; saved: boolean; why: string;
};
export type SavedMap = Record<string, { iris?: string; dest?: string }>;

/** The mapping saved for a paper: on the trial balance's settings (by account), and on older trial balance lines. */
export function savedMaps(papers: Row[], clientKey: string, period: string): SavedMap {
  const m = setupOf(papers, clientKey, period, "tb/main").maps;
  return m && typeof m === "object" ? (m as SavedMap) : {};
}

const savedFor = (r: TbRow, maps: SavedMap): { iris?: string; dest?: string } | undefined => {
  const s = maps[r.key];
  if (s?.dest) return s;
  const l = r.lines.find((x) => x.f.dest);
  return l ? { iris: String(l.f.iris || "") || undefined, dest: String(l.f.dest) } : s;
};

/** The final trial balance of a paper: the software's trial balance with every set of journals through it. */
export function paperAccounts(lines: Row[], clientKey: string, period: string): TbRow[] {
  const tb = linesFor(lines, clientKey, period, "tb", "main");
  const subs = [...new Set(lines.filter((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.SectionKey === "journals").map((r) => String(r.SubKey || "main")))];
  const journals = subs.flatMap((k) => linesFor(lines, clientKey, period, "journals", k));
  return finalTb(tb, journals);
}

/**
 * What each account of the final trial balance maps to: what's saved, else a suggestion. Suggestions come
 * from last year's choice for the same account, the IRIS code or name on the trial balance, the same account
 * name at another company, then the account's name and type.
 */
export function mapTb(rows: TbRow[], all: { lines: Row[]; papers: Row[] }, clientKey: string, period: string, chart: ChartRow[]): Mapping[] {
  const maps = savedMaps(all.papers, clientKey, period);
  // last year: the same account (code and name), else the same name, else a code only one account has
  const prior = priorPeriod(period);
  const priorMaps = savedMaps(all.papers, clientKey, prior);
  const priorRows = paperAccounts(all.lines, clientKey, prior);
  const lastBy = new Map<string, { iris?: string; dest?: string }>(), lastName = new Map<string, { iris?: string; dest?: string }>(), lastCode = new Map<string, { iris?: string; dest?: string }[]>();
  for (const r of priorRows) {
    const sv = savedFor(r, priorMaps);
    if (!sv?.dest) continue;
    lastBy.set(r.key, sv);
    lastName.set(norm(r.account), sv);
    if (r.code) lastCode.set(r.code.toLowerCase(), [...(lastCode.get(r.code.toLowerCase()) || []), sv]);
  }
  // the same account name mapped at another company (most recent first)
  const byName = new Map<string, { iris?: string; dest?: string }>();
  const others = all.papers.filter((p) => p.ItemKey === "tb/main" && !(p.ClientKey === clientKey)).sort((a, b) => String(b.PeriodEnd).localeCompare(String(a.PeriodEnd)));
  for (const p of others) {
    const m = readSetup(p).maps as SavedMap | undefined;
    for (const [k, v] of Object.entries(m || {})) {
      const nm = norm(k.split("|").slice(1).join("|"));
      if (nm && v?.dest && !byName.has(nm)) byName.set(nm, v);
    }
  }
  for (const r of [...all.lines].reverse()) {
    if (r.SectionKey !== "tb" || r.ClientKey === clientKey) continue;
    const l = linesFor([r], String(r.ClientKey), String(r.PeriodEnd), "tb", String(r.SubKey || "main"))[0];
    const k = norm(l?.Detail || "");
    if (k && l.f.dest && !byName.has(k)) byName.set(k, { iris: String(l.f.iris || "") || undefined, dest: String(l.f.dest) });
  }
  const chartByCode = new Map(chart.map((c) => [c.code, c]));
  return rows.map((acct) => {
    const balance = round2(acct.dr - acct.cr), swBalance = round2(acct.tbDr - acct.tbCr), jBalance = round2(acct.jDr - acct.jCr);
    const fromTb = irisOf(acct.iris, acct.account, chart);
    const base = { acct, balance, swBalance, jBalance };
    const sv = savedFor(acct, maps);
    const iris = sv?.iris || fromTb.code;
    const irisName = (iris && chartByCode.get(iris)?.name) || fromTb.name;
    if (sv?.dest) return { ...base, iris, irisName, dest: sv.dest, saved: true, why: "" };
    const coded = acct.code ? lastCode.get(acct.code.toLowerCase()) : undefined;
    const last = lastBy.get(acct.key) || lastName.get(norm(acct.account)) || (coded?.length === 1 ? coded[0] : undefined);
    if (last?.dest) return { ...base, iris: iris || last.iris || "", irisName, dest: last.dest, saved: false, why: "As last year" };
    if (iris) {
      const c = chartByCode.get(iris);
      const dest = c?.dest || irisRangeDest(iris, `${irisName} ${acct.account}`, balance || swBalance);
      if (dest) return { ...base, iris, irisName, dest, saved: false, why: `IRIS ${iris}${irisName ? ` ${irisName}` : ""}` };
    }
    if (fromTb.name) return { ...base, iris, irisName, dest: guessDest(fromTb.name, "", balance || swBalance), saved: false, why: `IRIS: ${fromTb.name}` };
    const other = byName.get(norm(acct.account));
    if (other?.dest) return { ...base, iris: other.iris || "", irisName: (other.iris && chartByCode.get(other.iris)?.name) || "", dest: other.dest, saved: false, why: "As at another company" };
    const ic = chart.length ? guessIris(acct.account, chart) : undefined;
    if (ic) return { ...base, iris: ic.code, irisName: ic.name, dest: chartDest(ic, balance || swBalance, acct.account), saved: false, why: `IRIS ${ic.code} ${ic.name} (from the name)` };
    return { ...base, iris: "", irisName: "", dest: guessDest(acct.account, acct.type, balance || swBalance), saved: false, why: "From the name" };
  });
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
  if ((/vat/.test(n) && /control|liability|account/.test(n)) || (/\bvat\b/.test(n) && dest === "creditors/ssot"))
    return { label: "VAT control account", hint: "Should agree to the VAT return: owed to HMRC (credit) or due back (debit)." };
  if (/wages control|payroll control|net wages|paye|p a y e|national insurance|pension fund|pension payable/.test(n))
    return { label: "Payroll control account", hint: "Agree to the payroll reports: PAYE, NI, pensions and net pay still to pay." };
  if (/control/.test(n)) return { label: "Control account", hint: "The total of a ledger kept elsewhere. Agree it to that ledger." };
  return undefined;
}

// ------------------------------------------------------------------ the accounts in summary

export type AccountsFigures = {
  turnover: number; costOfSales: number; grossProfit: number; otherIncome: number; expenses: number; pbt: number; tax: number; pat: number; dividends: number; retained: number;
  fixed: number; investments: number; stock: number; debtors: number; bank: number; creditorsWithin: number; netCurrent: number; creditorsAfter: number; provisions: number; netAssets: number;
  shares: number; reservesBf: number; capitalAccounts: number; reservesCf: number; capitalAndReserves: number; leftOut: number; difference: number;
};

const KNOWN = new Set(["income", "expenditure", "taxation", "goodwill", "fixed", "investments", "stock", "debtors", "debtors-ca", "bank", "creditors", "vat", "wages", "creditors-ca", "loans", "provisions", "capital"]);

/** The profit and loss account and balance sheet from the mapped final trial balance. */
export function accountsFigures(maps: Mapping[]): AccountsFigures {
  const by = new Map<string, number>();
  let leftOut = 0;
  for (const m of maps) {
    const d = DEST_BY_KEY.get(m.dest);
    if (!d || d.key === "ignore" || !KNOWN.has(d.section)) { leftOut = round2(leftOut + m.balance); continue; }
    // every figure as a debit (+) or credit (−) so the sections add up the same way
    by.set(d.key, round2((by.get(d.key) || 0) + m.balance));
  }
  const sumWhere = (f: (k: string) => boolean) => round2([...by.entries()].filter(([k]) => f(k)).reduce((a, [, n]) => a + n, 0));
  const sec = (s: string) => sumWhere((k) => k.startsWith(`${s}/`));
  const turnover = -(by.get("income/sales") || 0), otherIncome = -round2((by.get("income/interest") || 0) + (by.get("income/other") || 0) + sumWhere((k) => k.startsWith("income/") && !["income/sales", "income/interest", "income/other"].includes(k)));
  const costOfSales = by.get("expenditure/cos") || 0, expenses = round2(sec("expenditure") - costOfSales);
  const grossProfit = round2(turnover - costOfSales), pbt = round2(grossProfit + otherIncome - expenses);
  const tax = sec("taxation"), pat = round2(pbt - tax), dividends = by.get("capital/dividends") || 0, retained = round2(pat - dividends);
  const fixed = round2(sec("goodwill") + sec("fixed")), investments = sec("investments"), stock = sec("stock"), debtors = sec("debtors"), bank = sec("bank");
  const creditorsWithin = -round2(sumWhere((k) => k.startsWith("creditors/") && !k.endsWith("#after")) + sec("vat") + sec("wages") + sec("creditors-ca"));
  const creditorsAfter = -round2(sumWhere((k) => k.startsWith("creditors/") && k.endsWith("#after")) + sec("loans"));
  const provisions = -sec("provisions");
  const netCurrent = round2(stock + debtors + bank - creditorsWithin);
  const netAssets = round2(fixed + investments + netCurrent - creditorsAfter - provisions);
  const shares = -(by.get("capital/shares") || 0), reservesBf = -(by.get("capital/reserves") || 0), capitalAccounts = -(by.get("capital/accounts") || 0);
  const reservesCf = round2(reservesBf + retained);
  const capitalAndReserves = round2(shares + reservesCf + capitalAccounts);
  return {
    turnover: round2(turnover), costOfSales, grossProfit, otherIncome: round2(otherIncome), expenses, pbt, tax, pat, dividends, retained,
    fixed, investments, stock, debtors, bank, creditorsWithin: round2(creditorsWithin), netCurrent, creditorsAfter, provisions: round2(provisions), netAssets,
    shares: round2(shares), reservesBf: round2(reservesBf), capitalAccounts: round2(capitalAccounts), reservesCf, capitalAndReserves, leftOut, difference: round2(netAssets - capitalAndReserves),
  };
}
