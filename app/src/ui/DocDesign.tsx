// Settings > Document design: how each kind of PDF looks. Pick a document type, then its cover page,
// pages, header and footer; the preview beside it is the real renderer drawing a sample document.
import { useEffect, useMemo, useRef, useState } from "react";
import { Band, Column, DOC_TYPES, DOC_TYPE_NAMES, DocType, Design, Designs, DESIGN_KEY, MAX_INFO, copyDesign, designFor, designProblems, readDesigns } from "../lib/docDesign";
import { DocContent } from "../lib/docModel";
import { useData } from "./data";
import { PdfPreview } from "./DocsPreview";
import { makePdf, setDesigns, useDocs } from "./docsKit";

const SAMPLE: DocContent = { blocks: [
  { type: "p", runs: [{ t: "Dear Sample Client," }] },
  { type: "p", runs: [{ t: "This is a sample page so you can see the margins, header and footer. Replace nothing here: the real documents use your own wording." }], align: "justify" },
  { type: "h", level: 2, runs: [{ t: "A heading" }] },
  { type: "list", ordered: false, items: [[{ t: "First point" }], [{ t: "Second point" }]] },
  { type: "p", runs: [{ t: "Yours sincerely," }] },
] };

export { DesignSync } from "./DesignSync";

function ColumnEditor({ label, v, onChange }: { label: string; v: Column; onChange: (c: Column) => void }) {
  return (
    <div className="stack" style={{ gap: 4, minWidth: 180, flex: 1 }}>
      <label className="doc-field">{label}
        <select className="input" value={v.kind} onChange={(e) => onChange({ kind: e.target.value as Column["kind"], text: v.text })}>
          <option value="empty">Nothing</option><option value="logo">Logo</option><option value="text">Text</option>
        </select>
      </label>
      {v.kind === "text" && <textarea className="input" rows={2} aria-label={`${label} text`} value={v.text} onChange={(e) => onChange({ ...v, text: e.target.value })} />}
    </div>
  );
}

