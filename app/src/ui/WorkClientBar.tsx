// In Work mode, the client being worked on sits in a strip just below the navy menu bar, with quick ways to
// their page, working papers and tax return, and a way to switch to another client.
import { useState } from "react";
import { fmtDate } from "../lib/domain";
import { useData, useIndex } from "./data";
import { Icon, href } from "./bits";

/** Pages whose second part is a client key. */
const CLIENT_PAGES = new Set(["clients", "papers", "tax", "reporting", "advisory", "taxplan"]);

const readClient = (): string => { try { return localStorage.getItem("pp.work.client") || ""; } catch { return ""; } };
const keepClient = (k: string) => { try { localStorage.setItem("pp.work.client", k); } catch { /* this visit only */ } };
const hashParts = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });

type Lookup = { clientByKey: Map<string, unknown>; schemes: { Key?: unknown; ClientKey?: unknown }[] };

/** The client a page is about, if it is about one. */
function clientOfRoute(parts: string[], l: Lookup): string {
  const [section, a, b] = parts;
  if (CLIENT_PAGES.has(section) && a && l.clientByKey.has(a)) return a;
  if (section === "cosec" && a === "company" && b && l.clientByKey.has(b)) return b;
  if (section === "payroll" && a) { const s = l.schemes.find((x) => x.Key === a); if (s && l.clientByKey.has(String(s.ClientKey))) return String(s.ClientKey); }
  return "";
}

/** Where a menu item goes for a client: their working papers, tax return, Co Sec company, payroll scheme and so on. */
export function clientHref(module: string, clientKey: string, schemes: { Key?: unknown; ClientKey?: unknown }[]): string {
  if (!clientKey) return `#/${module}`;
  if (module === "clients" || CLIENT_PAGES.has(module)) return href(module, clientKey);
  if (module === "cosec") return href("cosec", "company", clientKey);
  if (module === "payroll") { const s = schemes.find((x) => x.ClientKey === clientKey); return s ? href("payroll", String(s.Key)) : "#/payroll"; }
  return `#/${module}`;
}

/** The client being worked on: the one on the page, or the one last chosen. */
export function useWorkClient(): string {
  const { data } = useData();
  const idx = useIndex();
  const fromRoute = clientOfRoute(hashParts(), { clientByKey: idx.clientByKey, schemes: data.payrollSchemes as never });
  if (fromRoute) keepClient(fromRoute);
  const key = fromRoute || readClient();
  return key && idx.clientByKey.has(key) ? key : "";
}

export function WorkClientBar({ section }: { section: string; routeKey?: string }) {
  const { data } = useData();
  const idx = useIndex();
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState("");
  const schemes = data.payrollSchemes as { Key?: unknown; ClientKey?: unknown }[];
  const fromRoute = clientOfRoute(hashParts(), { clientByKey: idx.clientByKey, schemes });
  const key = useWorkClient();
  const c = key ? idx.clientByKey.get(key) : undefined;

  const choose = (title: string) => {
    const found = data.clients.find((x) => x.Title.toLowerCase() === title.trim().toLowerCase());
    if (!found) return;
    keepClient(found.Key);
    setPicking(false);
    setText("");
    // stay on the same kind of page, for the new client (on Work home and other pages, stay where you are)
    if (fromRoute) window.location.hash = clientHref(section, found.Key, schemes);
    else window.dispatchEvent(new Event("pp-menu"));
  };

  const picker = (
    <form className="wc-pick" onSubmit={(e) => { e.preventDefault(); choose(text); }}>
      <label className="sr-only" htmlFor="wc-client">Client</label>
      <input id="wc-client" list="wc-clients" autoFocus={picking} placeholder="Type a client's name" value={text}
        onChange={(e) => { setText(e.target.value); if (data.clients.some((x) => x.Title === e.target.value)) choose(e.target.value); }} />
      <datalist id="wc-clients">{data.clients.filter((x) => x.Status !== "Former").map((x) => <option key={x.Key} value={x.Title} />)}</datalist>
      {c && <button type="button" className="btn small" onClick={() => setPicking(false)}>Cancel</button>}
    </form>
  );

  // on every page in Work (a client's working papers and tax return have this banner of their own, so it isn't shown twice)
  if (fromRoute && (section === "papers" || section === "tax" || section === "reporting")) return null;

  return (
    <header className="paper-top work-client" aria-label="Client you are working on">
      <a className="paper-top-icon" href={c ? href("clients", c.Key) : "#/clients"} title={c ? "Open the client page" : "All clients"} aria-label={c ? "Open the client page" : "All clients"}><Icon name="briefcase" size={20} /></a>
      {!c || picking ? (
        <>{!c && <strong className="wc-name">Choose a client to work on</strong>}{picker}</>
      ) : (
        <>
          <strong className="wc-name">{c.Title}</strong>
          {c.CompanyNumber && <span className="chip mono">{c.CompanyNumber}</span>}
          {c.YearEnd && <span className="chip">Year end: {fmtDate(`2000-${c.YearEnd}`, { year: false })}</span>}
          {c.Kind && <span className="chip">{c.Kind}</span>}
          <a className="chip blue chip-fixed" href={href("clients", c.Key)}>Client page</a>
          <div className="paper-tools">
            <a className="btn small paper-tool" href={clientHref("papers", c.Key, schemes)}>Working papers</a>
            <a className="btn small paper-tool" href={clientHref("tax", c.Key, schemes)}>Tax</a>
            <a className="btn small paper-tool" href={clientHref("payroll", c.Key, schemes)}>Payroll</a>
            <a className="btn small paper-tool" href={clientHref("cosec", c.Key, schemes)}>Co Sec</a>
            <button type="button" className="btn small paper-tool" onClick={() => setPicking(true)}>Change client</button>
          </div>
        </>
      )}
    </header>
  );
}
