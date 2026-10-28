// The company's records as printable registers, at any date. Built from the share ledger and the officer and PSC records, never typed in.
// The register of members is the one register every company must still keep; the others are the company's own records now that
// Companies House holds the official information (see the note on each register).
import { Row } from "./schema";
import { Entry, holderId, readEntry, replay } from "./shareLedger";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Register = { id: "members" | "transactions" | "directors" | "secretaries" | "members-llp" | "pscs"; title: string; required: boolean; note: string; columns: string[]; rows: string[][]; sensitive: boolean };
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const MEMBERS_NOTE = "The register of members must still be kept at the registered office or the single alternative inspection location.";
const OPTIONAL_NOTE = "Not a register the company has to keep since 18 November 2025; Companies House holds the official record. Kept here as the company's own historical record.";
const d = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s);
const monthYear = (s: string) => (/^\d{4}-\d{2}/.test(s) ? `${s.slice(5, 7)}/${s.slice(0, 4)}` : s);
const personName = (r: Row) => [str(r.Title), str(r.First), str(r.Last)].filter(Boolean).join(" ") || str(r.CorporateName);

/** Members as at a date: everyone who has held shares up to then, what they hold, when they became a member and (if so) when they stopped. */
export function membersRegister(entries: Entry[], asOf: string): Register {
  const act = entries.filter((e) => e.active && e.date <= asOf).sort((a, b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created));
  const bal = new Map<string, { name: string; total: number; entered: string; ceased: string }>();
  const move = (name: string, key: string, delta: number, date: string) => {
    const id = holderId(name, key); const cur = bal.get(id) || { name: name.trim(), total: 0, entered: "", ceased: "" };
    const was = cur.total; cur.total += delta;
    if (was <= 0 && cur.total > 0) { cur.entered = cur.entered || date; cur.ceased = ""; }
    if (was > 0 && cur.total <= 0) cur.ceased = date;
    bal.set(id, cur);
  };
  for (const e of act) {
    if (e.type === "opening" || e.type === "allotment" || e.type === "bonus") move(e.to, e.toKey, e.number, e.date);
    else if (e.type === "redemption" || e.type === "cancellation") move(e.from, e.fromKey, -e.number, e.date);
    else { move(e.from, e.fromKey, -e.number, e.date); move(e.to, e.toKey, e.number, e.date); }
  }
  const now = replay(entries, asOf).holdings;
  const rows = [...bal].map(([id, m]) => [m.name, now.filter((h) => h.id === id).map((h) => `${h.number.toLocaleString("en-GB")} ${h.cls}`).join("; ") || "None", d(m.entered), m.total > 0 ? "" : d(m.ceased)]);
  rows.sort((a, b) => (a[3] ? 1 : 0) - (b[3] ? 1 : 0) || a[0].localeCompare(b[0]));
  return { id: "members", title: "Register of members", required: true, note: MEMBERS_NOTE, columns: ["Member", "Shares held", "Became a member", "Ceased to be a member"], rows, sensitive: false };
}

const TYPE: Record<string, string> = { opening: "Opening balance", allotment: "Allotment", bonus: "Bonus issue", transfer: "Transfer", redemption: "Redemption", cancellation: "Cancellation" };
export function transactionsRegister(entries: Entry[], asOf: string): Register {
  const rows = entries.filter((e) => e.active && e.date <= asOf).sort((a, b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created))
    .map((e) => [d(e.date), TYPE[e.type] || e.type, e.cls, String(e.number), e.from, e.to, e.consideration, e.reason ? `Corrects an earlier entry: ${e.reason}` : e.notes]);
  return { id: "transactions", title: "Share transactions (allotments, transfers and other movements)", required: false, note: "A record of every movement, from the share ledger. Opening balances stand for holdings whose earlier history is not recorded.", columns: ["Date", "Entry", "Class", "Shares", "From", "To", "Consideration", "Notes"], rows, sensitive: false };
}