function BandEditor({ title, b, onChange }: { title: string; b: Band; onChange: (p: Partial<Band>) => void }) {
  return (
    <section className="card pad stack" aria-label={title}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={b.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} /> Show on every page</label>
      {b.enabled && (<>
        <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="doc-field">Background colour <input type="color" value={b.background || "#ffffff"} onChange={(e) => onChange({ background: e.target.value })} /></label>
          <button type="button" className="linkbtn" onClick={() => onChange({ background: "" })}>No background</button>
          <label className="doc-field">Text colour <input type="color" value={b.colour} onChange={(e) => onChange({ colour: e.target.value })} /></label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={b.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> Bold</label>
          <label className="doc-field">Minimum height (mm) <input type="number" min={5} max={60} value={b.minHeight} onChange={(e) => onChange({ minHeight: Number(e.target.value) })} style={{ width: 70 }} /></label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={b.rule} onChange={(e) => onChange({ rule: e.target.checked })} /> Line on the inner edge</label>
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <ColumnEditor label="Left" v={b.left} onChange={(left) => onChange({ left })} />
          <ColumnEditor label="Middle" v={b.middle} onChange={(middle) => onChange({ middle })} />
          <ColumnEditor label="Right" v={b.right} onChange={(right) => onChange({ right })} />
        </div>
      </>)}
    </section>
  );
}

export function DocDesignSettings() {
  const { data, saveSetting } = useData();
  const docs = useDocs();
  const saved = useMemo(() => readDesigns(data.settings), [data.settings]);
  const [type, setType] = useState<DocType>("proposal");
  const [local, setLocal] = useState<Designs>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [copyFrom, setCopyFrom] = useState<DocType | "">("");
  const d = designFor(local, type);
  const problems = designProblems(d);
  const dirty = JSON.stringify(local) !== JSON.stringify(saved);
  const set = (p: Partial<Design>) => setLocal({ ...local, [type]: { ...d, ...p } });
  const cover = (p: Partial<Design["cover"]>) => set({ cover: { ...d.cover, ...p } });
  const run = useRef(0);
  useEffect(() => {
    const n = ++run.current;
    const t = window.setTimeout(async () => {
      try {
        const out = await makePdf({ content: SAMPLE, layout: { ...({} as object) } as never, branding: docs.brand(), title: `Sample ${DOC_TYPE_NAMES[type].toLowerCase()}`, reference: "SAMPLE-001", client: "Sample Client Ltd", design: d });
        if (n === run.current) { setBytes(out.bytes); setError(""); }
      } catch { if (n === run.current) setError("The preview couldn't be made."); }
    }, 300);
    return () => window.clearTimeout(t);
  }, [d, docs, type]);

  const save = async () => {
    setBusy(true); setMsg("");
    try { await saveSetting(DESIGN_KEY, local); setMsg("Saved. New PDFs use these designs."); } catch { setMsg("That didn't save. Try again."); } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <section className="card pad stack" aria-labelledby="dd-h">
        <h2 id="dd-h" style={{ margin: 0 }}>Document design</h2>
        <p className="muted" style={{ margin: 0 }}>How each kind of PDF looks. The logo, colours and addresses come from your branding profile. In header, footer and cover text you can use {"{title} {reference} {client} {date} {firm} {address} {page} {pages}"}.</p>
        <nav className="tabs" aria-label="Document type">
          {DOC_TYPES.map((t) => <button key={t} type="button" className={t === type ? "tab active" : "tab"} aria-pressed={t === type} onClick={() => setType(t)}>{DOC_TYPE_NAMES[t]}{local[t] ? "" : " (default)"}</button>)}
        </nav>
        <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="doc-field">Copy the design from
            <select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value as DocType | "")}>
              <option value="">Choose a document type</option>
              {DOC_TYPES.filter((t) => t !== type).map((t) => <option key={t} value={t}>{DOC_TYPE_NAMES[t]}</option>)}
            </select>
          </label>
          <button type="button" className="btn" disabled={!copyFrom} onClick={() => { if (copyFrom) { setLocal(copyDesign(local, copyFrom, type)); setCopyFrom(""); } }}>Copy</button>
        </div>
      </section>

      <div className="row-wrap" style={{ gap: 16, alignItems: "flex-start" }}>
        <div className="stack" style={{ flex: "1 1 520px", minWidth: 300 }}>
          <section className="card pad stack" aria-label="Pages">
            <h3 style={{ margin: 0 }}>Pages</h3>
            <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="doc-field">Font <select className="input" value={d.font} onChange={(e) => set({ font: e.target.value as Design["font"] })}><option value="inherit">Branding profile's font</option><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label>
              <label className="doc-field">Text size (pt) <input type="number" min={8} max={14} step={0.5} value={d.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} style={{ width: 70 }} /></label>
              <label className="doc-field">Page numbers <select className="input" value={d.pageNumbers} onChange={(e) => set({ pageNumbers: e.target.value as Design["pageNumbers"] })}><option value="page-of">Page 1 of 3</option><option value="slash">1 / 3</option><option value="number">1</option><option value="dashed">- 1 -</option><option value="none">None</option></select></label>
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              {(["top", "right", "bottom", "left"] as const).map((k) => (
                <label key={k}>Margin {k} (mm) <input type="number" min={10} max={60} value={d.margins[k]} onChange={(e) => set({ margins: { ...d.margins, [k]: Number(e.target.value) } })} style={{ width: 70 }} /></label>
              ))}
            </div>
          </section>

          <section className="card pad stack" aria-label="Cover page">
            <h3 style={{ margin: 0 }}>Cover page</h3>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.cover.enabled} onChange={(e) => cover({ enabled: e.target.checked })} /> Add a cover page</label>
            {d.cover.enabled && (<>
              <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                <label className="doc-field">Page colour <input type="color" value={d.cover.background} onChange={(e) => cover({ background: e.target.value })} /></label>
                <label className="doc-field">Overlay colour <input type="color" value={d.cover.overlay} onChange={(e) => cover({ overlay: e.target.value })} /></label>
                <label className="doc-field">Overlay opacity (%) <input type="number" min={0} max={100} value={d.cover.overlayOpacity} onChange={(e) => cover({ overlayOpacity: Number(e.target.value) })} style={{ width: 70 }} /></label>
                <label className="doc-field">Text colour <input type="color" value={d.cover.textColour} onChange={(e) => cover({ textColour: e.target.value })} /></label>
                <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.cover.logo} onChange={(e) => cover({ logo: e.target.checked })} /> Logo</label>
                <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={d.cover.address} onChange={(e) => cover({ address: e.target.checked })} /> Firm's address</label>
              </div>
              <label className="doc-field">Title <input className="input" value={d.cover.title} onChange={(e) => cover({ title: e.target.value })} style={{ width: "100%" }} /></label>
              <div className="stack" style={{ gap: 4 }}>
                <strong>Additional information</strong>
                {d.cover.info.map((it, i) => (
                  <div key={i} className="row-wrap" style={{ gap: 8 }}>
                    <input className="input" aria-label={`Information ${i + 1} label`} placeholder="Label" value={it.label} onChange={(e) => cover({ info: d.cover.info.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <input className="input" aria-label={`Information ${i + 1} value`} placeholder="Value" value={it.value} onChange={(e) => cover({ info: d.cover.info.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                    <button type="button" className="linkbtn" onClick={() => cover({ info: d.cover.info.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                ))}
                {d.cover.info.length < MAX_INFO && <div><button type="button" className="btn" onClick={() => cover({ info: [...d.cover.info, { label: "", value: "" }] })}>Add a piece of information</button></div>}
              </div>
            </>)}
          </section>

          <BandEditor title="Header" b={d.header} onChange={(p) => set({ header: { ...d.header, ...p } })} />
          <BandEditor title="Footer" b={d.footer} onChange={(p) => set({ footer: { ...d.footer, ...p } })} />

          {problems.map((p) => <p key={p} className="import-list warn" role="note">{p}</p>)}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save designs"}</button>
            {dirty && <button type="button" className="linkbtn" onClick={() => setLocal(saved)}>Discard changes</button>}
            <span role="status" className="muted">{msg}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>Section cover pages inside an engagement letter are not built yet. A design applies to the whole document.</p>
        </div>
        <div style={{ flex: "1 1 340px", minWidth: 300 }}>
          <h3 style={{ marginTop: 0 }}>Preview</h3>
          {error ? <p role="alert">{error}</p> : <PdfPreview bytes={bytes} width={420} />}
        </div>
      </div>
    </div>
  );
}
