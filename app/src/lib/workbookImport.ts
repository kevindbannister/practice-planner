// Importing a working paper workbook (the layout Kevin's papers come back in: Control Sheet, Notes,
// "TB 2025" (last year's filed trial balance), "TB 2026" (OBD, software TB, journals, closing TB),
// Journals and Fixed Assets). Sheets are found by name and their columns by their headings, so a
// workbook laid out a little differently still comes in. What can't be matched is listed, not guessed.
//
// Journals: the closing TB's journal column links to the Journals sheet (=Journals!D11), which says
// which trial balance account each journal line hits. Lines without a link are matched on amount and
// then name. Anything in the TB's journal column that the Journals sheet doesn't explain comes in as
// its own journal, flagged, so the papers still agree to the workbook's closing TB.
import { Line, Setup, depreciation } from "./papers";
import { XBook, XSheet, colNumber, excelDate } from "./xlsxRead";

export type ImportLine = { Code?: string; Detail?: string; Amount?: number; Remark?: string; f?: Record<string, unknown> };
export type ImportRegister = { sub: string; title: string; setup: Setup; lines: ImportLine[] };
export type ImportPlan = {
  company: string; yearEnd: string;
  info: Setup;
  queries: ImportLine[];
  tb: ImportLine[];
  priorTb: ImportLine[];
  obd: ImportLine[];
  journals: ImportLine[];
  registers: ImportRegister[];
  found: string[]; // what was read, for the preview
  problems: string[]; // what needs a look
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ------------------------------------------------------------------ trial balance sheets

type Pair = { dr: number; cr: number };
type TbSheetRow = {
  row: number; code: string; name: string; irisName: string; irisCode: string;
  obd: Pair; sw: Pair; j: Pair; closing: Pair; jf: [string, string]; // journal column formulas (Dr, Cr)
};
type TbSheet = { rows: TbSheetRow[]; software: boolean; journalCols?: [number, number]; xero: boolean };

/** Where a heading is, searching the first rows of a sheet. */
function findRow(sh: XSheet, test: (t: string) => boolean, upTo = 40): number {
  for (let r = 1; r <= Math.min(upTo, sh.maxRow); r++) for (let c = 1; c <= 30; c++) if (test(sh.text(r, c))) return r;
  return 0;
}

function readTbSheet(sh: XSheet): TbSheet | undefined {
  const h = findRow(sh, (t) => /^description$/i.test(t));
  if (!h) return undefined;
  const heads: { c: number; t: string }[] = [];
  for (let c = 1; c <= 30; c++) heads.push({ c, t: sh.text(h, c) });
  const col = (re: RegExp, not?: RegExp) => heads.find((x) => re.test(x.t) && !(not && not.test(x.t)))?.c || 0;
  const name = col(/^description$/i);
  const code = col(/n\s*\/?\s*c|code/i, /iris/i) || (name > 1 ? name - 1 : 0);
  const irisName = col(/iris.*(chart|account)|iris elements/i, /n\s*\/\s*c/i);
  const irisCode = col(/iris\s*n\s*\/?\s*c/i);
  const pairCol = (re: RegExp) => col(re);
  const obd = pairCol(/^obd$|opening balance diff/i), sw = pairCol(/software|per xero|xero tb/i), j = pairCol(/^journals?$/i), closing = pairCol(/closing tb|final tb/i);
  const xero = heads.some((x) => /xero/i.test(x.t));
  const pair = (r: number, c: number): Pair => (c ? { dr: sh.num(r, c) || 0, cr: sh.num(r, c + 1) || 0 } : { dr: 0, cr: 0 });
  const rows: TbSheetRow[] = [];
  for (let r = h + 1; r <= sh.maxRow; r++) {
    const nm = sh.text(r, name);
    if (/^total$/i.test(nm)) break;
    if (!nm || /^(dr|cr)$/i.test(nm)) continue;
    const row: TbSheetRow = {
      row: r, code: sh.text(r, code), name: nm.replace(/\s+/g, " "), irisName: irisName ? sh.text(r, irisName) : "", irisCode: irisCode ? sh.text(r, irisCode) : "",
      obd: pair(r, obd), sw: pair(r, sw), j: pair(r, j), closing: pair(r, closing),
      jf: [j ? sh.cell(r, j)?.f || "" : "", j ? sh.cell(r, j + 1)?.f || "" : ""],
    };
    if (/^(na|n\/a)$/i.test(row.irisName)) row.irisName = "";
    rows.push(row);
  }
  return { rows, software: !!sw, journalCols: j ? [j, j + 1] : undefined, xero };
}

// ------------------------------------------------------------------ journals sheet

type JLine = { row: number; no: number; date: string; desc: string; dr: number; cr: number; narrative: string };

function readJournals(sh: XSheet): { lines: JLine[]; drCol: number; crCol: number } {
  const h = findRow(sh, (t) => /^particulars$/i.test(t));
  if (!h) return { lines: [], drCol: 0, crCol: 0 };
  const find = (re: RegExp) => { for (let c = 1; c <= 20; c++) if (re.test(sh.text(h, c))) return c; return 0; };
  const noC = find(/s\.?\s*no|journal|jnl/i) || 1, dateC = find(/date/i), descC = find(/particulars/i), drC = find(/^debit|^dr$/i), crC = find(/^credit|^cr$/i);
  const lines: JLine[] = [];
  let no = 0, date = "";
  for (let r = h + 1; r <= sh.maxRow; r++) {
    const desc = sh.text(r, descC);
    if (/^total$/i.test(desc)) break;
    const n = sh.num(r, noC);
    if (n !== undefined) no = n;
    const d = dateC ? sh.num(r, dateC) : undefined;
    if (d !== undefined && d > 20000) date = excelDate(d);
    const dr = sh.num(r, drC) || 0, cr = sh.num(r, crC) || 0;
    if (desc && (dr || cr)) lines.push({ row: r, no, date, desc: desc.replace(/\s+/g, " "), dr, cr, narrative: "" });
    else if (desc && /^\(/.test(desc)) {
      // "(Being ...)" goes on the journal's first line
      const first = lines.find((l) => l.no === no);
      if (first) first.narrative = desc.replace(/^\(|\)$/g, "").trim();
    }
  }
  return { lines, drCol: drC, crCol: crC };
}

/** Rows of the Journals sheet a formula points at, with the column letter (=Journals!D11, SUM(Journals!D148:D150)). */
function journalRefs(formula: string, sheetName: string): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const nm = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`'?${nm}'?!\\$?([A-Z]+)\\$?(\\d+)(?::\\$?([A-Z]+)\\$?(\\d+))?`, "gi");
  for (const m of formula.matchAll(re)) {
    const c = colNumber(m[1]), a = Number(m[2]), b = m[4] ? Number(m[4]) : a;
    for (let r = Math.min(a, b); r <= Math.max(a, b); r++) out.push({ col: c, row: r });
  }
  return out;
}

