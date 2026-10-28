// Share certificates. Numbers are unique per company and never reused, even for cancelled certificates. Nothing is edited or deleted:
// a certificate that is replaced or cancelled stays on record with its status and reason. A holder can't be certified for more shares
// than the ledger says they hold. Pure logic: callers store the rows returned.
import { Row } from "./schema";
import { Holding, holderId } from "./shareLedger";
import { Block, textPdf } from "./cosecDocs";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
export type CertStatus = "issued" | "cancelled" | "replaced";
export type Cert = { key: string; clientKey: string; number: string; holder: string; holderKey: string; cls: string; shares: number; issuedOn: string; status: CertStatus; replaces: string; txKey: string; reason: string; created: string };
export const CERT_LABEL: Record<CertStatus, string> = { issued: "In force", cancelled: "Cancelled", replaced: "Replaced" };

export const readCert = (r: Row): Cert => ({ key: str(r.Key), clientKey: str(r.ClientKey), number: str(r.Number), holder: str(r.Holder), holderKey: str(r.HolderKey), cls: str(r.Class), shares: Number(r.NumberOfShares) || 0, issuedOn: str(r.IssuedOn).slice(0, 10), status: (str(r.Status) || "issued") as CertStatus, replaces: str(r.Replaces), txKey: str(r.TxKey), reason: str(r.Reason), created: str(r.Created) });
export const certsFor = (rows: Row[], clientKey: string) => rows.filter((r) => str(r.ClientKey) === clientKey).map(readCert).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

