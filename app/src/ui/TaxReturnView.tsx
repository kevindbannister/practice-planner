// The tax return as HMRC prints it (SA100), filled in from the return being worked on, shown beside the computation. Each
// box with something to say is a hotspot: hovering highlights it, clicking opens the section of the return it comes from.
// Also here: starting a return for another tax year, bringing in a past return from IRIS's PDFs, and a confirm box.
import { useEffect, useMemo, useRef, useState } from "react";
import { Client } from "../lib/domain";
import { loadPdfJs, pdfPageText } from "../lib/pdfText";
import { BoxField, Context, FORM_YEARS, FormMap, Filled, fillForm, formUrl, formYearFor, layout, mapUrl } from "../lib/sa100";
import { Computation, SectionKey, TaxReturn } from "../lib/tax";
import { ImportResult, checkImport, readImport } from "../lib/taxImport";
import { YEARS, yearLabel } from "../lib/taxRates";
import { Icon } from "./bits";

const gbp = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE_NAMES: Record<number, string> = { 1: "Your details", 2: "What makes up your return", 3: "Income", 4: "Tax reliefs", 5: "Student loans, Child Benefit, Marriage Allowance", 6: "Finishing your return", 7: "Repayment and adviser", 8: "Signing your return" };

// ------------------------------------------------------------------ the forms held

let indexLoad: Promise<number[]> | undefined;
function formYears(): Promise<number[]> {
  indexLoad ||= fetch("/forms/sa100/index.json").then((r) => (r.ok ? r.json() : { years: FORM_YEARS })).then((x: { years?: number[] }) => x.years || FORM_YEARS).catch(() => FORM_YEARS);
  return indexLoad;
}
type Pdf = { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<void> } }> };
const loaded = new Map<number, Promise<{ map: FormMap; pdf: Pdf; bytes: Uint8Array }>>();
function loadForm(year: number) {
  if (!loaded.has(year)) {
    loaded.set(year, (async () => {
      const [map, bytes] = await Promise.all([
        fetch(mapUrl(year)).then((r) => { if (!r.ok) throw new Error("map"); return r.json() as Promise<FormMap>; }),
        fetch(formUrl(year)).then((r) => { if (!r.ok) throw new Error("pdf"); return r.arrayBuffer(); }).then((b) => new Uint8Array(b)),
      ]);
      const lib = (await loadPdfJs()) as unknown as { getDocument(s: unknown): { promise: Promise<Pdf> } };
      const pdf = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      return { map, pdf, bytes };
    })());
    loaded.get(year)!.catch(() => loaded.delete(year));
  }
  return loaded.get(year)!;
}

// ------------------------------------------------------------------ the viewer

