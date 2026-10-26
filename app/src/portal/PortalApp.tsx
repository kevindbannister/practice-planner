import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, Biz, Me, PortalClient } from "./api";
import { Config, idleGuard, signOut } from "./auth";
import { Documents } from "./Documents";
import { Dashboard } from "./Dashboard";
import { BusinessPage } from "./BusinessPage";
import { SecurityPage } from "./SecurityPage";

export type Ctx = { cfg: Config; api: PortalClient; me: Me; biz: Biz; go: (page: string) => void };

const PAGES: [string, string][] = [["dashboard", "Home"], ["documents", "Documents"], ["business", "My business"], ["security", "Security"]];
const IDLE_MINUTES = 30;

function usePage(): [string, (p: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/")[0] || "dashboard";
  const [page, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [page, (p) => { window.location.hash = `#/${p}`; }];
}

export function PortalApp({ cfg }: { cfg: Config }) {
  const out = useCallback((why: string) => signOut(cfg, why), [cfg]);
  const api = useMemo(() => new PortalClient(cfg, out), [cfg, out]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [bizKey, setBizKey] = useState(() => { try { return sessionStorage.getItem("px.biz") || ""; } catch { return ""; } });
  const [page, go] = usePage();

  useEffect(() => idleGuard(IDLE_MINUTES, () => out("You were signed out because the portal was idle for a while.")), [out]);
  useEffect(() => {
    api.me().then(setMe).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the portal."));
  }, [api]);

  if (error) return <Shell cfg={cfg} out={() => out("")}><main className="px-main"><p className="px-error" role="alert">{error}</p></main></Shell>;
  if (!me) return <Shell cfg={cfg} out={() => out("")}><main className="px-main"><p>Loading…</p></main></Shell>;

  const biz = me.businesses.find((b) => b.clientKey === bizKey) || me.businesses[0];
  if (!biz) {
    return (
      <Shell cfg={cfg} me={me} out={() => out("")}>
        <main className="px-main" aria-labelledby="aw-h">
          <section className="px-card">
            <h1 id="aw-h">You're registered</h1>
            <p>Thanks{me.user.name ? `, ${me.user.name.split(" ")[0]}` : ""}. You're signed in as <strong>{me.user.email}</strong>.</p>
            <p>{cfg.practiceName} hasn't given you access to a business yet. Once they have, it will appear here. You don't need to do anything else; if it's urgent, please contact them.</p>
          </section>
        </main>
      </Shell>
    );
  }
  const choose = (k: string) => { setBizKey(k); try { sessionStorage.setItem("px.biz", k); } catch { /* fine */ } };
  const ctx: Ctx = { cfg, api, me, biz, go };
  const pages = PAGES.filter(([k]) => k !== "documents" || biz.can["documents.view"]);
  const known = pages.some(([k]) => k === page);
  return (
    <Shell cfg={cfg} me={me} out={() => out("")} switcher={me.businesses.length > 1 ? <Switcher list={me.businesses} value={biz.clientKey} onChange={choose} /> : <span className="px-bizname">{biz.name}</span>}
      nav={pages.map(([k, label]) => <a key={k} href={`#/${k}`} aria-current={(known ? page : "dashboard") === k ? "page" : undefined}>{label}</a>)}>
      <main className="px-main" key={biz.clientKey}>
        {(!known || page === "dashboard") && <Dashboard ctx={ctx} />}
        {page === "documents" && known && <Documents ctx={ctx} />}
        {page === "business" && <BusinessPage ctx={ctx} />}
        {page === "security" && <SecurityPage ctx={ctx} />}
      </main>
    </Shell>
  );
}

function Switcher({ list, value, onChange }: { list: Biz[]; value: string; onChange: (k: string) => void }) {
  return (
    <label className="px-switch">
      <span className="px-sr">Business</span>
      <select aria-label="Business" value={value} onChange={(e) => onChange(e.target.value)}>{list.map((b) => <option key={b.clientKey} value={b.clientKey}>{b.name}</option>)}</select>
    </label>
  );
}

function Shell({ cfg, me, out, switcher, nav, children }: { cfg: Config; me?: Me; out: () => void; switcher?: ReactNode; nav?: ReactNode; children: ReactNode }) {
  return (
    <>
      <a className="px-skip" href="#px-main">Skip to content</a>
      <header className="px-header">
        <div className="px-header-in">
          <span className="px-brand">{cfg.practiceName}</span>
          {switcher}
          <span className="px-spacer" />
          {me && <span className="px-user">{me.user.name || me.user.email}</span>}
          {me && <button type="button" className="px-btn small ghost" onClick={out}>Sign out</button>}
        </div>
        {nav && <nav className="px-nav" aria-label="Portal">{nav}</nav>}
      </header>
      <div id="px-main">{children}</div>
      <footer className="px-footer">{cfg.practiceName} · secure client portal</footer>
    </>
  );
}
