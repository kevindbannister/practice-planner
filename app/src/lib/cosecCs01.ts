// The confirmation statement (CS01): a guided review that works out what the statement would say from the company's records, what still needs
// doing before it can be filed, and what must be reported separately. It prepares and checks; it does not file. Nothing here assumes the
// confirmation statement corrects the register: changes to officers, PSCs, the registered office or share capital are separate filings, and
// the statement can't be approved while any of them is still open. Pure logic.
import { sameAddress } from "./companiesHouse";
import { Entry, ownership, replay } from "./shareLedger";
import { Row } from "./schema";
import { FeeSchedule, feeFor } from "./cosecFees";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const json = <T,>(v: unknown, f: T): T => { try { const x = JSON.parse(str(v)); return x == null ? f : x; } catch { return f; } };

export type IdStatus = "" | "verified" | "pending" | "exempt";
export const ID_LABEL: Record<IdStatus, string> = { "": "Not checked", verified: "Verified", pending: "Not yet verified", exempt: "Exempt" };
export const idOf = (r: Row): IdStatus => (["verified", "pending", "exempt"].includes(str(r.IdStatus)) ? (str(r.IdStatus) as IdStatus) : "");
/** Only the status and when it was checked are kept. Personal codes and authentication codes are never recorded here. */

export type Declarations = { infoReviewed: boolean; lawfulPurpose: boolean; emailConfirmed: boolean };
export const DECLARATIONS: [keyof Declarations, string][] = [
  ["infoReviewed", "I have reviewed the company's information. It is correct, or the changes are being reported separately."],
  ["lawfulPurpose", "The company's intended future activities are lawful."],
  ["emailConfirmed", "The company's registered email address is correct and the company is content to receive official notices there."],
];
export type Cs01Payload = { madeUpTo: string; email: string; sail: string; declarations: Declarations; declaredBy: string; noPsc?: boolean };
export const blankCs01 = (madeUpTo: string, email = ""): Cs01Payload => ({ madeUpTo, email, sail: "", declarations: { infoReviewed: false, lawfulPurpose: false, emailConfirmed: false }, declaredBy: "" });

const OPEN = ["draft", "info", "approved", "submitted", "rejected"];
const isoOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); const day = t.getUTCDate(); t.setUTCMonth(t.getUTCMonth() + n); if (t.getUTCDate() !== day) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const personName = (r: Row) => [str(r.Title), str(r.First), str(r.Last)].filter(Boolean).join(" ") || str(r.CorporateName);
const slice = (v: unknown) => str(v).slice(0, 10);

export type StepState = "ok" | "attention" | "blocked";
export type Step = { id: string; title: string; state: StepState; notes: string[] };
export type Cs01Model = {
  steps: Step[]; blockers: string[]; warnings: string[];
  capital: { classes: { cls: string; issued: number; nominal: number; aggregateNominal: number }[]; total: number; totalNominal: number; currency: string };
  shareholders: { name: string; holdings: { cls: string; number: number; percent: number }[] }[];
  officers: { name: string; role: string; id: IdStatus }[]; pscs: { name: string; id: IdStatus; isDirector: boolean }[];
  linked: { key: string; ref: string; form: string; title: string; status: string }[];
  dueBy: string; nextDue: string; fee?: { amount: number; effective: string; source: string };
};
export type Cs01Input = { client: Row; payload: Cs01Payload; officers: Row[]; pscs: Row[]; ledger: Entry[]; classes: Row[]; txs: Row[]; fees: FeeSchedule; today: string; selfTx?: string };

