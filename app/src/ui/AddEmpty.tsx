// An empty field on the client page: a dash and a small + (the size and style of the copy icon). The + opens an input in place
// of the dash; Enter or Save stores it, Escape or Cancel closes it. One field, or several that belong together (a first and last
// name). The "Needs attention" strip can open one from elsewhere with the pp-add-field event.
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { Client } from "../lib/domain";
import { Icon } from "./bits";
import { useData } from "./data";

export type AddKind = "text" | "email" | "tel" | "date";

/** Ask whichever AddEmpty holds this field to open (and scroll to it). */
export const openAddField = (field: string) => window.dispatchEvent(new CustomEvent("pp-add-field", { detail: { field } }));

export function AddEmpty({ client, fields, label, kind = "text", check }: {
  client: Client;
  /** [column, label] for each value the input collects. */
  fields: [string, string][];
  /** What the + says it adds, e.g. "VAT number". */
  label: string;
  kind?: AddKind;
  /** A format hint for a value, shown while typing (it never stops the save). */
  check?: (column: string, value: string) => string | undefined;
}) {
  const { update } = useData();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  const keys = fields.map(([k]) => k).join("|");

  useEffect(() => {
    const on = (e: Event) => {
      const f = (e as CustomEvent<{ field: string }>).detail?.field;
      if (!f || !fields.some(([k]) => k === f)) return;
      setOpen(true); setDraft({}); setError("");
      window.setTimeout(() => root.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
    };
    window.addEventListener("pp-add-field", on);
    return () => window.removeEventListener("pp-add-field", on);
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOpen(false); setDraft({}); setError(""); };
  const save = async () => {
    const patch: Record<string, string> = {};
    for (const [k] of fields) { const v = (draft[k] || "").trim(); if (v) patch[k] = v; }
    if (!Object.keys(patch).length) return;
    setBusy(true); setError("");
    try { await update("Clients", client, patch); close(); } catch { setError("Couldn't save that. Try again."); } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") close();
  };

  if (!open) {
    return (
      <span className="copy-val" ref={root}>
        <span style={{ color: "var(--muted)", fontFamily: "var(--sans)" }}>—</span>
        <button type="button" className="copybtn" onClick={() => { setOpen(true); setDraft({}); setError(""); }} aria-label={`Add ${label}`} title={`Add ${label}`}><Icon name="plus" size={13} /></button>
      </span>
    );
  }
  const filled = fields.some(([k]) => (draft[k] || "").trim());
  return (
    <span className="copy-val add-empty" ref={root} style={{ flexWrap: "wrap", gap: 6, justifyContent: "flex-start", flex: "1 1 100%" }}>
      {fields.map(([k, l], i) => {
        const hint = check?.(k, draft[k] || "");
        return (
          <span key={k} style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 100%", minWidth: 0 }}>
            <input className={`input${kind === "tel" ? " mono" : ""}`} type={kind} autoFocus={i === 0} aria-label={fields.length > 1 ? `${label}: ${l}` : `Add ${label}`} placeholder={fields.length > 1 ? l : undefined}
              value={draft[k] || ""} style={{ minHeight: 32, padding: "2px 8px", minWidth: 0 }} aria-invalid={hint ? true : undefined}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} onKeyDown={onKey} />
            {hint && <span className="muted" style={{ fontSize: 13, color: "var(--amber-ink)" }}>{hint} You can still save it.</span>}
          </span>
        );
      })}
      <span className="row-wrap" style={{ gap: 6 }}>
        <button type="button" className="btn small primary" disabled={busy || !filled} onClick={() => void save()}>Save</button>
        <button type="button" className="btn small" disabled={busy} onClick={close}>Cancel</button>
      </span>
      {error && <span className="error-text" role="alert" style={{ flexBasis: "100%" }}>{error}</span>}
    </span>
  );
}
