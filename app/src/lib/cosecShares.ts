// What share classes entitle holders to, and what follows from it: votes and ownership worked out from actual holdings and class rights, and a check
// of the people with significant control against them. Percentages are always derived, never typed in. Only direct holdings by individuals and
// companies are looked at here; control through another company, or by other means (appointing directors, influence), has to be judged by a person.
import { Holding, Entry, replay } from "./shareLedger";
import { Row } from "./schema";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

export type Rights = { name: string; votes: number; dividends: boolean; redeemable: boolean; restrictions: string; nominal: number; currency: string };
/** A class's rights as recorded. Unset means the ordinary position: one vote a share, and a share of dividends. */
export function readRights(r: Row): Rights {
  const v = str(r.Votes);
  return { name: str(r.Name), votes: v === "" || Number.isNaN(Number(v)) ? 1 : Math.max(0, Number(v)), dividends: str(r.Dividends).toLowerCase() !== "no", redeemable: str(r.Redeemable).toLowerCase() === "yes", restrictions: str(r.Restrictions), nominal: Number(r.NominalValue) || 0, currency: str(r.Currency) || "GBP" };
}
export function rightsMap(classes: Row[], clientKey: string): Map<string, Rights> {
  return new Map(classes.filter((c) => str(c.ClientKey) === clientKey && str(c.Status) !== "former").map((c) => [str(c.Name).toLowerCase(), readRights(c)]));
}
const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 100 : 0);

export type Owner = { id: string; name: string; key: string; shares: number; sharePercent: number; votes: number; votePercent: number; classes: { cls: string; number: number }[] };
/** Each holder's shares and votes as at a date, as percentages of what is in issue. Shares in a class with no recorded rights carry one vote each. */
export function owners(entries: Entry[], classes: Row[], clientKey: string, asOf: string): { owners: Owner[]; issued: number; votes: number; problems: string[] } {
  const rm = rightsMap(classes, clientKey);
  const r = replay(entries.filter((e) => e.clientKey === clientKey), asOf);
  const votesOf = (h: Holding) => h.number * (rm.get(h.cls.toLowerCase())?.votes ?? 1);
  const issued = r.holdings.reduce((s, h) => s + h.number, 0), votes = r.holdings.reduce((s, h) => s + votesOf(h), 0);
  const by = new Map<string, Owner>();
  for (const h of r.holdings) {
    const o = by.get(h.id) || { id: h.id, name: h.name, key: h.key, shares: 0, sharePercent: 0, votes: 0, votePercent: 0, classes: [] };
    o.shares += h.number; o.votes += votesOf(h); o.classes.push({ cls: h.cls, number: h.number }); by.set(h.id, o);
  }
  const list = [...by.values()].map((o) => ({ ...o, sharePercent: ratio(o.shares, issued), votePercent: ratio(o.votes, votes) })).sort((a, b) => b.shares - a.shares || a.name.localeCompare(b.name));
  return { owners: list, issued, votes, problems: r.problems };
}

export type Band = "" | "25-to-50" | "50-to-75" | "75-to-100";
/** Companies House's bands: more than 25% and up to 50%; more than 50% and under 75%; 75% or more. */
export const bandOf = (pct: number): Band => (pct >= 75 ? "75-to-100" : pct > 50 ? "50-to-75" : pct > 25 ? "25-to-50" : "");
export const BAND_LABEL: Record<Band, string> = { "": "Below the threshold", "25-to-50": "More than 25% and up to 50%", "50-to-75": "More than 50% and less than 75%", "75-to-100": "75% or more" };

export type PscFinding = { kind: "missing" | "band" | "no-longer"; who: string; detail: string };
const norm = (s: string) => s.toLowerCase().replace(/\b(mr|mrs|ms|miss|dr|mx)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const pscName = (r: Row) => [str(r.First), str(r.Last)].filter(Boolean).join(" ") || str(r.CorporateName);
const natureBands = (r: Row, what: "shares" | "voting-rights"): Band[] => {
  let n: string[] = [];
  try { const j = JSON.parse(str(r.Natures)); n = Array.isArray(j) ? j.map(String) : []; } catch { n = str(r.Natures) ? [str(r.Natures)] : []; }
  return n.filter((x) => x.startsWith(`ownership-of-${what === "shares" ? "shares" : "voting-rights"}-`) || x.startsWith(`${what}-`) || (what === "voting-rights" && x.startsWith("voting-rights-"))).map((x) => (x.match(/(25-to-50|50-to-75|75-to-100)/)?.[1] || "") as Band);
};

/**
 * Who the shareholdings say should be a PSC, against who is recorded. Findings are for a person to judge: this looks at direct holdings only
 * and never changes a record.
 */
export function pscCheck(own: ReturnType<typeof owners>, pscs: Row[]): { findings: PscFinding[]; thresholds: { name: string; shares: Band; votes: Band; sharePercent: number; votePercent: number }[] } {
  const findings: PscFinding[] = [];
  const current = pscs.filter((p) => str(p.Status) === "current");
  const thresholds = own.owners.map((o) => ({ name: o.name, shares: bandOf(o.sharePercent), votes: bandOf(o.votePercent), sharePercent: o.sharePercent, votePercent: o.votePercent })).filter((t) => t.shares || t.votes);
  for (const t of thresholds) {
    const rec = current.find((p) => norm(pscName(p)) === norm(t.name));
    if (!rec) { findings.push({ kind: "missing", who: t.name, detail: `Holds ${t.sharePercent}% of the shares and ${t.votePercent}% of the votes, but isn't recorded as a person with significant control.` }); continue; }
    const sb = natureBands(rec, "shares"), vb = natureBands(rec, "voting-rights");
    if (t.shares && !sb.includes(t.shares)) findings.push({ kind: "band", who: t.name, detail: `The shareholding (${t.sharePercent}%) falls in "${BAND_LABEL[t.shares]}", which isn't what the PSC record says.` });
    if (t.votes && !vb.includes(t.votes)) findings.push({ kind: "band", who: t.name, detail: `The voting rights (${t.votePercent}%) fall in "${BAND_LABEL[t.votes]}", which isn't what the PSC record says.` });
  }
  for (const p of current) {
    const claimsShares = natureBands(p, "shares").length > 0 || natureBands(p, "voting-rights").length > 0;
    if (claimsShares && !thresholds.some((t) => norm(t.name) === norm(pscName(p)))) findings.push({ kind: "no-longer", who: pscName(p), detail: "Recorded as controlling through shares or votes, but holds no more than 25% of either on the ledger. Check for indirect holdings before ending the record." });
  }
  return { findings, thresholds };
}