const similarity = (a: string, b: string) => {
  const wa = new Set(norm(a).split(" ").filter((w) => w.length > 2)), wb = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(wa.size, wb.size);
};

/** Each journal line's trial balance row, from the closing TB's links, then amounts, then names. */
function linkJournals(tb: TbSheetRow[], js: JLine[], sheetName: string, drCol: number, crCol: number): { link: Map<JLine, TbSheetRow>; unexplained: { row: TbSheetRow; dr: number; cr: number }[] } {
  const link = new Map<JLine, TbSheetRow>();
  const byRow = new Map(js.map((l) => [l.row, l]));
  const used = new Map<TbSheetRow, Pair>();
  const take = (l: JLine, t: TbSheetRow) => {
    link.set(l, t);
    const u = used.get(t) || { dr: 0, cr: 0 };
    used.set(t, { dr: r2(u.dr + l.dr), cr: r2(u.cr + l.cr) });
  };
  // 1. the TB's formulas, where the side agrees (a TB debit pointing at a journal debit)
  for (const t of tb) {
    for (const [side, f] of [["dr", t.jf[0]], ["cr", t.jf[1]]] as const) {
      for (const ref of journalRefs(f, sheetName)) {
        const l = byRow.get(ref.row);
        if (!l || link.has(l)) continue;
        if (side === "dr" && ref.col === drCol && l.dr) take(l, t);
        if (side === "cr" && ref.col === crCol && l.cr) take(l, t);
      }
    }
  }
  const left = (t: TbSheetRow) => { const u = used.get(t) || { dr: 0, cr: 0 }; return { dr: r2(t.j.dr - u.dr), cr: r2(t.j.cr - u.cr) }; };
  // 2. an amount the TB's journal column has that nothing explains yet
  for (const l of js) {
    if (link.has(l)) continue;
    const want = l.dr ? "dr" : "cr", amt = l.dr || l.cr;
    const hits = tb.filter((t) => Math.abs(left(t)[want] - amt) < 0.006).sort((a, b) => similarity(b.name, l.desc) - similarity(a.name, l.desc));
    if (hits.length) take(l, hits[0]);
  }
  // 3. the account name
  for (const l of js) {
    if (link.has(l)) continue;
    const exact = tb.find((t) => norm(t.name) === norm(l.desc));
    const best = exact || [...tb].sort((a, b) => similarity(b.name, l.desc) - similarity(a.name, l.desc))[0];
    if (best && (exact || similarity(best.name, l.desc) >= 0.6)) take(l, best);
  }
  const unexplained = tb.map((t) => ({ row: t, ...left(t) })).filter((x) => Math.abs(x.dr) > 0.004 || Math.abs(x.cr) > 0.004);
  return { link, unexplained };
}