export function ReturnViewer({ year, ret, comp, ctx, onPick }: { year: number; ret: TaxReturn; comp: Computation; ctx: Context; onPick: (section: SectionKey, title: string) => void }) {
  const [formYear, setFormYear] = useState<number | null | undefined>(undefined);
  const [form, setForm] = useState<{ map: FormMap; pdf: Pdf; bytes: Uint8Array }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setForm(undefined); setError("");
    void formYears().then((have) => {
      const fy = formYearFor(year, have);
      if (!live) return;
      setFormYear(fy ?? null);
      if (fy) loadForm(fy).then((f) => live && setForm(f), () => live && setError("HMRC's form couldn't be loaded. Check the connection and try again."));
    });
    return () => { live = false; };
  }, [year]);
  const filled = useMemo(() => (form ? fillForm(form.map, ret, comp, ctx) : new Map<string, Filled>()), [form, ret, comp, ctx]);
  const scroller = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!form) return;
    setBusy(true);
    try { await downloadFilled(form, filled, `SA100 ${yearLabel(year)} ${ctx.name}.pdf`); } finally { setBusy(false); }
  };

  if (formYear === null) return <div className="card pad"><p className="muted" style={{ margin: 0 }}>HMRC's SA100 isn't held for {yearLabel(year)}.</p></div>;
  return (
    <section className="sa-view" aria-label={`SA100 tax return ${yearLabel(year)}`}>
      <div className="sa-view-bar">
        <strong>SA100 {formYear || ""}</strong>
        <nav className="sa-pages" aria-label="Pages of the return">
          {form?.map.pages.map((p) => <button key={p.tr} type="button" title={PAGE_NAMES[p.tr]} onClick={() => scroller.current?.querySelector(`[data-tr="${p.tr}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>TR{p.tr}</button>)}
        </nav>
        <button type="button" className="btn small" disabled={!form || busy} onClick={() => void download()}><Icon name="download" size={14} /> {busy ? "Making the PDF…" : "Download PDF"}</button>
      </div>
      {formYear && formYear !== year && <p className="sa-note">HMRC hasn't published the {yearLabel(year)} SA100 yet, so this is the {yearLabel(formYear)} form. It's checked for a new one each month.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!form && !error && <div className="card pad muted">Loading HMRC's form…</div>}
      <div className="sa-scroll" ref={scroller}>
        {form?.map.pages.map((p) => <FormPageView key={`${formYear}-${p.index}`} pdf={form.pdf} page={p} filled={filled} onPick={onPick} />)}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "6px 4px 0" }}>HMRC's blank form for {formYear ? yearLabel(formYear) : "the year"}, filled from this return in whole pounds (income rounded down, tax paid rounded up). The supplementary pages (employment, self-employment, property, capital gains) aren't shown yet.</p>
    </section>
  );
}

function FormPageView({ pdf, page, filled, onPick }: { pdf: Pdf; page: FormMap["pages"][number]; filled: Map<string, Filled>; onPick: (s: SectionKey, title: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<string>();
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  // draw the page when it first comes near the screen, and again if the width changes a lot
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const drawn = useRef(0);
  useEffect(() => {
    if (!seen || !width || !canvas.current || Math.abs(drawn.current - width) < 40) return;
    drawn.current = width;
    let cancelled = false;
    void pdf.getPage(page.index).then(async (pg) => {
      if (cancelled || !canvas.current) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const vp = pg.getViewport({ scale: (width / page.w) * ratio });
      const c = canvas.current;
      c.width = vp.width; c.height = vp.height;
      await pg.render({ canvas: c, viewport: vp }).promise;
    });
    return () => { cancelled = true; };
  }, [seen, width, pdf, page]);
  const k = width / page.w;
  const pos = (r: BoxField["rect"]) => ({ left: r[0] * k, top: (page.h - r[3]) * k, width: (r[2] - r[0]) * k, height: (r[3] - r[1]) * k });
  return (
    <div className="sa-page" data-tr={page.tr} ref={wrap} style={{ aspectRatio: `${page.w} / ${page.h}` }}>
      <canvas ref={canvas} className="sa-canvas" role="img" aria-label={`Page TR ${page.tr}: ${PAGE_NAMES[page.tr] || ""}`} />
      {width > 0 && page.boxes.map((b) => {
        const f = filled.get(b.id);
        if (!f) return null;
        return b.fields.map((fld, i) => {
          const v = f.values[i];
          const p = pos(fld.rect);
          const chars = layout(fld, v);
          const shown = f.values.filter(Boolean).join(" ");
          return (
            <button key={`${b.id}-${i}`} type="button" className={`sa-hot${hover === b.id ? " on" : ""}`} style={p} title={`${f.title}${shown ? `: ${shown.replace(/\n/g, ", ")}` : ""}. Click to change.`}
              aria-label={`${f.title}${shown ? `: ${shown.replace(/\n/g, ", ")}` : ", blank"}. Open to change.`}
              onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(undefined)} onFocus={() => setHover(b.id)} onBlur={() => setHover(undefined)} onClick={() => onPick(f.section, f.title)}>
              {chars.map((ch, j) => (
                <span key={j} className={`sa-ink${fld.kind === "text" && !fld.cells ? " free" : ""}`} style={ch.align === "center"
                  ? { left: (ch.x - fld.rect[0]) * k, top: 0, height: p.height, fontSize: Math.max(8, Math.min(p.height * 0.72, 12 * k)), transform: "translateX(-50%)" }
                  : { left: (ch.x - fld.rect[0]) * k, top: 2 * k, fontSize: Math.max(8, 8.5 * k), lineHeight: 1.25 }}>{ch.text}</span>
              ))}
            </button>
          );
        });
      })}
    </div>
  );
}

async function downloadFilled(form: { map: FormMap; bytes: Uint8Array }, filled: Map<string, Filled>, name: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const src = await PDFDocument.load(form.bytes.slice(), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, form.map.pages.map((p) => p.index - 1));
  const font = await out.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.22, 0.6);
  form.map.pages.forEach((p, i) => {
    const page = out.addPage(pages[i]);
    for (const b of p.boxes) {
      const f = filled.get(b.id);
      if (!f) continue;
      b.fields.forEach((fld, j) => {
        const h = fld.rect[3] - fld.rect[1];
        for (const ch of layout(fld, f.values[j])) {
          if (ch.align === "center") {
            const size = Math.min(11, h * 0.7);
            page.drawText(ch.text, { x: ch.x - font.widthOfTextAtSize(ch.text, size) / 2, y: fld.rect[1] + (h - size * 0.72) / 2, size, font, color: ink });
          } else {
            ch.text.split("\n").forEach((line, li) => page.drawText(line, { x: ch.x, y: fld.rect[3] - 10 - li * 11, size: 9, font, color: ink }));
          }
        }
      });
    }
  });
  const bytes = await out.save();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, " ");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ------------------------------------------------------------------ a confirm box in the app's style

export type Ask = { title: string; body: string[]; yes: string; danger?: boolean; onYes: () => void };
export function ConfirmBox({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { yes.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="tax-add-sheet" role="presentation" onClick={onClose}>
      <div className="tax-add-card tax-confirm" role="alertdialog" aria-modal="true" aria-labelledby="tax-confirm-h" onClick={(e) => e.stopPropagation()}>
        <div className="quick-journal-head">
          <strong id="tax-confirm-h"><Icon name={ask.danger ? "alert" : "check"} size={16} /> {ask.title}</strong>
          <button type="button" className="quick-journal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="stack" style={{ gap: 8, padding: "4px 4px 0" }}>{ask.body.map((p) => <p key={p} style={{ margin: 0 }}>{p}</p>)}</div>
        <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" ref={yes} className={`btn ${ask.danger ? "danger" : "primary"}`} onClick={() => { onClose(); ask.onYes(); }}>{ask.yes}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ a return for another tax year

export type Start = "new" | "bf" | "import";
export function NewReturnDialog({ clients, clientKey, year, has, onGo, onClose }: {
  clients?: Client[]; clientKey?: string; year: number; has: (clientKey: string, year: number) => boolean; onGo: (clientKey: string, year: number, start: Start) => void; onClose: () => void;
}) {
  const [ck, setCk] = useState(clientKey || "");
  const [y, setY] = useState(year);
  const [start, setStart] = useState<Start>("new");
  const [q, setQ] = useState("");
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  const exists = !!ck && has(ck, y), prev = !!ck && has(ck, y - 1);
  const list = (clients || []).filter((c) => !q || String(c.Title).toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <div className="tax-add-sheet" role="presentation" onClick={onClose}>
      <div className="tax-add-card tax-confirm" role="dialog" aria-modal="true" aria-label="Start a tax return" onClick={(e) => e.stopPropagation()}>
        <div className="quick-journal-head">
          <strong><Icon name="plus" size={16} /> New tax return</strong>
          <span className="quick-journal-note">Any year from {YEARS[0].label}, including past years</span>
          <button type="button" className="quick-journal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {clients && (
            <label className="field"><span>Client</span>
              <input className="input" placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a client" />
              <select className="input" size={6} value={ck} onChange={(e) => setCk(e.target.value)} aria-label="Client">{list.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select>
            </label>
          )}
          <label className="field"><span>Tax year</span>
            <select className="input" value={y} onChange={(e) => setY(Number(e.target.value))}>{[...YEARS].reverse().map((r) => <option key={r.year} value={r.year}>{r.label}{ck && has(ck, r.year) ? " (already started)" : ""}</option>)}</select>
          </label>
          <fieldset className="tax-start">
            <legend>Start from</legend>
            <label><input type="radio" name="start" checked={start === "new"} onChange={() => setStart("new")} /> A blank return</label>
            <label className={prev ? undefined : "muted"}><input type="radio" name="start" checked={start === "bf"} disabled={!prev} onChange={() => setStart("bf")} /> Brought forward from {yearLabel(y - 1)}{prev ? "" : ` (no ${yearLabel(y - 1)} return here)`}</label>
            <label><input type="radio" name="start" checked={start === "import"} onChange={() => setStart("import")} /> A past return from IRIS (its tax calculation and detailed summaries PDFs)</label>
          </fieldset>
          {exists && <p className="warn" style={{ margin: 0 }}>There's already a {yearLabel(y)} return for this client. {start === "new" ? "It will be opened as it is." : "You'll be asked before anything on it is replaced."}</p>}
        </div>
        <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!ck} onClick={() => onGo(ck, y, start)}>{exists && start === "new" ? "Open it" : "Start the return"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bringing in a past return

/** Handed from the import box to the return it belongs to, when that's another year's page. */
export let pendingImport: { clientKey: string; year: number; res: ImportResult; submitted: boolean } | null = null;
export const takeImport = (clientKey: string, year: number) => {
  if (pendingImport && pendingImport.clientKey === clientKey && pendingImport.year === year) { const p = pendingImport; pendingImport = null; return p; }
  return null;
};

export function ImportDialog({ client, year, names, onUse, onClose }: { client: Client; year: number; names: string[]; onUse: (res: ImportResult, year: number, submitted: boolean) => void; onClose: () => void }) {
  const [res, setRes] = useState<ImportResult>();
  const [files, setFiles] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(true);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  const read = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true); setError(""); setRes(undefined);
    try {
      const got = [];
      for (const f of Array.from(list)) {
        if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { setError(`${f.name} isn't a PDF.`); continue; }
        got.push({ name: f.name, pages: await pdfPageText(new Uint8Array(await f.arrayBuffer())) });
      }
      setFiles(got.map((g) => g.name));
      if (got.length) setRes(readImport(got, names));
    } catch {
      setError("Those files couldn't be read. Use the PDFs IRIS Elements prints (not scans).");
    } finally { setReading(false); }
  };
  const chk = res ? checkImport(res) : undefined;
  const y = res?.year || year;
  const utrClash = res?.utr && client.UTR && String(client.UTR).replace(/\s/g, "") !== res.utr;
  return (
    <div className="tax-add-sheet" role="presentation" onClick={onClose}>
      <div className="tax-add-card tax-import" role="dialog" aria-modal="true" aria-label="Bring in a past tax return" onClick={(e) => e.stopPropagation()}>
        <div className="quick-journal-head">
          <strong><Icon name="download" size={16} /> Bring in a past return</strong>
          <span className="quick-journal-note">{client.Title}</span>
          <button type="button" className="quick-journal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Choose the PDFs IRIS Elements prints for the return: the tax calculation (SA302) and the detailed summaries (schedules). Either works alone; both together give the most detail.</p>
          <label className="tax-drop">
            <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => void read(e.target.files)} aria-label="Choose the PDFs" />
            <span><Icon name="download" size={16} /> {reading ? "Reading…" : files.length ? files.join(", ") : "Choose PDFs, or drop them here"}</span>
          </label>
          {error && <p className="error-text" role="alert">{error}</p>}
          {res && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row-wrap" style={{ gap: 8 }}>
                <span className="chip">{res.year ? yearLabel(res.year) : "Year not found"}</span>
                {res.utr && <span className={`chip mono${utrClash ? " red" : ""}`}>UTR {res.utr}</span>}
                {res.name && <span className="chip">{res.name}</span>}
                {res.kinds.map((k) => <span key={k} className="chip blue">{k === "calculation" ? "Tax calculation" : "Detailed summaries"}</span>)}
              </div>
              {utrClash && <p className="warn" style={{ margin: 0 }}>The UTR in the files ({res.utr}) isn't the client's ({String(client.UTR)}). Check these are the right client's files.</p>}
              {res.found.length > 0 && <ul className="tax-found">{res.found.map((f) => <li key={f}>{f}</li>)}</ul>}
              {chk && (chk.theirs !== undefined
                ? <p className={chk.matches ? "ok-text" : "warn"} style={{ margin: 0 }}>{chk.matches ? `Matches IRIS: total tax ${gbp(chk.ours)}.` : `IRIS worked out ${gbp(chk.theirs)}; this comes to ${gbp(chk.ours)}. Check the figures after bringing it in.`}</p>
                : <p className="muted" style={{ margin: 0 }}>Total tax from these figures: {gbp(chk.ours)}.</p>)}
              {res.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0 }}>{w}</p>)}
              <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={submitted} onChange={(e) => setSubmitted(e.target.checked)} /> This return was submitted to HMRC</label>
              {y !== year && <p className="muted" style={{ margin: 0 }}>This is the {yearLabel(y)} return, so it goes on that year.</p>}
            </div>
          )}
        </div>
        <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!res || !res.found.length || !YEARS.some((r) => r.year === y)} onClick={() => res && onUse(res, y, submitted)}>Bring in to {yearLabel(y)}</button>
        </div>
      </div>
    </div>
  );
}

/** Hand an import to another year's page and go there. */
export function sendImport(clientKey: string, year: number, res: ImportResult, submitted: boolean, go: () => void) {
  pendingImport = { clientKey, year, res, submitted };
  go();
}
