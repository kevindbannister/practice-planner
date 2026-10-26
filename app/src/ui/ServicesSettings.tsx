// Settings › Services & pricing: the catalogue proposals are built from, and the proposal wording and limits.
import { useEffect, useMemo, useState } from "react";
import { CLIENT_TYPES, CatalogueService, ClientType, FREQS, Freq, Pricing, VATS, Vat, catalogueChanges, catalogueIssues, freqLabel, gbp, pence, ProposalTemplate, serviceRow } from "../lib/proposals";
import { newKey } from "../lib/planning";
import { ruleFields } from "../lib/planning";
import { readBranding } from "../lib/docBranding";
import { useRoute } from "./bits";
import { useData } from "./data";
import { useSales } from "./salesKit";

const blank = (key: string, name: string): CatalogueService => ({
  key, name, code: key, category: "", description: "", clientDescription: "", types: [], price: 0, frequency: "annual", vat: "standard", setupFee: 0, scope: "", exclusions: "", clientResp: "", practiceResp: "", clauses: "", pricing: {}, offered: true, active: true,
});

export function ServicesSettings() {
  const s = useSales();
  const { data, create, updateMany } = useData();
  const { query } = useRoute();
  const allowed = s.pcan("configure");
  const items = useMemo(() => [...s.catalogue].sort((a, b) => Number(b.offered) - Number(a.offered) || a.name.localeCompare(b.name)), [s.catalogue]);
  const selectedKey = query.get("service") || items[0]?.key || "";
  const current = items.find((x) => x.key === selectedKey);
  const [f, setF] = useState<CatalogueService | undefined>(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [adding, setAdding] = useState("");
  useEffect(() => { setF(current); setMsg(undefined); }, [selectedKey, data.services]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (k: string) => (window.location.hash = `/settings/services?service=${encodeURIComponent(k)}`);
  const set = <K extends keyof CatalogueService>(k: K, v: CatalogueService[K]) => f && setF({ ...f, [k]: v });
  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20) + "_" + newKey("").slice(-4);
    await create("Services", { Key: key, Title: name, ...ruleFields({ repeatMonths: 12, deadline: "gap", months: 0, days: 0, keepMonthEnd: true }), ...serviceRow(blank(key, name)) });
    setAdding("");
    pick(key);
  };
  const save = async () => {
    if (!f || !current) return;
    const problems = catalogueIssues(f);
    if (problems.length) { setMsg({ ok: false, text: problems[0] }); return; }
    const row = data.services.find((r) => r.Key === f.key);
    if (!row) return;
    try {
      await updateMany("Services", [{ row, patch: { Title: f.name.trim(), ...serviceRow(f) } }]);
      for (const l of catalogueChanges(current, f, s.ctx())) await create("SalesLog", l);
      setMsg({ ok: true, text: "Saved." });
    } catch { setMsg({ ok: false, text: "That didn't save. Try again." }); }
  };
  const setPricing = (t: ClientType, patch: { price?: number | undefined; frequency?: Freq | undefined }) => {
    if (!f) return;
    const next: Pricing = { ...f.pricing, [t]: { ...f.pricing[t], ...patch } };
    const e = next[t]!;
    if (e.price === undefined && !e.frequency) delete next[t];
    set("pricing", next);
  };

  if (!allowed) return <div className="card" style={{ padding: 16 }}><p style={{ margin: 0 }}>Only managers, partners and owners can change services and prices.</p></div>;
  return (
    <>
      <div className="cols">
        <aside className="card" style={{ flex: "1 1 280px", maxWidth: 340 }} aria-label="Services">
          <ul className="type-list">
            {items.map((x) => (
              <li key={x.key}>
                <a href={`#/settings/services?service=${encodeURIComponent(x.key)}`} aria-current={x.key === selectedKey ? "true" : undefined}>
                  <span style={{ fontWeight: 600 }}>{x.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{x.offered ? `${x.price ? gbp(pence(x.price)) : "No price"} · ${freqLabel(x.frequency).toLowerCase()}` : "Not offered in proposals"}{x.active ? "" : " · inactive"}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="row-wrap" style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
            <label style={{ flex: "1 1 160px" }}><span className="sr-only">New service</span><input className="input" placeholder="New service name" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
            <button type="button" className="btn" onClick={add} disabled={!adding.trim()}>Add</button>
          </div>
        </aside>
        {f && current ? (
          <section className="card pad stack" style={{ flex: "2 1 460px" }} aria-label={`${current.name} settings`}>
            <h2 style={{ margin: 0 }}>{current.name}</h2>
            <p className="muted" style={{ margin: 0 }}>This is also a type of work in the planner. Its repeat and deadline rules are under Types of work; this page is what a proposal says and charges.</p>
            <div className="row-wrap" style={{ gap: 16 }}>
              <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={f.offered} onChange={(e) => set("offered", e.target.checked)} /> Offer in proposals</label>
              <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Active</label>
            </div>
            <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
              <label className="doc-field"><span>Service name</span><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
              <label className="doc-field"><span>Internal code</span><input className="input" value={f.code} onChange={(e) => set("code", e.target.value)} /></label>
              <label className="doc-field"><span>Category</span><input className="input" value={f.category} placeholder="e.g. Compliance" onChange={(e) => set("category", e.target.value)} /></label>
              <label className="doc-field"><span>Default price (£, excluding VAT)</span><input className="input" inputMode="decimal" value={String(f.price)} onChange={(e) => set("price", Number(e.target.value) || 0)} /></label>
              <label className="doc-field"><span>Charged</span><select className="input" value={f.frequency} onChange={(e) => set("frequency", e.target.value as Freq)}>{FREQS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="doc-field"><span>VAT</span><select className="input" value={f.vat} onChange={(e) => set("vat", e.target.value as Vat)}>{VATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="doc-field"><span>Set-up fee (£, optional)</span><input className="input" inputMode="decimal" value={String(f.setupFee)} onChange={(e) => set("setupFee", Number(e.target.value) || 0)} /></label>
            </div>
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
              <legend>Types of client it applies to</legend>
              <p className="muted" style={{ margin: "0 0 8px" }}>Leave all unticked for every type. Give a type its own price or frequency if it differs.</p>
              {CLIENT_TYPES.map(([t, label]) => (
                <div key={t} className="row-wrap" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <label className="row-wrap" style={{ gap: 6, width: 170 }}><input type="checkbox" checked={f.types.includes(t)} onChange={(e) => set("types", e.target.checked ? [...f.types, t] : f.types.filter((x) => x !== t))} /> {label}</label>
                  <input className="input" style={{ width: 130 }} inputMode="decimal" aria-label={`${label} price`} placeholder={`£${f.price} (default)`} value={f.pricing[t]?.price ?? ""} onChange={(e) => setPricing(t, { price: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  <select className="input" style={{ width: 170 }} aria-label={`${label} frequency`} value={f.pricing[t]?.frequency || ""} onChange={(e) => setPricing(t, { frequency: (e.target.value || undefined) as Freq | undefined })}>
                    <option value="">Default frequency</option>{FREQS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              ))}
            </fieldset>
            <label className="doc-field"><span>Description (internal)</span><textarea className="input" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
            <label className="doc-field"><span>What the client reads</span><textarea className="input" rows={3} value={f.clientDescription} onChange={(e) => set("clientDescription", e.target.value)} /></label>
            <label className="doc-field"><span>Scope: what's included (one per line)</span><textarea className="input" rows={4} value={f.scope} onChange={(e) => set("scope", e.target.value)} /></label>
            <label className="doc-field"><span>Exclusions (one per line)</span><textarea className="input" rows={3} value={f.exclusions} onChange={(e) => set("exclusions", e.target.value)} /></label>
            <label className="doc-field"><span>Client responsibilities (one per line)</span><textarea className="input" rows={3} value={f.clientResp} onChange={(e) => set("clientResp", e.target.value)} /></label>
            <label className="doc-field"><span>Our responsibilities (one per line)</span><textarea className="input" rows={3} value={f.practiceResp} onChange={(e) => set("practiceResp", e.target.value)} /></label>
            <label className="doc-field"><span>Engagement clauses to include later (names or notes)</span><textarea className="input" rows={2} value={f.clauses} onChange={(e) => set("clauses", e.target.value)} /></label>
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <button type="button" className="btn primary" onClick={save}>Save</button>
              {msg && <span role={msg.ok ? "status" : "alert"} style={{ color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</span>}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Every change to a price, VAT treatment or whether it's offered is kept in the sales audit trail. Changing a price here never changes a proposal already written.</p>
          </section>
        ) : <div className="card empty"><p>No services yet. Add one on the left.</p></div>}
      </div>
      <ProposalSettings />
    </>
  );
}

function ProposalSettings() {
  const s = useSales();
  const { data, saveSetting } = useData();
  const brands = readBranding(data.settings).profiles;
  const [t, setT] = useState<ProposalTemplate>(s.template);
  const [vat, setVat] = useState(String(Math.round(s.vatRate * 1000) / 10));
  const [limit, setLimit] = useState(String(s.discountLimit));
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const set = <K extends keyof ProposalTemplate>(k: K, v: ProposalTemplate[K]) => setT({ ...t, [k]: v });
  const save = async () => {
    const v = Number(vat), l = Number(limit);
    if (!(v >= 0 && v <= 100)) { setMsg({ ok: false, text: "The VAT rate should be between 0 and 100." }); return; }
    if (!(l >= 0 && l <= 100)) { setMsg({ ok: false, text: "The discount limit should be between 0 and 100." }); return; }
    try {
      await saveSetting("proposal.template", t);
      await saveSetting("sales.vatRate", v / 100);
      await saveSetting("sales.discountLimit", l);
      setMsg({ ok: true, text: "Saved." });
    } catch { setMsg({ ok: false, text: "That didn't save. Try again." }); }
  };
  return (
    <section className="card pad stack" style={{ marginTop: 16 }} aria-label="Proposal layout and limits">
      <h2 style={{ margin: 0 }}>Proposal layout and limits</h2>
      <p className="muted" style={{ margin: 0 }}>Logo, colours and fonts come from your document branding. You can use {"{{client}}"}, {"{{practice}}"}, {"{{contact}}"}, {"{{validUntil}}"}, {"{{startDate}}"}, {"{{reference}}"} and {"{{date}}"} in the wording.</p>
      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        <label className="doc-field"><span>Branding</span><select className="input" value={t.brandingId} onChange={(e) => set("brandingId", e.target.value)}><option value="">Your default</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name || b.practiceName || b.id}</option>)}</select></label>
        <label className="doc-field"><span>VAT rate (%)</span><input className="input" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} /></label>
        <label className="doc-field"><span>Discount a manager can give without a partner (%)</span><input className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
      </div>
      <div className="row-wrap" style={{ gap: 16 }}>
        <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={t.coverPage} onChange={(e) => set("coverPage", e.target.checked)} /> Cover page</label>
        <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={t.showScope} onChange={(e) => set("showScope", e.target.checked)} /> Show scope and exclusions</label>
        <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={t.showResponsibilities} onChange={(e) => set("showResponsibilities", e.target.checked)} /> Show responsibilities</label>
      </div>
      {([["introduction", "Introduction"], ["about", "About the practice"], ["terms", "Terms"], ["acceptanceText", "Acceptance wording"], ["closing", "Closing line"]] as [keyof ProposalTemplate, string][]).map(([k, label]) => (
        <label key={k} className="doc-field"><span>{label}</span><textarea className="input" rows={k === "closing" ? 2 : 4} value={String(t[k])} onChange={(e) => set(k, e.target.value as never)} /></label>
      ))}
      <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn primary" onClick={save}>Save</button>
        {msg && <span role={msg.ok ? "status" : "alert"} style={{ color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</span>}
      </div>
    </section>
  );
}