// ------------------------------------------------------------------ fixed asset registers

const CLASS: [RegExp, string, string][] = [
  [/freehold|leasehold|property|land and build/i, "freehold", "Freehold property"],
  [/plant|machinery/i, "plant", "Plant and machinery"],
  [/furniture|fixture|fitting/i, "fixtures", "Fixtures and fittings"],
  [/motor|vehicle/i, "motor", "Motor vehicles"],
  [/computer/i, "computer", "Computer equipment"],
];

function fakeLine(f: Record<string, unknown>): Line {
  return { Key: "", Code: "", Detail: "", Amount: undefined, Remark: "", Done: false, Seq: 0, f, row: {} };
}

function readRegisters(sh: XSheet, period: string, problems: string[]): ImportRegister[] {
  const out: ImportRegister[] = [];
  for (let r = 1; r <= sh.maxRow; r++) {
    const title = sh.text(r, 1);
    const cls = CLASS.find(([re]) => re.test(title));
    if (!cls || title.length > 40) continue;
    // the block's heading row ("Particulars") is just below the title
    let h = 0;
    for (let k = r + 1; k <= r + 3; k++) if (/^particulars$/i.test(sh.text(k, 1))) h = k;
    if (!h) continue;
    const sub = h + 1;
    const cols: Record<string, number> = {};
    let bfSeen = 0;
    for (let c = 2; c <= 25; c++) {
      const t = sh.text(sub, c), top = sh.text(h, c);
      if (/^date$/i.test(top)) cols.date = c;
      if (/^b\s*\/\s*f(wd)?$/i.test(t)) { if (bfSeen++ === 0) cols.costBf = c; else if (!cols.depBf) cols.depBf = c; }
      else if (/^additions?$/i.test(t)) cols.add = c;
      else if (/^(deletions?|disposals?)$/i.test(t)) cols.disp = c;
      else if (/deletions? reversed|on disposals?|eliminated/i.test(t)) cols.depDisp = c;
      else if (/rate/i.test(t)) cols.rate = c;
      else if (/slm|wdv|method/i.test(t)) cols.method = c;
      else if (/charge/i.test(t)) cols.charge = c;
    }
    if (!cols.costBf) continue;
    const raw: { name: string; f: Record<string, unknown>; charge: number; exact: number; rate?: number; method: string }[] = [];
    let end = sub + 1;
    for (let k = sub + 1; k <= sh.maxRow; k++) {
      const name = sh.text(k, 1);
      end = k;
      if (/^total$/i.test(name)) break;
      if (!name) continue;
      const n = (c?: number) => (c ? r2(sh.num(k, c) || 0) : 0);
      const d = cols.date ? sh.num(k, cols.date) : undefined;
      const f: Record<string, unknown> = {};
      if (d && d > 20000) f.date = excelDate(d);
      for (const key of ["costBf", "depBf", "add", "disp", "depDisp"]) if (n(cols[key])) f[key] = n(cols[key]);
      raw.push({ name, f, charge: n(cols.charge), exact: cols.charge ? sh.num(k, cols.charge) || 0 : 0, rate: cols.rate ? sh.num(k, cols.rate) : undefined, method: cols.method ? sh.text(k, cols.method) : "" });
    }
    r = end;
    if (!raw.length) continue;
    const mode = <T,>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map<T, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const rate = mode(raw.map((x) => x.rate).filter((x): x is number => x !== undefined && x > 0));
    const meth = mode(raw.map((x) => x.method.toUpperCase()).filter(Boolean));
    const method = /WDV|RB|REDUC/.test(meth || "") ? "rb" : "sl";
    const ratePct = rate === undefined ? undefined : r2(rate <= 1 ? rate * 100 : rate);
    // by days or by months: whichever matches more of the workbook's charges
    const score = (apportion?: string) => raw.filter((x) => Math.abs(depreciation(fakeLine({ ...x.f, months: 12 }), { method, rate: ratePct, apportion, _period: period }) - x.charge) < 0.011).length;
    const apportion = score("days") > score(undefined) ? "days" : undefined;
    const setup: Setup = { method, rate: ratePct, apportion };
    const lines: ImportLine[] = raw.map((x) => {
      const f: Record<string, unknown> = { ...x.f, months: 12 };
      const calc = depreciation(fakeLine(f), { ...setup, _period: period });
      if (Math.abs(calc - x.charge) >= 0.011) f.chargeOver = x.charge;
      return { Detail: x.name, f };
    });
    // the workbook's total charge is worked out before rounding; put any penny difference on the biggest charge
    const charged = (l: ImportLine) => (l.f?.chargeOver !== undefined ? Number(l.f.chargeOver) : depreciation(fakeLine(l.f || {}), { ...setup, _period: period }));
    const pennies = r2(r2(raw.reduce((a, x) => a + x.exact, 0)) - r2(lines.reduce((a, l) => a + charged(l), 0)));
    if (pennies && Math.abs(pennies) <= 0.1) {
      const big = [...lines].sort((a, b) => charged(b) - charged(a))[0];
      const was = charged(big);
      big.f!.chargeOver = r2(was + pennies);
      problems.push(`${cls[2]}: ${money(Math.abs(pennies))} of rounding put on ${big.Detail} (${money(was)} → ${money(r2(was + pennies))}) so the register's charge agrees to the workbook's total.`);
    }
    const typed = lines.filter((l) => l.f?.chargeOver !== undefined).length;
    if (typed) problems.push(`${cls[2]}: ${typed} charge${typed === 1 ? "" : "s"} brought in as typed charges (they don't follow the class's ${method === "rb" ? "reducing balance" : "straight line"} ${ratePct}% rule: disposals, rounding lines or a different rate).`);
    out.push({ sub: cls[1], title: cls[2], setup, lines });
  }
  return out;
}

