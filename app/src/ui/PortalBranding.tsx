// Portal > Branding: the practice's own look for the client portal, with a live preview.
// Everything is saved per practice on the portal server; nobody edits code to change it.
import { useEffect, useMemo, useRef, useState } from "react";
import { brandOf, displayName } from "../lib/docBranding";
import { BrandingOverview, StaffBranding } from "../lib/portalAdmin";
import { COLOUR_LABELS, Colours, DEFAULT_COLOURS, contrastChecks, fixColours, isHex } from "../portal/brand";
import { LogoError, prepareLogo } from "../lib/logo";
import { useDocs } from "./docsKit";
import { say, usePortal } from "./portalKit";

const PREVIEW_URL = "/portal?preview=1";
type Screen = "signin" | "home" | "email";

export function BrandingTab() {
  const portal = usePortal();
  const docs = useDocs();
  const [o, setO] = useState<BrandingOverview | null>(null);
  const [draft, setDraft] = useState<StaffBranding | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [email, setEmail] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);

  const load = () => portal.run((a) => a.branding()).then((r) => { setO(r); setDraft(r.branding); setErr(""); }).catch((e) => setErr(say(e)));
  useEffect(() => { void load(); }, []);

  const dirty = Boolean(o && draft && JSON.stringify(o.branding) !== JSON.stringify(draft));
  const checks = useMemo(() => (draft && (Object.values(draft.colours) as string[]).every(isHex) ? contrastChecks(draft.colours) : []), [draft]);
  const failing = checks.filter((c) => !c.pass);
  const hexBad = draft ? (Object.entries(draft.colours) as [keyof Colours, string][]).filter(([, v]) => !isHex(v)).map(([k]) => COLOUR_LABELS[k]) : [];

  // Send the draft to the preview frame whenever it changes (and when the frame asks).
  const push = () => {
    if (!draft || !frame.current?.contentWindow || screen === "email") return;
    const b = draft;
    frame.current.contentWindow.postMessage({ type: "px-brand-preview", screen, branding: { practiceName: b.practiceName, logo: b.logo, loginLogo: b.loginLogo || b.logo, colours: b.colours, welcome: b.welcome, contact: { phone: b.phone, address: b.address, hours: b.hours }, supportEmail: b.supportEmail } }, window.location.origin);
  };
  useEffect(() => { push(); }, [draft, screen, device]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "px-brand-ready") push(); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  });
  // The email's HTML is made by the server, so it is exactly what would be sent.
  useEffect(() => {
    if (screen !== "email" || !draft) return;
    const t = setTimeout(() => { portal.run((a) => a.emailPreview(draft)).then(setEmail).catch((e) => setErr(say(e))); }, 350);
    return () => clearTimeout(t);
  }, [screen, draft]);

  if (portal.status && !portal.status.configured) return null;
  if (!draft || !o) return err ? <p className="import-list warn" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  const set = (patch: Partial<StaffBranding>) => { setNote(""); setDraft({ ...draft, ...patch }); };
  const setColour = (k: keyof Colours, v: string) => set({ colours: { ...draft.colours, [k]: v } });
  const upload = async (key: "logo" | "loginLogo", f?: File) => {
    if (!f) return;
    setErr("");
    try { set({ [key]: await prepareLogo(f) } as Partial<StaffBranding>); } catch (e) { setErr(e instanceof LogoError ? e.message : "That picture couldn't be used."); }
  };
  const save = async () => {
    setBusy(true); setErr(""); setNote("");
    try { const r = await portal.run((a) => a.saveBranding(draft)); setO(r); setDraft(r.branding); setNote("Saved. Clients see the new look the next time they open the portal."); } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setErr(""); setNote(""); setConfirmReset(false);
    try { const r = await portal.run((a) => a.resetBranding()); setO(r); setDraft(r.branding); setNote("Restored to the standard look."); } catch (e) { setErr(say(e)); } finally { setBusy(false); }
  };
  const fromDocuments = () => {
    const b = brandOf(docs.set);
    set({ practiceName: displayName(b) || draft.practiceName, logo: b.logo && b.logo.length < 60000 ? b.logo : draft.logo, phone: b.phone || draft.phone, supportEmail: b.email || draft.supportEmail, address: b.correspondenceAddress || b.registeredAddress || draft.address, colours: { ...draft.colours, ...(isHex(b.primary) ? { primary: b.primary, button: b.primary } : {}) } });
    setNote("Filled in from your document branding. Check the colours below, then save.");
  };
  const text = (k: keyof StaffBranding, label: string, o2: { max?: number; rows?: number; type?: string; hint?: string } = {}) => (
    <label className="stack" style={{ gap: 4 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {o2.rows ? <textarea className="input" rows={o2.rows} maxLength={o2.max} value={String(draft[k])} onChange={(e) => set({ [k]: e.target.value } as Partial<StaffBranding>)} /> : <input className="input" type={o2.type || "text"} maxLength={o2.max} value={String(draft[k])} onChange={(e) => set({ [k]: e.target.value } as Partial<StaffBranding>)} />}
      {o2.hint && <span className="muted" style={{ fontSize: 13 }}>{o2.hint}</span>}
    </label>
  );
  const logoBox = (key: "logo" | "loginLogo", label: string, hint: string) => (
    <div className="stack" style={{ gap: 4 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {draft[key] && <img src={draft[key]} alt={`${label} preview`} style={{ maxHeight: 56, maxWidth: 240, objectFit: "contain", background: "#fff", border: "1px solid var(--line)", padding: 4 }} />}
      <div className="row-wrap">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={`Choose ${label.toLowerCase()}`} onChange={(e) => void upload(key, e.target.files?.[0])} />
        {draft[key] && <button type="button" className="btn small" onClick={() => set({ [key]: "" } as Partial<StaffBranding>)}>Remove</button>}
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{hint}</span>
    </div>
  );

  return (
    <div className="pt-brand">
      <div className="stack" style={{ minWidth: 0 }}>
        <section className="card pad stack" aria-labelledby="bd-h">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <h2 id="bd-h" style={{ margin: 0, fontSize: 16 }}>Portal branding</h2>
            <button type="button" className="btn small" onClick={fromDocuments}>Start from my document branding</button>
          </div>
          <p className="muted" style={{ margin: 0 }}>{o.saved ? `Saved ${o.updatedAt ? new Date(o.updatedAt).toLocaleDateString("en-GB") : ""}${o.updatedBy ? ` by ${o.updatedBy}` : ""}.` : "Nothing saved yet: clients see the standard look."} Changes show in the preview straight away and reach clients when you save.</p>
          {text("practiceName", "Practice name", { max: 80, hint: "Shown in the header, on the sign-in page and in emails." })}
          {logoBox("logo", "Practice logo", "Shown in the portal header and in emails. PNG, JPEG, WebP or SVG; it is shrunk to fit.")}
          {logoBox("loginLogo", "Sign-in page logo (optional)", "Leave empty to use the practice logo.")}
          {text("welcome", "Welcome message", { rows: 3, max: 600, hint: "Shown on the sign-in page and at the top of each client's home page. Plain text." })}
        </section>
        <section className="card pad stack" aria-labelledby="bc-h">
          <h2 id="bc-h" style={{ margin: 0, fontSize: 16 }}>Colours</h2>
          <div className="pt-colours">
            {(Object.keys(DEFAULT_COLOURS) as (keyof Colours)[]).map((k) => (
              <div key={k} className="stack" style={{ gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{COLOUR_LABELS[k]}</span>
                <div className="row-wrap" style={{ gap: 6 }}>
                  <input type="color" aria-label={`${COLOUR_LABELS[k]} picker`} value={isHex(draft.colours[k]) ? draft.colours[k] : "#000000"} onChange={(e) => setColour(k, e.target.value)} />
                  <input className="input" style={{ width: 100 }} aria-label={COLOUR_LABELS[k]} value={draft.colours[k]} maxLength={7} onChange={(e) => setColour(k, e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          <div className="stack" style={{ gap: 4 }} role="region" aria-label="Colour contrast checks">
            <strong>Readability checks</strong>
            {hexBad.length > 0 && <p className="import-list warn" role="alert" style={{ margin: 0 }}>Enter colours like #0f4c81: {hexBad.join(", ")}.</p>}
            {checks.map((c) => <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><span aria-hidden="true">{c.pass ? "✓" : "✕"}</span><span style={{ color: c.pass ? "inherit" : "var(--bad, #b42318)" }}>{c.pass ? "Pass" : "Too faint"}: {c.label} ({c.ratio}:1, needs {c.min}:1)</span></div>)}
            {failing.length > 0 && <div><button type="button" className="btn small" onClick={() => set({ colours: fixColours(draft.colours) })}>Fix colours automatically</button> <span className="muted" style={{ fontSize: 13 }}>Picks readable text colours and darkens colours that are too light.</span></div>}
          </div>
        </section>
        <section className="card pad stack" aria-labelledby="bk-h">
          <h2 id="bk-h" style={{ margin: 0, fontSize: 16 }}>Contact details and email</h2>
          {text("supportEmail", "Support email address", { type: "email", max: 120, hint: "Clients are shown it, and replies to portal emails go to it." })}
          {text("phone", "Telephone", { max: 40 })}
          {text("hours", "Opening hours", { max: 120 })}
          {text("address", "Address", { rows: 3, max: 300 })}
          {text("emailFooter", "Email footer", { rows: 2, max: 300, hint: "A line at the bottom of every portal email, for example your registration details. Contact details above are added too." })}
        </section>
        <div className="row-wrap" style={{ position: "sticky", bottom: 0, background: "var(--bg, #fff)", padding: "8px 0" }}>
          <button type="button" className="btn primary" disabled={busy || !dirty || failing.length > 0 || hexBad.length > 0} onClick={() => void save()}>Save branding</button>
          {dirty && <button type="button" className="btn" onClick={() => { setDraft(o.branding); setNote(""); }}>Discard changes</button>}
          {!confirmReset ? <button type="button" className="btn" disabled={busy || !o.saved} onClick={() => setConfirmReset(true)}>Restore defaults</button> : <><span>Go back to the standard look?</span><button type="button" className="btn" onClick={() => void reset()}>Yes, restore</button><button type="button" className="btn" onClick={() => setConfirmReset(false)}>Keep my branding</button></>}
        </div>
        {failing.length > 0 && <p className="import-list warn" role="status" style={{ margin: 0 }}>Saving is switched off until every readability check passes, so clients can always read the portal.</p>}
        {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
        {err && <p className="import-list warn" role="alert" style={{ margin: 0 }}>{err}</p>}
      </div>
      <aside className="stack pt-preview" aria-label="Live preview">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <div className="row-wrap" role="group" aria-label="Preview screen">
            {([["home", "Home page"], ["signin", "Sign-in page"], ["email", "Email"]] as [Screen, string][]).map(([k, l]) => <button key={k} type="button" className={`btn small${screen === k ? " primary" : ""}`} aria-pressed={screen === k} onClick={() => setScreen(k)}>{l}</button>)}
          </div>
          {screen !== "email" && (
            <div className="row-wrap" role="group" aria-label="Preview device">
              {([["desktop", "Desktop"], ["mobile", "Mobile"]] as ["desktop" | "mobile", string][]).map(([k, l]) => <button key={k} type="button" className={`btn small${device === k ? " primary" : ""}`} aria-pressed={device === k} onClick={() => setDevice(k)}>{l}</button>)}
            </div>
          )}
        </div>
        <div className="pt-frame-wrap">
          {screen === "email"
            ? <iframe title="Email preview" sandbox="" srcDoc={email} className="pt-frame" style={{ width: device === "mobile" ? 375 : "100%" }} />
            : <iframe ref={frame} title="Portal preview" src={PREVIEW_URL} className="pt-frame" style={{ width: device === "mobile" ? 375 : "100%" }} onLoad={push} />}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>The preview uses made-up sample data; no client information is shown.</p>
      </aside>
    </div>
  );
}
