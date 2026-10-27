// The engagement letter is a list of sections. Each is rich text (HTML, with bold, underline, lists and headings) that the practice
// edits in Settings, with merge fields written in square brackets, like [Name]. Three of them stand for something the planner
// builds rather than a word: [Services], [FeesTable] and [Signature]. The letter then carries a schedule of services, which is
// each agreed service's own schedule text (edited next to the service in Services settings).
import { Block, DocContent, Run, parseHtml, runsText, tidyRuns } from "./docModel";
import { ClientType } from "./proposals";
import { DEFAULT_SECTION_HTML } from "./letterDefaults";

/** In the order they appear in the letter. The last two surround the schedules. */
export const SECTIONS = [
  ["address", "Addressee and greeting"], ["intro", "Introduction"], ["actingFor", "Who we are acting for"], ["nominated", "Nominated persons"], ["period", "Period of engagement"],
  ["scope", "Scope of services"], ["fees", "Fees"], ["guarantee", "Personal guarantee of fees"], ["liability", "Limitation of liability"], ["aml", "Anti money laundering"],
  ["clientMoney", "Client monies"], ["dataProtection", "Data protection"], ["secure", "Secure communications"], ["otherServices", "Other services"], ["agreement", "Your agreement"],
  ["acceptance", "Acceptance"], ["acceptanceCompany", "Acceptance and personal guarantee"], ["signature", "Signature"],
  ["scheduleIntro", "Schedule of services: opening"], ["scheduleEnd", "Schedule of services: closing"],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];
export type Sections = Record<SectionKey, string>;
export const SECTION_KEYS: SectionKey[] = SECTIONS.map(([k]) => k);
/** The part of the letter before the schedules. */
export const LETTER_KEYS: SectionKey[] = SECTION_KEYS.filter((k) => k !== "scheduleIntro" && k !== "scheduleEnd");

export const DEFAULT_SECTIONS: Sections = Object.fromEntries(SECTIONS.map(([k]) => [k, DEFAULT_SECTION_HTML[k] ?? ""])) as Sections;

/** Which client types a section is for, unless the practice says otherwise. A section not listed is for everyone. */
export const DEFAULT_INCLUDE: Partial<Record<SectionKey, ClientType[]>> = {
  guarantee: ["limited"], acceptanceCompany: ["limited"], acceptance: ["individual", "partnership", "llp"],
};
export type Include = Partial<Record<SectionKey, ClientType[]>>;
export const includedFor = (include: Include, key: SectionKey, type: ClientType): boolean => (include[key] ?? DEFAULT_INCLUDE[key] ?? null)?.includes(type) ?? true;

/** Merge fields that become text. [Services], [FeesTable] and [Signature] are listed separately. */
export const MERGE_FIELDS: [string, string][] = [
  ["FirmName", "The practice's name"], ["Name", "The client's name"], ["TradingAddress", "The client's address (trading, else registered, else home)"], ["RegisteredOffice", "The registered office"],
  ["CompanyNumber", "The company number"], ["PrimaryContact", "The main contact's full name"], ["PrimaryContactFirstName", "The main contact's first name"], ["PrimaryOfficer", "The partner responsible for the client"],
  ["Manager", "The manager responsible for the client"], ["StartDate", "The date the engagement starts"], ["CurrentDate", "The date of the letter"], ["CurrentDateAndTime", "The date and time the letter was made"],
  ["ReviewDate", "The date the engagement is reviewed"], ["ReviewYears", "The review interval in years"], ["Reference", "The letter's reference"],
];
export const BLOCK_FIELDS: [string, string][] = [["Services", "A list of the services agreed"], ["FeesTable", "The table of agreed fees and the totals"], ["Signature", "The signature table"]];

/** Stored text is HTML. Plain text saved before sections were rich text becomes paragraphs. */
export function asHtml(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  if (/<\/?[a-z][^>]*>/i.test(s)) return s;
  return s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`).join("");
}
/** Whether the HTML has any words in it. */
export const hasText = (html: string) => parseHtml(asHtml(html)).blocks.some((b) => (b.type === "p" || b.type === "h" ? runsText(b.runs).trim() : b.type === "list" ? b.items.some((i) => runsText(i).trim()) : b.type === "table"));

const TOKEN = /\[([A-Za-z]+)\]/g;
const plain = (runs: Run[], vars: Map<string, string>): Run[] => tidyRuns(runs.map((r) => ({ ...r, t: r.t.replace(TOKEN, (m, k: string) => (vars.has(k.toLowerCase()) ? vars.get(k.toLowerCase())! : m)) })));

/**
 * Section HTML as document blocks: merge fields filled in, and a paragraph holding [Services], [FeesTable] or [Signature]
 * replaced by what the planner builds. Anything else in square brackets is left exactly as written.
 */
export function expandBlocks(html: string, vars: Record<string, string>, blocks: Record<string, () => Block[]>): Block[] {
  const v = new Map(Object.entries(vars).map(([k, x]) => [k.toLowerCase(), x]));
  const want = new Map(Object.keys(blocks).map((k) => [k.toLowerCase(), k]));
  const out: Block[] = [];
  for (const b of parseHtml(asHtml(html)).blocks) {
    if (b.type === "p") {
      const text = runsText(b.runs);
      const m = [...text.matchAll(TOKEN)].find((x) => want.has(x[1].toLowerCase()));
      if (m) {
        const before = text.slice(0, m.index).trim(), after = text.slice((m.index ?? 0) + m[0].length).trim();
        const mark = b.runs[0] ? { ...b.runs[0], t: "" } : { t: "" };
        if (before) out.push({ type: "p", runs: plain([{ ...mark, t: before }], v) });
        out.push(...blocks[want.get(m[1].toLowerCase())!]());
        if (after) out.push({ type: "p", runs: plain([{ ...mark, t: after }], v) });
        continue;
      }
      out.push({ ...b, runs: plain(b.runs, v) });
    } else if (b.type === "h") out.push({ ...b, runs: plain(b.runs, v) });
    else if (b.type === "list") {
      // a bullet that is only [Services] or [FeesTable] is replaced by what the planner builds, splitting the list around it
      let items: Run[][] = [];
      const flush = () => { if (items.length) out.push({ ...b, items }); items = []; };
      for (const it of b.items) {
        const m = runsText(it).trim().match(/^\[([A-Za-z]+)\]$/);
        if (m && want.has(m[1].toLowerCase())) { flush(); out.push(...blocks[want.get(m[1].toLowerCase())!]()); } else items.push(plain(it, v));
      }
      flush();
    }
    else if (b.type === "table") out.push({ ...b, rows: b.rows.map((r) => r.map((c) => ({ ...c, runs: plain(c.runs, v) }))) });
    else out.push(b);
  }
  return out;
}
export const contentOf = (blocks: Block[]): DocContent => ({ blocks });