// ------------------------------------------------------------------ control sheet and notes

function readControl(sh: XSheet): Record<string, string> {
  const out: Record<string, string> = {};
  for (let r = 1; r <= Math.min(sh.maxRow, 60); r++) {
    const label = sh.text(r, 1).replace(/[:\s]+$/, "").toLowerCase();
    if (!label) continue;
    let value = "";
    for (let c = 2; c <= 6 && !value; c++) {
      const cell = sh.cell(r, c)?.v;
      if (cell === undefined || cell === "") continue;
      value = typeof cell === "number" && /year end|date/.test(label) && cell > 20000 ? excelDate(cell) : String(cell).trim();
      if (/^\d+$/.test(value) && c === 2 && sh.text(r, 3)) value = sh.text(r, 3); // a numbered list: the text is beside the number
    }
    out[label] = value;
  }
  return out;
}

function readNotes(sh: XSheet): ImportLine[] {
  const h = findRow(sh, (t) => /queries|observations/i.test(t));
  if (!h) return [];
  let textC = 3, refC = 1, commentC = 0;
  for (let c = 1; c <= 10; c++) {
    const t = sh.text(h, c);
    if (/queries|observations/i.test(t)) textC = c;
    if (/sch\.?\s*ref/i.test(t)) refC = c;
    if (/client comment/i.test(t)) commentC = c;
  }
  const out: ImportLine[] = [];
  let heading = "", ref = "";
  for (let r = h + 1; r <= sh.maxRow; r++) {
    const text = sh.text(r, textC).replace(/\s+\n/g, "\n").trim();
    if (sh.text(r, refC)) ref = sh.text(r, refC);
    if (!text || /^click here/i.test(text)) continue;
    const isHeading = text.length < 60 && !/[.?]$/.test(text) && !/\n/.test(text) && /^\s*-?\s*[A-Z]/.test(text) && !/\d{2}/.test(text);
    if (isHeading) { heading = text.replace(/^-\s*/, ""); continue; }
    out.push({ Code: ref, Detail: `${heading ? `${heading}: ` : ""}${text}`, Remark: commentC ? sh.text(r, commentC) : undefined });
  }
  return out;
}