/** The next certificate number: one more than the highest number ever used for the company, counting cancelled ones. Keeps any prefix in use. */
export function nextNumber(certs: Cert[]): string {
  let max = 0, prefix = "", width = 1;
  for (const c of certs) { const m = c.number.match(/^(.*?)(\d+)$/); if (m) { const v = Number(m[2]); if (v >= max) { max = v; prefix = m[1]; width = Math.max(width, m[2].length); } } }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

const sameHolder = (c: Cert, h: { id: string }) => holderId(c.holder, c.holderKey) === h.id;
/** Shares in force on certificates for a holder and class. */
export const certified = (certs: Cert[], holder: { id: string }, cls: string) => certs.filter((c) => c.status === "issued" && sameHolder(c, holder) && c.cls.toLowerCase() === cls.toLowerCase()).reduce((s, c) => s + c.shares, 0);

export type Gap = { holder: string; cls: string; held: number; certified: number };
/** Holders whose certificates don't match their holding: too many shares certified is a problem; too few is just shares not yet certificated. */
export function coverage(certs: Cert[], holdings: Holding[]): { over: Gap[]; uncertificated: Gap[]; orphan: Cert[] } {
  const over: Gap[] = [], un: Gap[] = [];
  for (const h of holdings.filter((x) => x.number > 0)) { const c = certified(certs, h, h.cls); const g = { holder: h.name, cls: h.cls, held: h.number, certified: c }; if (c > h.number) over.push(g); else if (c < h.number) un.push(g); }
  const ids = new Set(holdings.filter((x) => x.number > 0).map((h) => `${h.id}|${h.cls.toLowerCase()}`));
  const orphan = certs.filter((c) => c.status === "issued" && !ids.has(`${holderId(c.holder, c.holderKey)}|${c.cls.toLowerCase()}`));
  return { over, uncertificated: un, orphan };
}

export type NewCert = { holder: string; holderKey?: string; cls: string; shares: number; issuedOn: string };
const rowOf = (c: NewCert, number: string, clientKey: string, by: string, now: string, extra: { replaces?: string; txKey?: string } = {}): Row => ({ Key: `CT${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, PracticeId: "", ClientKey: clientKey, Number: number, Holder: c.holder, HolderKey: c.holderKey || "", Class: c.cls, NumberOfShares: c.shares, IssuedOn: c.issuedOn, Status: "issued", Replaces: extra.replaces || "", TxKey: extra.txKey || "", Reason: "", Created: now, CreatedBy: by });

function check(c: NewCert): string | null {
  if (!c.holder.trim()) return "Say who the certificate is for.";
  if (!c.cls.trim()) return "Choose the class of share.";
  if (!Number.isInteger(c.shares) || c.shares <= 0) return "The number of shares must be a whole number above zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.issuedOn)) return "Give the date of issue.";
  return null;
}
const holdingOf = (holdings: Holding[], c: NewCert) => holdings.find((h) => h.id === holderId(c.holder, c.holderKey) && h.cls.toLowerCase() === c.cls.toLowerCase());

export type CertWritten = { error?: string; creates: Row[]; patches: { row: Row; patch: Row }[] };
const fail = (error: string): CertWritten => ({ error, creates: [], patches: [] });

/** Issue certificates for shares not yet covered by one. Refused if the holder doesn't hold enough uncertificated shares on the ledger. */
export function issue(items: NewCert[], rows: Row[], clientKey: string, holdings: Holding[], by: string, now: string, txKey = ""): CertWritten {
  const all = certsFor(rows, clientKey); const creates: Row[] = []; const added: Cert[] = [];
  for (const c of items) {
    const p = check(c); if (p) return fail(p);
    const h = holdingOf(holdings, c); if (!h) return fail(`${c.holder} holds no ${c.cls} shares on the ledger.`);
    const cur = [...all, ...added];
    const free = h.number - certified(cur, h, c.cls);
    if (c.shares > free) return fail(`${c.holder} holds ${h.number} ${c.cls} shares and ${h.number - free} are already on certificates, so only ${free} can be certified.`);
    const number = nextNumber(cur); const row = rowOf(c, number, clientKey, by, now, { txKey });
    creates.push(row); added.push(readCert(row));
  }
  return { creates, patches: [] };
}

/** Cancel a certificate that is in force, with the reason. The number is never reused. */
export function cancel(row: Row, reason: string, now: string): CertWritten {
  const c = readCert(row);
  if (c.status !== "issued") return fail(`Certificate ${c.number} is already ${CERT_LABEL[c.status].toLowerCase()}.`);
  if (!reason.trim()) return fail("Say why the certificate is being cancelled.");
  return { creates: [], patches: [{ row, patch: { Status: "cancelled", Reason: reason.trim(), Updated: now } }] };
}

/** Replace a lost or damaged certificate: the old one is marked replaced and a new number covers the same shares. */
export function replace(row: Row, rows: Row[], reason: string, date: string, by: string, now: string): CertWritten {
  const old = readCert(row);
  if (old.status !== "issued") return fail(`Certificate ${old.number} is already ${CERT_LABEL[old.status].toLowerCase()}.`);
  if (!reason.trim()) return fail("Say why the certificate is being replaced (for example lost, damaged).");
  const number = nextNumber(certsFor(rows, old.clientKey));
  const nu = rowOf({ holder: old.holder, holderKey: old.holderKey, cls: old.cls, shares: old.shares, issuedOn: date }, number, old.clientKey, by, now, { replaces: old.number });
  return { creates: [nu], patches: [{ row, patch: { Status: "replaced", Reason: reason.trim(), Updated: now } }] };
}

/** Exchange one certificate for others (after a transfer or split): the old one is cancelled and the new ones issued, provided the result still matches the ledger. */
export function reissue(row: Row, rows: Row[], items: NewCert[], reason: string, holdings: Holding[], by: string, now: string): CertWritten {
  const old = readCert(row);
  const c = cancel(row, reason || "Exchanged for new certificate(s)", now); if (c.error) return c;
  const without = rows.map((r) => (r === row ? { ...r, Status: "cancelled" } : r));
  const i = issue(items, without, old.clientKey, holdings, by, now, old.txKey); if (i.error) return i;
  return { creates: i.creates, patches: c.patches };
}

export async function certificatePdf(company: { name: string; number: string }, c: Cert, nominal: number, currency = "GBP", rights = ""): Promise<Uint8Array> {
  const sym = currency === "GBP" ? "£" : `${currency} `;
  const b: Block[] = [
    { t: "h1", text: company.name }, { t: "small", text: `Company number ${company.number}. Incorporated in England and Wales.` }, { t: "gap" },
    { t: "h2", text: `SHARE CERTIFICATE No. ${c.number}` }, { t: "gap" },
    { t: "p", text: `This is to certify that ${c.holder} is the registered holder of ${c.shares.toLocaleString("en-GB")} ${c.cls} shares of ${sym}${nominal} each in ${company.name}, fully paid unless the company's records state otherwise, subject to the company's articles of association.` },
    ...(rights ? [{ t: "p", text: `Class rights: ${rights}` } as Block] : []),
    { t: "gap" }, { t: "p", text: `Issued on ${c.issuedOn.split("-").reverse().join("/")}.` },
    ...(c.replaces ? [{ t: "p", text: `This certificate replaces certificate No. ${c.replaces}, which is cancelled.` } as Block] : []),
    { t: "gap" }, { t: "gap" }, { t: "p", text: "Signed: ______________________  Director" }, { t: "p", text: "Signed: ______________________  Director / Secretary" }, { t: "gap" },
    { t: "small", text: "Transfers of these shares must be made in accordance with the company's articles. Keep this certificate safe: if it is lost the company may require an indemnity before issuing a replacement." },
  ];
  return textPdf([b], `${company.name} - certificate ${c.number}`);
}
