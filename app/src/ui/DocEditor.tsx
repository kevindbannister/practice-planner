// Documents: the editor. A4 page you type into, with a toolbar (bold, italic, underline, size, colour,
// alignment, headings, lists, tables, pictures, page breaks), a searchable list of merge fields, and a
// page panel (margins, header, footer, page numbers). It is a small editor built on the browser's own
// editing (contenteditable), with everything that goes in or out passing through the sanitiser in
// lib/docModel.ts, so what is kept is only what the PDF can show.
//
// Changes made through the browser's editing commands (typing, formatting, inserting) share its
// undo history, so Undo and Redo work across all of them. The page guides are approximate: the real
// page breaks are shown in the PDF preview, which is made by the same engine as the final document.
import type { ClipboardEvent as RClip, DragEvent as RDrag, MouseEvent as RMouse } from "react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Branding } from "../lib/docBranding";
import { FieldDef } from "../lib/docFields";
import { Align, DocContent, DocLayout, cleanColour, esc, parseHtml, toHtml } from "../lib/docModel";

const MM_PX = 96 / 25.4;
const PAGE_W = 210, PAGE_H = 297;
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 24];

/** Downsizes a picture file to a PNG or JPEG data URL small enough to keep in a list row. */
export async function shrinkImage(file: File, maxWidth = 640): Promise<{ src: string; w: number; h: number }> {
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) throw new Error("Choose a PNG or JPEG picture.");
  const url = await new Promise<string>((ok, bad) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => bad(new Error("That picture couldn't be read."));
    fr.readAsDataURL(file); // a data URL: the page's security policy doesn't allow blob URLs for images
  });
  const img = await new Promise<HTMLImageElement>((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => bad(new Error("That picture couldn't be read."));
    i.src = url;
  });
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const png = /png|gif|webp/i.test(file.type);
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  return { src: canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.8), w, h };
}

const keepSelection = (e: RMouse) => e.preventDefault();
function Btn({ label, onClick, children, on, wide }: { label: string; onClick: () => void; children: ReactNode; on?: boolean; wide?: boolean }) {
  return (
    <button type="button" className={`tb${wide ? " wide" : ""}`} aria-label={label} title={label} aria-pressed={on} onMouseDown={keepSelection} onClick={onClick}>{children}</button>
  );
}

const range = (): Range | null => {
  const s = window.getSelection();
  return s && s.rangeCount ? s.getRangeAt(0) : null;
};

type Props = {
  value: DocContent;
  /** Changes when the content is replaced from outside (a version restored); typing never changes it. */
  resetKey: string;
  onChange: (c: DocContent) => void;
  layout: DocLayout;
  onLayout: (l: DocLayout) => void;
  fields: FieldDef[];
  branding: Branding;
  /** Values for the fields, to show a hint when pointing at one. */
  usedWarning?: ReactNode;
};

