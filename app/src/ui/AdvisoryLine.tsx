// The white line under Advisory's purple bar. It works like the Practice and Work lines: the page's name on the left, then on a
// client's pages the client (with a way to change it) and quick links to that client's other Advisory pages, and on the
// overview the two ways to start a plan.
import { useState } from "react";
import { fmtDate } from "../lib/domain";
import { useData } from "./data";
import { Icon, MoreMenu, href, type IconName } from "./bits";
import { clientHref, useWorkClient } from "./WorkClientBar";

const CLIENT_SECTIONS = ["reporting", "advisory", "taxplan"] as const;
const LINKS: [string, string][] = [["reporting", "Reporting"], ["advisory", "Freedom Plans"], ["taxplan", "Tax planning"]];

export function AdvisoryLine({ section, icon, title }: { section: string; icon: IconName; title: string }) {
  const { data } = useData();
  const key = useWorkClient();
  const [text, setText] = useState("");
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const c = key ? data.clients.find((x) => x.Key === key) : undefined;
  const clientPage = (CLIENT_SECTIONS as readonly string[]).includes(section);
  // a client's Reporting page has a banner of its own (as working papers and tax returns do in Work), so the line stays just the name
  const ownBanner = section === "reporting" && !!parts[1];

  const choose = (name: string) => {
    const found = data.clients.find((x) => x.Title.toLowerCase() === name.trim().toLowerCase());
    if (!found) return;
    setText("");
    window.location.hash = clientHref(section, found.Key, []);
  };

  if (section === "advisory-overview") {
    return (
      <>
        <span className="page-tabs-name"><Icon name={icon} size={20} />{title}</span>
        <div className="paper-tools advl-tools">
          <a className="btn small primary" href="#/advisory">Start a Freedom Plan</a>
          <a className="btn small" href="#/taxplan">Start a tax plan</a>
        </div>
      </>
    );
  }
  if (!clientPage || ownBanner) return <span className="page-tabs-name"><Icon name={icon} size={20} />{title}</span>;
  return (
    <>
      <span className="page-tabs-name"><Icon name={icon} size={20} />{title}</span>
      {c && <a className="chip blue chip-fixed" href={href("clients", c.Key)} title="Open the client page">{c.Title}</a>}
      {c && c.YearEnd && <span className="chip lg-only">Year end: {fmtDate(`2000-${c.YearEnd}`, { year: false })}</span>}
      <form className="wc-pick advl-pick" onSubmit={(e) => { e.preventDefault(); choose(text); }}>
        <label className="sr-only" htmlFor="adv-client">Client</label>
        <input id="adv-client" list="adv-clients" placeholder={c ? "Change client" : "Choose a client"} value={text}
          onChange={(e) => { setText(e.target.value); if (data.clients.some((x) => x.Title === e.target.value)) choose(e.target.value); }} />
        <datalist id="adv-clients">{data.clients.filter((x) => x.Status !== "Former").map((x) => <option key={x.Key} value={x.Title} />)}</datalist>
      </form>
      {c && (
        <div className="paper-tools advl-tools">
          {LINKS.map(([k, label]) => <a key={k} className="btn small paper-tool advl-link" href={clientHref(k, c.Key, [])} aria-current={section === k ? "page" : undefined}>{label}</a>)}
          <MoreMenu className="wc-more" label="Go to" items={LINKS.map(([k, label]) => ({ label, href: clientHref(k, c.Key, []), current: section === k }))} />
        </div>
      )}
    </>
  );
}
