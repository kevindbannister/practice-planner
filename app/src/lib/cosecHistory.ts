// What Companies House shows as filed, and how the Filings screens put it beside what is being prepared here.
//
// The Filings screens list Companies House's own filing history for each company. Those filings have no status: they are filed. The only
// things shown with a status are filings being prepared in the system (a draft, or approved and waiting to be filed). Once one of those
// is filed it shows up in Companies House's history, so the system's own copy of it is not listed a second time.
import { Row } from "./schema";
import { isOpenTx, txStatus } from "./cosec";

export type ChFiling = { id: string; date: string; form: string; what: string; category: string; paper?: boolean };

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
/** "accounts-with-accounts-type-micro-entity" -> "Accounts with accounts type micro entity". */
export const sentence = (slug: string): string => { const t = slug.replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
export const CATEGORY_LABEL: Record<string, string> = {
  accounts: "Accounts", "confirmation-statement": "Confirmation statement", address: "Registered office", officers: "Officers", "persons-with-significant-control": "People with significant control",
  capital: "Share capital", incorporation: "Incorporation", "change-of-name": "Change of name", resolution: "Resolutions", "annual-return": "Annual return", mortgage: "Charges", insolvency: "Insolvency",
  "gazette": "Gazette", "dissolution": "Dissolution", "other": "Other", "liquidation": "Liquidation", "incorporation-llp": "Incorporation",
};
export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] || sentence(c);

/**
 * Companies House's filing history as short rows, newest first. `keep` bounds how many are stored on the company's record, which has to
 * stay well inside a SharePoint text column. A row without a date or a form is dropped rather than guessed at.
 */
export function filingsFrom(list: { items?: any[] } | null | undefined, keep = 40): ChFiling[] {
  const out: ChFiling[] = [];
  for (const it of list?.items || []) {
    const date = str(it?.date).slice(0, 10), form = str(it?.type).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !form) continue;
    out.push({ id: str(it.transaction_id) || `${date}:${form}`, date, form, what: sentence(str(it.description)) || categoryLabel(str(it.category)), category: str(it.category), ...(it.paper_filed ? { paper: true } : {}) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, keep);
}

/** One line in a Filings list. Companies House's have no status; the system's own have one. */
export type FilingRow = { key: string; source: "ch" | "system"; date: string; clientKey: string; clientName: string; form: string; what: string; category: string; status?: string; ref?: string; txKey?: string; paper?: boolean };

/**
 * Everything to list: each company's Companies House filings, and the system's filings that are still being prepared (draft, approved,
 * waiting for Companies House). Closed ones are left out because Companies House's history is the record of what was filed.
 * `showClosed` brings the system's own closed ones back, for looking at what was done here.
 */
export function filingRows(txs: Row[], clients: Row[], verifiedOf: (c: Row) => { history?: ChFiling[] }, opts: { showClosed?: boolean } = {}): FilingRow[] {
  const out: FilingRow[] = [];
  const name = new Map(clients.map((c) => [str(c.Key), str(c.Title)]));
  for (const c of clients) for (const f of verifiedOf(c).history || []) out.push({ key: `ch:${str(c.Key)}:${f.id}`, source: "ch", date: f.date, clientKey: str(c.Key), clientName: str(c.Title), form: f.form, what: f.what, category: f.category, ...(f.paper ? { paper: true } : {}) });
  for (const t of txs) {
    if (!opts.showClosed && !isOpenTx(t)) continue;
    out.push({ key: `tx:${str(t.Key)}`, source: "system", date: str(t.Created).slice(0, 10), clientKey: str(t.ClientKey), clientName: name.get(str(t.ClientKey)) || "Company", form: str(t.Form), what: str(t.Title), category: "", status: txStatus(t), ref: str(t.Ref), txKey: str(t.Key) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
