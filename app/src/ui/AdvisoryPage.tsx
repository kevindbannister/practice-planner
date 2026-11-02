// Advisory: each advisory client's Freedom Plan. The home lists the clients who have one and how far
// their business is from the life they want; a client's page works through Freedom Number, Where you
// are now, Levers and Freedom Gap. Kevin-led for now: clients don't sign in to this.
import { useMemo, useState } from "react";
import { emptyPlan, gap, readPlan, writePlan } from "../lib/advisory";
import { Client, fmtDate } from "../lib/domain";
import { newKey } from "../lib/planning";
import { ClientLogoMark, LogoMenu } from "./LogoMenu";
import { LogoSize } from "../lib/logoSize";
import { ClientBadge, Icon, go, href, useRoute } from "./bits";
import { useData } from "./data";
import { SaveNote, gbp, gbpBr, pct, usePlan } from "./advisoryKit";
import { FreedomTab, GapTab, LeversTab, NowTab, Stat } from "./AdvisoryTabs";

const TABS = [
  { key: "freedom", label: "Freedom Number" },
  { key: "now", label: "Where you are now" },
  { key: "levers", label: "Levers" },
  { key: "gap", label: "Freedom Gap" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function AdvisoryPage() {
  const { parts } = useRoute();
  const clientKey = parts[1];
  if (!clientKey) return <AdvisoryHome />;
  const tab = (TABS.find((t) => t.key === parts[2])?.key || "freedom") as TabKey;
  return <AdvisoryClient key={clientKey} clientKey={clientKey} tab={tab} />;
}

function AdvisoryHome() {
  const { data, create } = useData();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clients = data.clients.filter((c) => c.Title);
  const byKey = useMemo(() => new Map(clients.map((c) => [String(c.Key), c])), [clients]);
  const plans = data.advisoryPlans
    .filter((r) => r.Kind === "plan" && byKey.has(String(r.ClientKey)))
    .map((r) => {
      const plan = readPlan(r.Json);
      return { row: r, client: byKey.get(String(r.ClientKey))!, g: gap(plan), why: plan.why };
    })
    .sort((a, b) => String(a.client.Title).localeCompare(String(b.client.Title)));
  const have = new Set(plans.map((p) => String(p.client.Key)));
  const available = clients.filter((c) => !have.has(String(c.Key))).sort((a, b) => String(a.Title).localeCompare(String(b.Title)));

  const start = async () => {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      const now = new Date().toISOString();
      await create("AdvisoryPlans", { Key: newKey("AP"), PracticeId: "", ClientKey: pick, Kind: "plan", Json: writePlan(emptyPlan()), Created: now, Updated: now, UpdatedBy: "" });
      go(href("advisory", pick));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The plan couldn't be started.");
      setBusy(false);
    }
  };

  return (
    <div className="page adv">
      <div className="page-head">
        <div>
          <h1>Freedom Plans</h1>
          <p className="muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>
            Works out what a client's life costs, what their business delivers today, and how far the numbers move if they change their prices, sales and costs.
          </p>
        </div>
      </div>

      <section className="card pad row-wrap" aria-label="Start a Freedom Plan" style={{ gap: 12 }}>
        <label className="field" style={{ flex: "1 1 280px", maxWidth: 420 }}>
          <span className="muted" style={{ fontSize: 12 }}>Start a Freedom Plan for</span>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a client…</option>
            {available.map((c) => <option key={String(c.Key)} value={String(c.Key)}>{String(c.Title)}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={!pick || busy} onClick={() => void start()} style={{ alignSelf: "flex-end" }}>{busy ? "Starting…" : "Start"}</button>
        {error && <span className="chip red" role="alert">{error}</span>}
      </section>

      {plans.length === 0 ? (
        <div className="alert"><strong>No Freedom Plans yet</strong><span>Choose a client above to start the first one.</span></div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Client</th><th scope="col" className="num">Freedom Number (5 years)</th><th scope="col" className="num">Business now</th>
                <th scope="col" className="num">With levers</th><th scope="col" className="num">Shortfall / (excess) with levers</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {plans.map(({ row, client, g, why }) => (
                <tr key={String(row.Key)}>
                  <td>
                    <a href={href("advisory", String(client.Key))} className="adv-client"><ClientBadge client={client as unknown as Client} /><span><strong>{String(client.Title)}</strong>{why && <span className="muted" style={{ display: "block", fontSize: 12 }}>“{why}”</span>}</span></a>
                  </td>
                  <td className="num mono">{g.total.need > 0 ? gbp(g.total.need) : "–"}</td>
                  <td className="num mono">{gbp(g.total.now)}{g.total.metNow !== undefined && <span className="muted"> · {pct(g.total.metNow)}</span>}</td>
                  <td className="num mono">{gbp(g.total.levers)}{g.total.metLevers !== undefined && <span className="muted"> · {pct(g.total.metLevers)}</span>}</td>
                  <td className="num mono">{g.total.need > 0 ? gbpBr(g.total.shortLevers) : "–"}</td>
                  <td>{fmtDate(String(row.Updated || "").slice(0, 10))}</td>
                  <td style={{ textAlign: "right" }}><a className="btn small" href={href("advisory", String(client.Key))}>Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdvisoryClient({ clientKey, tab }: { clientKey: string; tab: TabKey }) {
  const { data } = useData();
  const client = data.clients.find((c) => c.Key === clientKey);
  const s = usePlan(clientKey);
  const [preview, setPreview] = useState<LogoSize | null>(null);
  if (!client) {
    return (
      <div className="page adv">
        <div className="page-head"><h1>Client not found</h1></div>
        <p><a href={href("advisory")}>Back to Freedom Plans</a></p>
      </div>
    );
  }
  const { plan, edit } = s;
  const g = gap(plan);
  return (
    <div className="page adv">
      <header className="adv-bar">
        <div className="adv-bar-id">
          {/* the same logo as on the client's page: it is saved on the client's record, so adding it here adds it there */}
          <ClientLogoMark client={client as unknown as Client} preview={preview} />
          <div className="adv-bar-title">
            <span className="adv-kicker">Freedom Plan</span>
            <h1>{String(client.Title)}</h1>
          </div>
        </div>
        <div className="adv-bar-actions">
          <SaveNote s={s} />
          <LogoMenu client={client as unknown as Client} onPreview={setPreview} />
          <a className="btn adv-bar-icon" href={href("clients", clientKey)} aria-label="Client page" title="Client page"><Icon name="clients" size={20} /></a>
          <a className="btn adv-bar-icon" href={href("advisory")} aria-label="Leave Freedom Plan" title="Leave Freedom Plan (back to all Freedom Plans)"><Icon name="close" size={20} /></a>
        </div>
      </header>

      <label className="adv-why">
        <span>In their own words</span>
        <input className="input" value={plan.why} placeholder="Why this matters, e.g. “Mortgage gone by 55 and every Friday off”" onChange={(e) => edit((p) => ({ ...p, why: e.target.value }))} />
      </label>

      <div className="adv-stats card pad" aria-label="Where the plan stands">
        <Stat label="Freedom Number, 5 years" value={g.total.need > 0 ? gbp(g.total.need) : "–"} />
        <Stat label="Business now" value={`${gbp(g.total.now)}${g.total.metNow !== undefined ? ` · ${pct(g.total.metNow)}` : ""}`} />
        <Stat label="With the levers" value={`${gbp(g.total.levers)}${g.total.metLevers !== undefined ? ` · ${pct(g.total.metLevers)}` : ""}`} />
        <Stat label="Shortfall / (excess) with levers" value={g.total.need > 0 ? gbpBr(g.total.shortLevers) : "–"} strong tone={g.total.need > 0 ? (g.total.shortLevers > 0 ? "bad" : "good") : undefined} />
      </div>

      <nav className="tabs" aria-label="Freedom Plan steps">
        {TABS.map((t, i) => <a key={t.key} href={href("advisory", clientKey, t.key)} aria-current={tab === t.key ? "page" : undefined}><span className="adv-step">{i + 1}</span>{t.label}</a>)}
      </nav>

      {tab === "freedom" && <FreedomTab plan={plan} edit={edit} />}
      {tab === "now" && <NowTab plan={plan} edit={edit} />}
      {tab === "levers" && <LeversTab plan={plan} edit={edit} />}
      {tab === "gap" && <GapTab plan={plan} />}
    </div>
  );
}
