// In Work mode, the client being worked on sits in a strip just below the navy menu bar, with quick ways to
// their page, working papers and tax return, and a way to switch to another client.
import { useState } from "react";
import { fmtDate } from "../lib/domain";
import { useData, useIndex } from "./data";
import { Icon, href } from "./bits";

/** Pages whose second part is a client key. */
const CLIENT_PAGES = new Set(["clients", "papers", "tax", "reporting", "advisory", "taxplan", "payroll", "cosec"]);

const readClient = (): string => { try { return localStorage.getItem("pp.work.client") || ""; } catch { return ""; } };
const keepClient = (k: string) => { try { localStorage.setItem("pp.work.client", k); } catch { /* this visit only */ } };

export function WorkClientBar({ section, routeKey }: { section: string; routeKey?: string }) {
  const { data } = useData();
  const idx = useIndex();
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState("");
  // the client on the page you are on, or the one you last worked on
  const fromRoute = CLIENT_PAGES.has(section) && routeKey && idx.clientByKey.has(routeKey) ? routeKey : "";
  if (fromRoute) keepClient(fromRoute);
  const key = fromRoute || readClient();
  const c = key ? idx.clientByKey.get(key) : undefined;

  const choose = (title: string) => {
    const found = data.clients.find((x) => x.Title.toLowerCase() === title.trim().toLowerCase());
    if (!found) return;
    keepClient(found.Key);
    setPicking(false);
    setText("");
    // stay on the same kind of page, for the new client
    const target = CLIENT_PAGES.has(section) && section !== "clients" ? href(section, found.Key) : href("clients", found.Key);
    window.location.hash = target;
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

  // working papers, tax returns and reports already have this banner of their own
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
            <a className="btn small paper-tool" href={href("papers", c.Key)}>Working papers</a>
            <a className="btn small paper-tool" href={href("tax", c.Key)}>Tax</a>
            <button type="button" className="btn small paper-tool" onClick={() => setPicking(true)}>Change client</button>
          </div>
        </>
      )}
    </header>
  );
}
