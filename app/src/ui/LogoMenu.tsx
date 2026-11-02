// A client's logo as it is shown in the Freedom Plan banner and the client page, and the cog menu that
// adds, changes and resizes it. The picture is saved on the client's record (so it shows everywhere); the
// shape and size are a display choice saved in Settings, one per client.
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Client } from "../lib/domain";
import { LogoError, logoSrc, prepareLogo } from "../lib/logo";
import { LOGO_SIZE_KEY, LogoSize, MAX_SIZE, MIN_SIZE, DEFAULT_LOGO_SIZE, logoBox, logoSizeOf, readLogoSizes, withLogoSize } from "../lib/logoSize";
import { ClientBadge, Icon } from "./bits";
import { readSetting, useData } from "./data";

export const useLogoSize = (clientKey: string): LogoSize => {
  const { data } = useData();
  const all = useMemo(() => readLogoSizes(readSetting<unknown>(data.settings, LOGO_SIZE_KEY)), [data.settings]);
  return logoSizeOf(all, clientKey);
};

/** The logo in its chosen shape and size (or the client's initials when there is no logo). `preview` shows a size that isn't saved yet. */
export function ClientLogoMark({ client, preview }: { client: Client; preview?: LogoSize | null }) {
  const saved = useLogoSize(String(client.Key));
  const logo = logoSrc(client);
  if (!logo) return <ClientBadge client={client} size="lg" />;
  const box = logoBox(preview || saved);
  return <span className="logo-mark" style={{ width: box.width, height: box.height } as CSSProperties}><img src={logo} alt={`${client.Title} logo`} /></span>;
}

export function LogoMenu({ client, onPreview }: { client: Client; onPreview: (s: LogoSize | null) => void }) {
  const { data, update, saveSetting } = useData();
  const all = useMemo(() => readLogoSizes(readSetting<unknown>(data.settings, LOGO_SIZE_KEY)), [data.settings]);
  const saved = logoSizeOf(all, String(client.Key));
  const logo = logoSrc(client);
  const [menu, setMenu] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [draft, setDraft] = useState<LogoSize>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu && !resizing) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  });
  const close = () => { setMenu(false); setResizing(false); onPreview(null); };
  const change = (p: Partial<LogoSize>) => { const n = { ...draft, ...p }; setDraft(n); onPreview(n); };

  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true); setError(undefined);
    try { await update("Clients", client as never, { LogoData: await prepareLogo(f) }); setMenu(false); }
    catch (e) { setError(e instanceof LogoError ? e.message : "Couldn't save the logo. Try again."); }
    finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const save = async () => {
    setBusy(true); setError(undefined);
    try { await saveSetting(LOGO_SIZE_KEY, withLogoSize(all, String(client.Key), draft)); close(); }
    catch { setError("Couldn't save the size. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <div className="logo-menu" ref={root}>
      <button type="button" className="btn adv-bar-icon" aria-label="Logo options" aria-haspopup="menu" aria-expanded={menu || resizing} title="Logo options" onClick={() => { setDraft(saved); setResizing(false); onPreview(null); setMenu(!menu); }}>
        <Icon name="cog" size={20} />
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden aria-label={`Choose a logo for ${client.Title}`} onChange={(e) => void pick(e.target.files?.[0])} />
      {menu && !resizing && (
        <div className="logo-pop" role="menu" aria-label="Logo options">
          <button type="button" role="menuitem" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Saving…" : logo ? "Change logo" : "Add logo"}</button>
          {logo && <button type="button" role="menuitem" onClick={() => { setMenu(false); setResizing(true); setDraft(saved); onPreview(saved); }}>Resize logo</button>}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
      )}
      {resizing && (
        <div className="logo-pop logo-resize" role="dialog" aria-label="Resize logo">
          <strong>Resize logo</strong>
          <fieldset className="logo-shapes">
            <legend className="sr-only">Shape</legend>
            <label className={draft.shape === "square" ? "on" : ""}><input type="radio" name="logo-shape" checked={draft.shape === "square"} onChange={() => change({ shape: "square" })} /><span className="shape-sq" aria-hidden="true" /> Square</label>
            <label className={draft.shape === "rectangle" ? "on" : ""}><input type="radio" name="logo-shape" checked={draft.shape === "rectangle"} onChange={() => change({ shape: "rectangle" })} /><span className="shape-rect" aria-hidden="true" /> Rectangle</label>
          </fieldset>
          <label className="logo-range">Size
            <input type="range" min={MIN_SIZE} max={MAX_SIZE} step={2} value={draft.size} onChange={(e) => change({ size: Number(e.target.value) })} />
          </label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn primary small" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="btn small" onClick={close}>Cancel</button>
            <button type="button" className="linkbtn" onClick={() => change(DEFAULT_LOGO_SIZE)}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