export function buildCs01(i: Cs01Input): Cs01Model {
  const { client: c, payload: p } = i;
  const ck = str(c.Key);
  const llp = str(c.Kind) === "LLP";
  const ver = json<{ office?: string; csTo?: string; csDue?: string }>(c.CHVerified, {});
  const steps: Step[] = [];
  const blockers: string[] = [], warnings: string[] = [];
  const step = (id: string, title: string, notes: string[], block: string[] = [], warn: string[] = []) => {
    steps.push({ id, title, state: block.length ? "blocked" : warn.length ? "attention" : "ok", notes });
    blockers.push(...block); warnings.push(...warn);
  };

  // 1. made-up date
  const dateBlock: string[] = [], dateWarn: string[] = [];
  const dateNotes: string[] = [];
  if (!isoOk(p.madeUpTo)) dateBlock.push("Enter the date the statement is made up to.");
  else {
    if (p.madeUpTo > i.today) dateBlock.push("The statement can't be made up to a date in the future.");
    const last = slice(ver.csTo);
    if (last && p.madeUpTo <= last) dateBlock.push(`Companies House shows a statement already made up to ${last}. Choose a later date.`);
    if (last && p.madeUpTo > addMonths(last, 12)) dateWarn.push(`This is more than 12 months after the last statement (${last}). A statement should be made up to a date within a year of the last one.`);
    dateNotes.push(`Filing is due within 14 days of the made-up date: by ${addDays(p.madeUpTo, 14)}.`);
    if (slice(ver.csDue) && i.today > slice(ver.csDue)) dateWarn.push(`The current statement was due ${slice(ver.csDue)} and is overdue.`);
  }
  step("date", "Made-up date", dateNotes, dateBlock, dateWarn);

  // 2. company information
  const name = str(c.Title), number = str(c.CompanyNumber);
  const sic = str(c.SIC);
  const infoWarn: string[] = [];
  if (!sic) infoWarn.push("No SIC code is recorded. Check them at Companies House before filing.");
  step("company", "Company information", [`${name} (${number})`, sic ? `SIC codes held: ${sic}` : ""].filter(Boolean), !name || !number ? ["The company name or number is missing."] : [], infoWarn);

  // 3. registered office and email, SAIL
  const office = str(c.RegisteredOffice);
  const offBlock: string[] = [];
  if (!office) offBlock.push("No registered office is recorded.");
  else if (ver.office && !sameAddress(office, ver.office)) offBlock.push("The registered office on file differs from Companies House. Report it with an AD01 first (see below).");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) offBlock.push("Enter the company's registered email address.");
  step("office", "Registered office and email", [office, p.email ? `Registered email: ${p.email}` : "", p.sail ? `Single alternative inspection location: ${p.sail}` : "Registers are kept at the registered office."].filter(Boolean), offBlock);

  // 4. officers
  const dirs = i.officers.filter((o) => str(o.Status) === "current" && str(o.Role).toLowerCase() === (llp ? "member" : "director"));
  const officers = i.officers.filter((o) => str(o.Status) === "current").map((o) => ({ name: personName(o), role: str(o.Role), id: idOf(o) }));
  const offiBlock: string[] = [];
  if (!dirs.length) offiBlock.push(llp ? "No current members are recorded." : "No current directors are recorded.");
  for (const o of dirs) {
    if (str(o.Kind).toLowerCase() === "corporate") continue;
    if (idOf(o) !== "verified" && idOf(o) !== "exempt") offiBlock.push(`${personName(o)}: identity verification is ${idOf(o) === "pending" ? "not yet done" : "not recorded as done"}. As reported, Companies House will not accept a confirmation statement until every director has verified.`);
  }
  step("officers", llp ? "Members" : "Officers", officers.map((o) => `${o.name}, ${o.role}`), offiBlock);

  // 5. PSCs
  const pscRows = i.pscs.filter((x) => str(x.Status) === "current");
  const dirNames = new Set(dirs.map((o) => personName(o).toLowerCase()));
  const pscs = pscRows.map((x) => ({ name: personName(x), id: idOf(x), isDirector: dirNames.has(personName(x).toLowerCase()) }));
  const pscWarn: string[] = [];
  if (!pscs.length && !p.noPsc) pscWarn.push("No person with significant control is recorded. If there really is none, say so in the notes before approving.");
  for (const x of pscs) if (!x.isDirector && x.id === "") pscWarn.push(`${x.name}: identity verification not recorded (it does not block the statement).`);
  step("pscs", "People with significant control", pscs.map((x) => x.name), [], pscWarn);

  // 6/7. share capital and shareholders (limited companies only)
  const empty = { classes: [] as Cs01Model["capital"]["classes"], total: 0, totalNominal: 0, currency: "GBP" };
  let capital = empty;
  const shareholders: Cs01Model["shareholders"] = [];
  if (!llp) {
    const mine = i.ledger.filter((e) => e.clientKey === ck);
    const r = replay(mine, p.madeUpTo || i.today);
    const own = ownership(r.holdings);
    const nominalOf = (cls: string) => Number(i.classes.find((x) => str(x.ClientKey) === ck && str(x.Name).toLowerCase() === cls.toLowerCase())?.NominalValue) || mine.find((e) => e.cls.toLowerCase() === cls.toLowerCase() && e.nominal)?.nominal || 0;
    const classes = own.byClass.map((b) => ({ cls: b.cls, issued: b.issued, nominal: nominalOf(b.cls), aggregateNominal: Math.round(b.issued * nominalOf(b.cls) * 100) / 100 }));
    capital = { classes, total: own.issued, totalNominal: Math.round(classes.reduce((s, x) => s + x.aggregateNominal, 0) * 100) / 100, currency: str(mine.find((e) => e.currency)?.currency) || "GBP" };
    for (const h of own.holders) shareholders.push({ name: h.name, holdings: h.byClass.map((b) => ({ cls: b.cls, number: b.number, percent: b.percentOfClass })) });
    const capBlock: string[] = [], capWarn: string[] = [];
    if (!mine.some((e) => e.active)) capBlock.push("The share ledger is empty, so the statement of capital can't be produced. Add or import the shareholdings.");
    if (r.problems.length) capBlock.push(`The share ledger doesn't add up: ${r.problems[0]}`);
    if (!capBlock.length && own.issued === 0) capBlock.push("No shares are in issue at that date.");
    for (const b of classes) if (!b.nominal) capWarn.push(`${b.cls}: no nominal value is recorded, so the aggregate nominal value is unknown.`);
    step("capital", "Share capital", classes.map((b) => `${b.issued.toLocaleString("en-GB")} ${b.cls} shares at ${b.nominal || "?"} each (aggregate nominal ${b.aggregateNominal})`), capBlock, capWarn);
    step("shareholders", "Shareholders", shareholders.map((h) => `${h.name}: ${h.holdings.map((x) => `${x.number.toLocaleString("en-GB")} ${x.cls}`).join(", ")}`), shareholders.length || capBlock.length ? [] : ["No shareholders at that date."]);
  }

  // 8. changes to report separately
  const linked = i.txs.filter((t) => str(t.ClientKey) === ck && str(t.Form) !== "CS01" && str(t.Key) !== i.selfTx && OPEN.includes(str(t.Status) || "draft"))
    .map((t) => ({ key: str(t.Key), ref: str(t.Ref), form: str(t.Form), title: str(t.Title), status: str(t.Status) || "draft" }));
  step("linked", "Changes reported separately", linked.map((t) => `${t.ref} ${t.form}: ${t.title}`), linked.map((t) => `${t.ref} (${t.form}) is still open. File it, or cancel it, before the confirmation statement.`));

  // 9. declarations
  const decBlock: string[] = [];
  for (const [k, text] of DECLARATIONS) if (!p.declarations[k]) decBlock.push(`Confirm: ${text}`);
  if (!p.declaredBy.trim()) decBlock.push("Say who is making the statement.");
  step("declarations", "Declarations", DECLARATIONS.filter(([k]) => p.declarations[k]).map(([, t]) => t), decBlock);

  const fee = feeFor(i.fees, "CS01");
  return { steps, blockers, warnings, capital, shareholders, officers, pscs, linked, dueBy: isoOk(p.madeUpTo) ? addDays(p.madeUpTo, 14) : "", nextDue: isoOk(p.madeUpTo) ? addDays(addMonths(p.madeUpTo, 12), 14) : "", fee };
}

/** The draft's own payload, read safely. */
export function readCs01(tx: Row): Cs01Payload {
  const p = json<Partial<Cs01Payload>>(tx.Payload, {});
  const d = { ...blankCs01("").declarations, ...(p.declarations || {}) };
  return { madeUpTo: str(p.madeUpTo), email: str(p.email), sail: str(p.sail), declarations: d, declaredBy: str(p.declaredBy), noPsc: !!p.noPsc };
}
/** What is still missing on the draft itself (the fuller readiness check also needs the company's records). */
export function cs01Issues(tx: Row): string[] {
  const p = readCs01(tx);
  const out: string[] = [];
  if (!isoOk(p.madeUpTo)) out.push("The made-up date");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) out.push("The registered email address");
  if (!Object.values(p.declarations).every(Boolean)) out.push("All three declarations");
  if (!p.declaredBy.trim()) out.push("Who is making the statement");
  return out;
}
