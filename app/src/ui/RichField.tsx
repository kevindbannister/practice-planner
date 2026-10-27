// A small rich text editor for one piece of wording: bold, italic, underline, headings, bullets and numbers, and
// merge fields dropped in from a list. It reads and writes HTML that the document model understands (anything else is dropped).
import { useEffect, useRef, type CSSProperties } from "react";
import { parseHtml, toHtml } from "../lib/docModel";
import { asHtml } from "../lib/letterSections";

export function RichField({ label, value, onChange, disabled, fields, placeholder, minHeight = 110 }: {
  label: string; value: string; onChange: (html: string) => void; disabled?: boolean; fields?: [string, string][]; placeholder?: string; minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>("");
  const saved = useRef<Range | null>(null);
  // Only rewrite the editor when the value changed from outside, so typing never moves the cursor.
  useEffect(() => {
    const el = ref.current;
    if (!el || value === last.current) return;
    el.innerHTML = toHtml(parseHtml(asHtml(value)), false);
    last.current = value;
  }, [value]);
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = toHtml(parseHtml(el.innerHTML), false);
    last.current = html;
    onChange(html);
  };
  const remember = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange(); };
  const focusBack = () => {
    ref.current?.focus();
    if (saved.current) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(saved.current); }
  };
  const run = (cmd: string, arg?: string) => { if (disabled) return; focusBack(); document.execCommand(cmd, false, arg); emit(); };
  const insert = (name: string) => { if (disabled || !name) return; focusBack(); document.execCommand("insertText", false, `[${name}]`); emit(); };
  const btn = (t: string, title: string, f: () => void, style?: CSSProperties) => (
    <button type="button" className="tb" title={title} aria-label={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={f} style={style}>{t}</button>
  );
  return (
    <div className="richfield">
      <span className="richfield-label">{label}</span>
      <div className="docedit-bar" role="toolbar" aria-label={`Formatting for ${label}`}>
        {btn("B", "Bold", () => run("bold"), { fontWeight: 700 })}
        {btn("I", "Italic", () => run("italic"), { fontStyle: "italic" })}
        {btn("U", "Underline", () => run("underline"), { textDecoration: "underline" })}
        <span className="sep" />
        {btn("H", "Heading", () => run("formatBlock", "h3"))}
        {btn("¶", "Normal text", () => run("formatBlock", "p"))}
        {btn("•", "Bulleted list", () => run("insertUnorderedList"))}
        {btn("1.", "Numbered list", () => run("insertOrderedList"))}
        {fields && fields.length > 0 && (
          <select className="input" style={{ width: 170, minHeight: 34 }} aria-label={`Insert a merge field into ${label}`} disabled={disabled} value="" onMouseDown={remember} onFocus={remember} onChange={(e) => insert(e.target.value)}>
            <option value="">Insert field…</option>
            {fields.map(([k, d]) => <option key={k} value={k} title={d}>[{k}]</option>)}
          </select>
        )}
      </div>
      <div ref={ref} className="richfield-body" contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} data-placeholder={placeholder}
        style={{ minHeight }} onInput={emit} onBlur={emit} onKeyUp={remember} onMouseUp={remember}
        onFocus={() => { try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* not supported */ } }} />
    </div>
  );
}