export function DocEditor({ value, resetKey, onChange, layout, onLayout, fields, branding }: Props) {
  const page = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const timer = useRef<number>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<"" | "fields" | "table" | "page">("");
  const [find, setFind] = useState("");
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [inTable, setInTable] = useState(false);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  // load the content when the editor is created or the content is replaced from outside
  useEffect(() => {
    if (body.current) body.current.innerHTML = toHtml(value) || "<p><br></p>";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // fit the page to the space available
  useEffect(() => {
    const el = page.current?.parentElement;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 8) / (PAGE_W * MM_PX)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Keeps the page well formed: loose text is put in a paragraph and there is always a line after a table or break to type in. */
  const tidy = useCallback(() => {
    const el = body.current;
    if (!el) return;
    for (const n of Array.from(el.childNodes) as ChildNode[]) {
      if (n.nodeType === 3 && (n.textContent || "").length) {
        const p = document.createElement("p");
        n.replaceWith(p);
        p.appendChild(n);
        const r = document.createRange();
        r.setStart(n, (n.textContent || "").length);
        r.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
    const last = el.lastElementChild;
    if (!last || /^(TABLE|HR|OL|UL)$/.test(last.tagName)) {
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      el.appendChild(p);
    }
  }, []);
  const emit = useCallback(() => {
    tidy();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => body.current && onChange(parseHtml(body.current.innerHTML)), 250);
  }, [onChange, tidy]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // remember where the cursor was, so the field list and dialogs can insert there after taking focus
  useEffect(() => {
    const keep = () => {
      const r = range();
      if (r && body.current?.contains(r.commonAncestorContainer)) {
        saved.current = r.cloneRange();
        const n = r.startContainer;
        const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
        setInTable(!!el?.closest("td,th"));
      }
    };
    document.addEventListener("selectionchange", keep);
    return () => document.removeEventListener("selectionchange", keep);
  }, []);

  const focusBody = () => {
    body.current?.focus();
    if (saved.current) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(saved.current);
    }
  };
  const run = (cmd: string, arg?: string) => {
    focusBody();
    document.execCommand(cmd, false, arg);
    emit();
  };
  // Chips are inserted as plain spans and made non-editable afterwards: the browser's insert command
  // pushes a non-editable element out of its paragraph.
  const fixChips = () => body.current?.querySelectorAll(".mf").forEach((e) => e.setAttribute("contenteditable", "false"));
  const insert = (html: string) => {
    focusBody();
    const before = new Set(Array.from(body.current?.querySelectorAll("table") || []));
    document.execCommand("insertHTML", false, html.replace(/ contenteditable="false"/g, ""));
    fixChips();
    if (/^<table/.test(html)) {
      // put the cursor in the first cell of the new table
      const cellEl = Array.from(body.current?.querySelectorAll("table") || []).find((x) => !before.has(x))?.querySelector("th,td");
      if (cellEl) {
        const r = document.createRange();
        r.selectNodeContents(cellEl);
        r.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
    emit();
  };
  /** Wraps the selected text in a span with the given style. */
  const style = (css: string) => {
    focusBody();
    const r = range();
    if (!r || r.collapsed) return setError("Select some text first.");
    const box = document.createElement("div");
    box.appendChild(r.cloneContents());
    document.execCommand("insertHTML", false, `<span style="${css}">${box.innerHTML}</span>`);
    emit();
  };

  const onPaste = (e: RClip) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) insert(toHtml(parseHtml(html)));
    else insert(text.split(/\r?\n/).map((l) => esc(l)).join("<br>"));
  };
  const onDrop = async (e: RDrag) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) await addImage(f);
  };
  const addImage = async (f: File) => {
    setError("");
    try {
      const { src, w } = await shrinkImage(f);
      insert(`<p><img src="${src}" style="width:${Math.min(w, 400)}px"></p>`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture couldn't be used.");
    }
  };

  // ---- tables
  const cell = (): HTMLTableCellElement | null => {
    const r = saved.current || range();
    const n = r?.startContainer;
    const el = n && (n.nodeType === 1 ? (n as Element) : n.parentElement);
    return (el?.closest("td,th") as HTMLTableCellElement) || null;
  };
  /** Replaces the table the cursor is in with a changed copy (through the editor's own commands, so it can be undone). */
  const editTable = (fn: (t: HTMLTableElement, c: HTMLTableCellElement) => void) => {
    const c = cell();
    const t = c?.closest("table") as HTMLTableElement | null;
    if (!c || !t) return setError("Put the cursor in a table cell first.");
    const copy = t.cloneNode(true) as HTMLTableElement;
    const idx = Array.from(t.querySelectorAll("td,th")).indexOf(c);
    fn(copy, copy.querySelectorAll("td,th")[idx] as HTMLTableCellElement);
    focusBody();
    const r = document.createRange();
    r.selectNode(t);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    document.execCommand("insertHTML", false, toHtml(parseHtml(copy.outerHTML)).replace(/ contenteditable="false"/g, ""));
    fixChips();
    emit();
  };
  const colOf = (c: HTMLTableCellElement) => Array.from(c.parentElement!.children).indexOf(c);
  const blankCell = (tag: string) => { const x = document.createElement(tag); x.innerHTML = "<br>"; return x; };
  const addRow = (below: boolean) => editTable((t, c) => {
    const tr = c.parentElement as HTMLTableRowElement;
    const n = document.createElement("tr");
    for (let i = 0; i < tr.children.length; i++) n.appendChild(blankCell("td"));
    below ? tr.after(n) : tr.before(n);
  });
  const addCol = (right: boolean) => editTable((t, c) => {
    const i = colOf(c);
    t.querySelectorAll("tr").forEach((tr) => {
      const ref = tr.children[i];
      const n = blankCell(ref?.tagName.toLowerCase() === "th" ? "th" : "td");
      right ? ref?.after(n) : ref?.before(n);
    });
  });
  const delRow = () => editTable((t, c) => { const tr = c.parentElement!; if (t.querySelectorAll("tr").length < 2) tr.closest("table")!.remove(); else tr.remove(); });
  const delCol = () => editTable((t, c) => {
    const i = colOf(c);
    if (c.parentElement!.children.length < 2) return t.remove();
    t.querySelectorAll("tr").forEach((tr) => tr.children[i]?.remove());
  });
  const delTable = () => editTable((t) => { const p = document.createElement("p"); p.innerHTML = "<br>"; t.replaceWith(p); });
  const toggleHeader = () => editTable((t) => {
    const first = t.querySelector("tr");
    if (!first) return;
    const header = first.children[0]?.tagName === "TH";
    Array.from(first.children).forEach((c) => {
      const n = document.createElement(header ? "td" : "th");
      n.innerHTML = c.innerHTML;
      c.replaceWith(n);
    });
  });
  const makeTable = () => {
    const r = Math.max(1, Math.min(30, rows)), c = Math.max(1, Math.min(8, cols));
    const head = `<tr>${Array.from({ length: c }, () => "<th><br></th>").join("")}</tr>`;
    const row = `<tr>${Array.from({ length: c }, () => "<td><br></td>").join("")}</tr>`;
    insert(`<table>${head}${row.repeat(r - 1)}</table><p><br></p>`);
    setPanel("");
  };

  const align = (a: Align) => run(a === "left" ? "justifyLeft" : a === "center" ? "justifyCenter" : a === "right" ? "justifyRight" : "justifyFull");
  const block = (tag: string) => run("formatBlock", tag);

  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    return fields.filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.includes(q) || f.group.toLowerCase().includes(q));
  }, [fields, find]);
  const groups = useMemo(() => [...new Set(matches.map((f) => f.group))], [matches]);

  const L = layout;
  const contentH = (PAGE_H - L.margins.top - L.margins.bottom) * MM_PX;
  const header = L.header || branding.header;
  const footer = L.footer || branding.footer;
  const pagesApprox = Math.max(1, Math.ceil((height - 4) / contentH));

  const keep = keepSelection;

  return (
    <div className="docedit">
      <div className="docedit-bar" role="toolbar" aria-label="Formatting">
        <Btn label="Undo" onClick={() => run("undo")}>↶</Btn>
        <Btn label="Redo" onClick={() => run("redo")}>↷</Btn>
        <span className="sep" />
        <select className="input tb-select" aria-label="Paragraph style" defaultValue="p" onChange={(e) => { block(e.target.value); e.target.value = "p"; }} onMouseDown={() => undefined}>
          <option value="p">Style</option>
          <option value="p">Normal text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <select className="input tb-select narrow" aria-label="Text size" defaultValue="" onChange={(e) => { if (e.target.value) style(`font-size:${e.target.value}pt`); e.target.value = ""; }}>
          <option value="">Size</option>
          {SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
        </select>
        <label className="tb colour" title="Text colour" aria-label="Text colour">
          A
          <input type="color" defaultValue="#1f4e79" onChange={(e) => style(`color:${cleanColour(e.target.value) || "#000000"}`)} onMouseDown={() => undefined} />
        </label>
        <Btn label="Bold" onClick={() => run("bold")}><b>B</b></Btn>
        <Btn label="Italic" onClick={() => run("italic")}><i>I</i></Btn>
        <Btn label="Underline" onClick={() => run("underline")}><u>U</u></Btn>
        <span className="sep" />
        <Btn label="Align left" onClick={() => align("left")}>⇤</Btn>
        <Btn label="Centre" onClick={() => align("center")}>↔</Btn>
        <Btn label="Align right" onClick={() => align("right")}>⇥</Btn>
        <Btn label="Justify" onClick={() => align("justify")}>☰</Btn>
        <span className="sep" />
        <Btn label="Bulleted list" onClick={() => run("insertUnorderedList")} wide>• List</Btn>
        <Btn label="Numbered list" onClick={() => run("insertOrderedList")} wide>1. List</Btn>
        <Btn label="Table" onClick={() => setPanel(panel === "table" ? "" : "table")} on={panel === "table"} wide>Table</Btn>
        <Btn label="Picture" onClick={() => fileRef.current?.click()} wide>Picture</Btn>
        <Btn label="Page break" onClick={() => insert('<hr class="pagebreak"><p><br></p>')} wide>Page break</Btn>
        <span className="sep" />
        <Btn label="Insert a merge field" onClick={() => setPanel(panel === "fields" ? "" : "fields")} on={panel === "fields"} wide>{"{{ }} Field"}</Btn>
        <Btn label="Page settings: margins, header, footer" onClick={() => setPanel(panel === "page" ? "" : "page")} on={panel === "page"} wide>Page</Btn>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) addImage(f); }} />
      </div>

      {img && (
        <div className="doc-subbar" role="group" aria-label="Picture">
          Picture size:
          {[["Small", 30], ["Medium", 60], ["Large", 100], ["Full width", 165]].map(([n, mm]) => (
            <button key={n} type="button" className="btn small" onMouseDown={keep} onClick={() => { img.style.width = `${Math.round(Number(mm) * MM_PX)}px`; emit(); }}>{n}</button>
          ))}
          <button type="button" className="btn small" onMouseDown={keep} onClick={() => { img.parentElement?.remove(); setImg(null); emit(); }}>Remove</button>
        </div>
      )}
      {(panel === "table" || inTable) && (
        <div className="doc-subbar" role="group" aria-label="Table">
          {panel === "table" && (
            <>
              <label>Rows <input className="input num" type="number" min={1} max={30} value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
              <label>Columns <input className="input num" type="number" min={1} max={8} value={cols} onChange={(e) => setCols(Number(e.target.value))} /></label>
              <button type="button" className="btn small primary" onClick={makeTable}>Insert table</button>
              <span className="sep" />
            </>
          )}
          <span className="muted">{inTable ? "In this table:" : "When the cursor is in a table:"}</span>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={() => addRow(false)}>Row above</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={() => addRow(true)}>Row below</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={() => addCol(false)}>Column left</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={() => addCol(true)}>Column right</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={delRow}>Delete row</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={delCol}>Delete column</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={toggleHeader}>Heading row on/off</button>
          <button type="button" className="btn small" disabled={!inTable} onMouseDown={keep} onClick={delTable}>Delete table</button>
        </div>
      )}
      {panel === "fields" && (
        <div className="doc-subbar fields" role="group" aria-label="Merge fields">
          <input className="input" type="search" placeholder="Search fields, e.g. address" aria-label="Search merge fields" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
          <div className="field-list">
            {!matches.length && <span className="muted">No field matches “{find}”.</span>}
            {groups.map((g) => (
              <div key={g} className="field-group">
                <strong>{g}</strong>
                {matches.filter((f) => f.group === g).map((f) => (
                  <button key={f.key} type="button" className="chip-btn" onMouseDown={keep} onClick={() => insert(`<span class="mf" contenteditable="false" data-field="${f.key}">{{${f.key}}}</span>&nbsp;`)} title={`{{${f.key}}}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {panel === "page" && (
        <div className="doc-subbar pagebar" role="group" aria-label="Page settings">
          {(["top", "right", "bottom", "left"] as const).map((k) => (
            <label key={k}>Margin {k} (mm)
              <input className="input num" type="number" min={10} max={50} value={L.margins[k]} onChange={(e) => onLayout({ ...L, margins: { ...L.margins, [k]: Math.max(10, Math.min(50, Number(e.target.value) || 10)) } })} />
            </label>
          ))}
          <label>Text size (pt)
            <select className="input" value={L.fontSize} onChange={(e) => onLayout({ ...L, fontSize: Number(e.target.value) })}>
              {[9, 10, 10.5, 11, 12].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Header text (above the first line, on every page)
            <textarea className="input" rows={2} value={L.header} placeholder={branding.header || "Uses the practice header"} onChange={(e) => onLayout({ ...L, header: e.target.value })} />
          </label>
          <label>Footer text
            <textarea className="input" rows={2} value={L.footer} placeholder={branding.footer || "Uses the practice footer"} onChange={(e) => onLayout({ ...L, footer: e.target.value })} />
          </label>
          <label className="check"><input type="checkbox" checked={L.pageNumbers} onChange={(e) => onLayout({ ...L, pageNumbers: e.target.checked })} /> Page numbers</label>
          <label className="check"><input type="checkbox" checked={L.showLogo} onChange={(e) => onLayout({ ...L, showLogo: e.target.checked })} /> Show the logo</label>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="doc-stage">
        <div ref={page} className="doc-page" style={{ width: `${PAGE_W}mm`, minHeight: `${PAGE_H}mm`, zoom: scale, paddingLeft: `${L.margins.left}mm`, paddingRight: `${L.margins.right}mm`, paddingTop: `${L.margins.top}mm`, paddingBottom: `${L.margins.bottom}mm`, ["--doc-primary" as string]: branding.primary, ["--doc-secondary" as string]: branding.secondary, ["--doc-font" as string]: branding.font === "serif" ? "'Times New Roman', Times, serif" : branding.font === "mono" ? "'Courier New', monospace" : "Helvetica, Arial, sans-serif" }}>
          <div className="doc-furniture head" style={{ top: "8mm", left: `${L.margins.left}mm`, right: `${L.margins.right}mm` }} aria-hidden="true">
            <span className="doc-head-text">{header}</span>
            {L.showLogo && branding.logo && <img src={branding.logo} alt="" />}
          </div>
          <div
            ref={body}
            className="doc-body"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Document"
            style={{ fontSize: `${L.fontSize}pt`, minHeight: `${contentH}px`, backgroundSize: `100% ${contentH}px` }}
            onFocus={() => { try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* not supported */ } }}
            onInput={emit}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={(e) => { const t = e.target as HTMLElement; setImg(t.tagName === "IMG" ? (t as HTMLImageElement) : null); }}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const c = cell();
              if (!c) return; // outside a table Tab moves on as usual
              e.preventDefault();
              const all = Array.from((c.closest("table") as HTMLTableElement).querySelectorAll("td,th"));
              const i = all.indexOf(c) + (e.shiftKey ? -1 : 1);
              if (i >= all.length) { addRow(true); return; }
              const next = all[i];
              if (!next) return;
              const r = document.createRange();
              r.selectNodeContents(next);
              r.collapse(true);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(r);
            }}
            onKeyUp={() => { if (body.current && !body.current.innerHTML.trim()) body.current.innerHTML = "<p><br></p>"; }}
          />
          <div className="doc-furniture foot" style={{ bottom: "8mm", left: `${L.margins.left}mm`, right: `${L.margins.right}mm` }} aria-hidden="true">
            <span>{footer}</span>
            {L.pageNumbers && <span>Page 1 of {pagesApprox}</span>}
          </div>
        </div>
      </div>
      <p className="muted doc-note">About {pagesApprox} page{pagesApprox === 1 ? "" : "s"}. Dashed lines show roughly where pages end; the preview shows the real page breaks.</p>
    </div>
  );
}