// ------------------------------------------------------------------ the whole workbook

/** Read a working paper workbook for the year ending `period` ("yyyy-mm-dd"). */
export function planImport(book: XBook, period: string): ImportPlan {
  const plan: ImportPlan = { company: "", yearEnd: "", info: {}, queries: [], tb: [], priorTb: [], obd: [], journals: [], registers: [], found: [], problems: [] };
  const year = Number(period.slice(0, 4));
  const tbName = (y: number) => book.names.find((n) => new RegExp(`^\\s*TB\\s*${y}\\b`, "i").test(n));

  // control sheet
  const control = book.sheet("Control Sheet");
  if (control) {
    const c = readControl(control);
    plan.company = c["company name"] || "";
    plan.yearEnd = c["year end"] || "";
    if (c["nature of business"]) plan.info.nature = c["nature of business"];
    if (c["vat registered"]) plan.info.vat = /^y/i.test(c["vat registered"]) ? "Yes" : "No";
    plan.info.periodType = "Year";
    plan.info.months = "12";
    plan.found.push(`Control sheet: ${[plan.company, c["registered number"] && `company number ${c["registered number"]}`, plan.yearEnd && `year end ${plan.yearEnd}`].filter(Boolean).join(", ")}`);
    if (plan.yearEnd && plan.yearEnd !== period) plan.problems.push(`The workbook's year end is ${plan.yearEnd}, not ${period}.`);
  }

  // this year's trial balance
  const curName = tbName(year);
  const cur = curName ? readTbSheet(book.sheet(curName)!) : undefined;
  if (!cur) plan.problems.push(`No "TB ${year}" sheet with a Description column was found.`);
  if (cur) {
    if (cur.xero) plan.info.software = "Xero";
    const keep = cur.rows.filter((t) => t.sw.dr || t.sw.cr || t.j.dr || t.j.cr || t.obd.dr || t.obd.cr || t.closing.dr || t.closing.cr);
    plan.tb = keep.map((t) => ({ Code: t.code, Detail: t.name, f: { iris: t.irisCode || t.irisName || undefined, dr: r2(t.sw.dr) || undefined, cr: r2(t.sw.cr) || undefined } }));
    const sdr = r2(keep.reduce((a, t) => a + t.sw.dr, 0)), scr = r2(keep.reduce((a, t) => a + t.sw.cr, 0));
    const zero = keep.filter((t) => !t.sw.dr && !t.sw.cr).length;
    plan.found.push(`${curName}: ${keep.length} accounts (${keep.length - zero} with a balance in the software, ${zero} only used by journals); software TB ${money(sdr)} / ${money(scr)}`);
    // opening balance differences
    const obd = keep.filter((t) => t.obd.dr || t.obd.cr);
    if (obd.length) {
      plan.obd = obd.map((t, i) => ({ Code: t.code, Detail: t.name, Remark: i ? undefined : "Opening balance differences: last year's filed accounts against the software (OBD sheet)", f: { no: 1, dr: r2(t.obd.dr) || undefined, cr: r2(t.obd.cr) || undefined } }));
      plan.found.push(`Opening balance differences: ${obd.length} lines, ${money(r2(obd.reduce((a, t) => a + t.obd.dr, 0)))}`);
    }
    // journals
    const jName = book.names.find((n) => /^journals?$/i.test(n.trim()));
    const jSheet = jName ? book.sheet(jName) : undefined;
    if (jSheet) {
      const { lines: js, drCol, crCol } = readJournals(jSheet);
      const { link, unexplained } = linkJournals(keep, js, jName!, drCol, crCol);
      const out: ImportLine[] = js.map((l) => {
        const t = link.get(l);
        const f: Record<string, unknown> = { no: l.no, dr: r2(l.dr) || undefined, cr: r2(l.cr) || undefined };
        if (l.date) f.date = l.date;
        if (t && norm(t.name) !== norm(l.desc)) f.desc = l.desc;
        return { Code: t?.code || "", Detail: t?.name || l.desc, Remark: l.narrative || undefined, f };
      });
      // each journal to the penny: a rounding difference goes on its biggest line on the short side
      for (const no of [...new Set(js.map((l) => l.no))]) {
        const mine = out.filter((x) => x.f?.no === no);
        const dr = r2(mine.reduce((a, x) => a + (Number(x.f?.dr) || 0), 0)), cr = r2(mine.reduce((a, x) => a + (Number(x.f?.cr) || 0), 0));
        const diff = r2(dr - cr);
        if (diff && Math.abs(diff) <= 0.05) {
          const side = diff > 0 ? "cr" : "dr";
          const big = mine.filter((x) => x.f?.[side]).sort((a, b) => Number(b.f![side]) - Number(a.f![side]))[0];
          if (big) {
            const was = Number(big.f![side]);
            big.f![side] = r2(was + Math.abs(diff));
            plan.problems.push(`Journal ${no} was ${money(Math.abs(diff))} out after rounding to the penny: ${big.Detail} ${money(was)} → ${money(Number(big.f![side]))} so it balances.`);
          }
        } else if (diff) plan.problems.push(`Journal ${no} doesn't balance: debits ${money(dr)}, credits ${money(cr)}.`);
      }
      const unlinked = js.filter((l) => !link.has(l));
      if (unlinked.length) plan.problems.push(`${unlinked.length} journal line${unlinked.length === 1 ? "" : "s"} didn't match a trial balance account and come in as new accounts: ${unlinked.map((l) => `#${l.no} ${l.desc}`).join("; ")}.`);
      plan.journals = out;
      const jdr = r2(js.reduce((a, l) => a + l.dr, 0));
      plan.found.push(`${jName}: ${new Set(js.map((l) => l.no)).size} journals, ${js.length} lines, ${money(jdr)}`);
      if (unexplained.length) {
        const top = Math.max(0, ...js.map((l) => l.no)) + 1;
        const total = r2(unexplained.reduce((a, x) => a + Math.max(0, x.dr), 0));
        unexplained.forEach((x, i) => out.push({
          Code: x.row.code, Detail: x.row.name, Remark: i ? undefined : "In the workbook's closing TB journal column but not on the Journals sheet",
          f: { no: top, dr: x.dr > 0 ? x.dr : x.cr < 0 ? -x.cr : undefined, cr: x.cr > 0 ? x.cr : x.dr < 0 ? -x.dr : undefined },
        }));
        plan.problems.push(`The closing TB's journal column has ${money(total)} that isn't on the Journals sheet (${unexplained.map((x) => x.row.name).join(", ")}). It comes in as journal ${top} so the papers agree to the closing TB; it needs a journal on the sheet.`);
      }
    } else if (cur.rows.some((t) => t.j.dr || t.j.cr)) {
      plan.problems.push("The closing TB has journals but there's no Journals sheet; the journal column comes in as one journal per account.");
      plan.journals = keep.filter((t) => t.j.dr || t.j.cr).map((t) => ({ Code: t.code, Detail: t.name, f: { no: 1, dr: r2(t.j.dr) || undefined, cr: r2(t.j.cr) || undefined } }));
    }
  }

  // last year's trial balance (the filed accounts)
  const prevName = tbName(year - 1);
  const prev = prevName ? readTbSheet(book.sheet(prevName)!) : undefined;
  if (prev) {
    plan.priorTb = prev.rows.filter((t) => t.closing.dr || t.closing.cr || t.sw.dr || t.sw.cr).map((t) => {
      const p = t.closing.dr || t.closing.cr ? t.closing : t.sw;
      return { Code: t.code, Detail: t.name, f: { iris: t.irisCode || t.irisName || undefined, dr: r2(p.dr) || undefined, cr: r2(p.cr) || undefined } };
    });
    const dr = r2(plan.priorTb.reduce((a, x) => a + (Number(x.f?.dr) || 0), 0));
    plan.found.push(`${prevName}: ${plan.priorTb.length} accounts, ${money(dr)} (last year's figures)`);
  }

  // fixed asset registers
  const fa = book.names.find((n) => /^fixed assets?$/i.test(n.trim()));
  if (fa) {
    plan.registers = readRegisters(book.sheet(fa)!, period, plan.problems);
    for (const g of plan.registers) plan.found.push(`${g.title}: ${g.lines.length} assets, ${g.setup.method === "rb" ? "reducing balance" : "straight line"} ${g.setup.rate}%${g.setup.apportion === "days" ? ", additions by days" : ""}`);
  }

  // notes and queries
  const notes = book.sheet("Notes");
  if (notes) {
    plan.queries = readNotes(notes);
    if (plan.queries.length) plan.found.push(`Notes: ${plan.queries.length} notes and queries`);
  }
  return plan;
}