function officerRows(rows: Row[], roles: string[], asOf: string, sensitive: boolean) {
  const mine = rows.filter((o) => roles.includes(str(o.Role).toLowerCase()) && str(o.Status) !== "pending");
  const inForce = (o: Row) => (!str(o.AppointedOn) || str(o.AppointedOn).slice(0, 10) <= asOf);
  const ended = (o: Row) => !!str(o.ResignedOn) && str(o.ResignedOn).slice(0, 10) <= asOf;
  const list = mine.filter(inForce);
  list.sort((a, b) => (ended(a) ? 1 : 0) - (ended(b) ? 1 : 0) || str(a.AppointedOn).localeCompare(str(b.AppointedOn)));
  return list.map((o) => [personName(o), str(o.Role), str(o.AppointedOn) ? d(str(o.AppointedOn).slice(0, 10)) : "Not recorded", ended(o) ? d(str(o.ResignedOn).slice(0, 10)) : "", sensitive ? str(o.DOB) : monthYear(str(o.DOB)), str(o.Nationality), str(o.CountryOfResidence), str(o.ServiceAddress), ...(sensitive ? [str(o.ResidentialAddress)] : [])]);
}
const OFF_COLS = ["Name", "Role", "Appointed", "Ended", "Born", "Nationality", "Country of residence", "Service address"];
export function officersRegister(officers: Row[], asOf: string, sensitive: boolean, llp = false): Register[] {
  const cols = sensitive ? [...OFF_COLS.slice(0, 4), "Date of birth", ...OFF_COLS.slice(5), "Residential address"] : OFF_COLS;
  if (llp) return [{ id: "members-llp", title: "Register of LLP members", required: false, note: OPTIONAL_NOTE, columns: cols, rows: officerRows(officers, ["member"], asOf, sensitive), sensitive }];
  return [
    { id: "directors", title: "Register of directors", required: false, note: OPTIONAL_NOTE, columns: cols, rows: officerRows(officers, ["director"], asOf, sensitive), sensitive },
    { id: "secretaries", title: "Register of secretaries", required: false, note: OPTIONAL_NOTE, columns: cols, rows: officerRows(officers, ["secretary"], asOf, sensitive), sensitive },
  ];
}
export function pscRegister(pscs: Row[], asOf: string, sensitive: boolean): Register {
  const natures = (r: Row) => { try { return (JSON.parse(str(r.Natures)) as string[]).map((n) => n.replace(/-/g, " ")).join("; "); } catch { return str(r.Natures); } };
  const rows = pscs.filter((p) => str(p.Status) !== "pending" && (!str(p.NotifiedOn) || str(p.NotifiedOn).slice(0, 10) <= asOf))
    .map((p) => { const ended = !!str(p.CeasedOn) && str(p.CeasedOn).slice(0, 10) <= asOf; return { ended, row: [personName(p), natures(p), str(p.NotifiedOn) ? d(str(p.NotifiedOn).slice(0, 10)) : "Not recorded", ended ? d(str(p.CeasedOn).slice(0, 10)) : "", sensitive ? str(p.DOB) : monthYear(str(p.DOB)), str(p.Nationality), str(p.ServiceAddress)] }; })
    .sort((a, b) => (a.ended ? 1 : 0) - (b.ended ? 1 : 0)).map((x) => x.row);
  return { id: "pscs", title: "Register of people with significant control", required: false, note: OPTIONAL_NOTE, columns: ["Name", "Nature of control", "Became a PSC", "Ceased", sensitive ? "Date of birth" : "Born", "Nationality", "Service address"], rows, sensitive };
}

export type Sources = { ledger: Row[]; officers: Row[]; pscs: Row[]; clientKey: string; llp: boolean };
/** Every register that applies to this company at a date. LLPs have no shares, so no register of members or share records. */
export function allRegisters(s: Sources, asOf: string, sensitive: boolean): Register[] {
  const entries = s.ledger.filter((r) => str(r.ClientKey) === s.clientKey).map(readEntry);
  const o = s.officers.filter((r) => str(r.ClientKey) === s.clientKey);
  const p = s.pscs.filter((r) => str(r.ClientKey) === s.clientKey);
  return [...(s.llp ? [] : [membersRegister(entries, asOf), transactionsRegister(entries, asOf)]), ...officersRegister(o, asOf, sensitive, s.llp), pscRegister(p, asOf, sensitive)];
}

const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** A register as CSV. Cells that start with a spreadsheet formula character are made safe. */
export const toCsv = (r: Register): string => [r.columns, ...r.rows].map((row) => row.map((c) => q(/^[=+\-@]/.test(c) ? `'${c}` : c)).join(",")).join("\r\n");

/** A PDF of the chosen registers for a company as at a date. Sensitive registers carry a marking. */
export async function registersPdf(company: { name: string; number: string }, regs: Register[], asOf: string, preparedBy: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 36;
  let page = pdf.addPage([W, H]); let y = H - M;
  const clean = (t: string) => t.replace(/[^\x20-\x7E£]/g, "?");
  const wrap = (t: string, w: number, size: number) => { const out: string[] = []; let line = ""; for (const word of clean(t).split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next, size) > w && line) { out.push(line); line = word; } else line = next; } if (line) out.push(line); return out.length ? out : [""]; };
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const text = (t: string, x: number, size = 9, f = font) => page.drawText(clean(t), { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  regs.forEach((r, ri) => {
    if (ri > 0 || y < H - M) newPage();
    text(`${company.name} (${company.number})`, M, 10, bold); y -= 15;
    text(`${r.title} as at ${d(asOf)}`, M, 14, bold); y -= 18;
    for (const l of wrap(r.note, W - 2 * M, 8)) { text(l, M, 8); y -= 11; }
    if (r.sensitive) { text("Contains personal information: not for public inspection.", M, 8, bold); y -= 11; }
    y -= 6;
    const cw = (W - 2 * M) / r.columns.length;
    const head = () => { r.columns.forEach((c, i) => text(c, M + i * cw, 8, bold)); y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) }); y -= 10; };
    head();
    if (!r.rows.length) { text("No entries.", M, 9); y -= 12; }
    for (const row of r.rows) {
      const cells = row.map((c, i) => wrap(c, cw - 6, 8));
      const h = Math.max(...cells.map((c) => c.length)) * 10;
      if (y - h < M + 20) { newPage(); head(); }
      cells.forEach((lines, i) => lines.forEach((l, li) => page.drawText(l, { x: M + i * cw, y: y - li * 10, size: 8, font, color: rgb(0.1, 0.1, 0.1) })));
      y -= h + 3;
    }
  });
  pdf.getPages().forEach((p, i, all) => p.drawText(clean(`Prepared ${new Date().toISOString().slice(0, 10)} by ${preparedBy}. Page ${i + 1} of ${all.length}`), { x: M, y: 18, size: 7, font, color: rgb(0.4, 0.4, 0.4) }));
  return pdf.save();
}
