// Settings, in three tabs: your working week; types of work (how each repeats, when it's
// due, default hours and its stages); and Companies House checks.
import { useEffect, useState } from "react";
import { fmtDate, fmtHours } from "../lib/domain";
import {
  BUILT_IN_RULES, DEFAULT_HOURS, Hours, Rule, deadlineByRule, describeRule, newKey, nextPeriod, ruleFields, ruleFor,
} from "../lib/planning";
import { Row } from "../lib/schema";
import { href, useRoute } from "./bits";
import { useData, useIndex } from "./data";
import { SelectField } from "./Editors";
import { CompaniesHouseSettings } from "./CompaniesHouse";
import { BackupSettings } from "./Backups";
import { ThemeChoice, useTheme } from "./theme";
import { signOut } from "../lib/auth";

declare const __DEMO__: boolean;

const DAYS: [keyof Hours, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"]];
const TABS: [string, string][] = [
  ["week", "Your week"], ["work", "Types of work"], ["companies-house", "Companies House"], ["backups", "Backups"],
];

export function SettingsPage() {
  const { parts } = useRoute();
  const tab = TABS.some(([k]) => k === parts[1]) ? parts[1] : "week";
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(([k, label]) => (
          <a key={k} href={href("settings", k)} aria-current={tab === k ? "page" : undefined}>{label}</a>
        ))}
      </nav>
      {tab === "week" && <HoursCard />}
      {tab === "week" && <AppearanceCard />}
      {tab === "work" && <TypesOfWork />}
      {tab === "companies-house" && <CompaniesHouseSettings />}
      {tab === "backups" && <BackupSettings />}
    </div>
  );
}

// ------------------------------------------------------------------ your week

function HoursCard() {
  const { settings, saveSetting } = useData();
  const [hours, setHours] = useState<Hours>(settings.hours);
  const [tight, setTight] = useState(String(settings.tightDays));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const changed = JSON.stringify(hours) !== JSON.stringify(settings.hours) || Number(tight) !== settings.tightDays;

  const save = async () => {
    setState("saving");
    try {
      await saveSetting("hours", hours);
      await saveSetting("tightDays", Math.max(1, Math.round(Number(tight) || 21)));
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="hours-h" style={{ maxWidth: 560 }}>
      <h2 id="hours-h">Your week</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Hours you can give to client work each day. 9:00 to 17:30 with an hour for lunch is 7.5.
      </p>
      <div className="form" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {DAYS.map(([k, label]) => (
          <label key={k}>
            {label}
            <input className="input" type="number" step="0.25" min="0" max="24" value={hours[k]}
              onChange={(e) => setHours({ ...hours, [k]: Number(e.target.value) })} />
          </label>
        ))}
        <label>
          "Tight" means planned within (days)
          <input className="input" type="number" min="1" max="120" value={tight} onChange={(e) => setTight(e.target.value)} />
        </label>
      </div>
      <div className="form-actions" style={{ alignItems: "center" }}>
        {state === "saved" && !changed && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
        {state === "error" && <span className="error-text">Couldn't save</span>}
        <button type="button" className="btn primary" onClick={save} disabled={!changed || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function AppearanceCard() {
  const { choice, set } = useTheme();
  const { user } = useData();
  const options: [ThemeChoice, string][] = [["system", "Match this device"], ["light", "Light"], ["dark", "Dark"]];
  return (
    <section className="card pad stack" aria-labelledby="look-h" style={{ maxWidth: 560 }}>
      <h2 id="look-h">Appearance and account</h2>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }} id="look-l">Light or dark (remembered on this device)</span>
        <div className="seg" role="group" aria-labelledby="look-l" style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
          {options.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={choice === k} onClick={() => set(k)}>{label}</button>
          ))}
        </div>
      </div>
      {!__DEMO__ && (
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span style={{ fontSize: 14 }}>Signed in{user ? ` as ${user}` : ""}</span>
          <button type="button" className="btn small" onClick={signOut}>Sign out</button>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ types of work

function TypesOfWork() {
  const { data, create } = useData();
  const idx = useIndex();
  const { query } = useRoute();
  const services = data.services.filter((s) => s.Key !== "TASK").sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const selectedKey = query.get("type") || (services.find((s) => s.Key === "ACCS_LTD")?.Key as string) || (services[0]?.Key as string);
  const selected = services.find((s) => s.Key === selectedKey);
  const [adding, setAdding] = useState("");
  const select = (key: string) => (window.location.hash = `/settings/work?type=${encodeURIComponent(key)}`);

  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20) + "_" + newKey("").slice(-4);
    await create("Services", { Key: key, Title: name, ...ruleFields({ repeatMonths: 12, deadline: "gap", months: 0, days: 0, keepMonthEnd: true }) });
    setAdding("");
    select(key);
  };

  return (
    <div className="cols">
      <aside className="card" style={{ flex: "1 1 280px", maxWidth: 340 }} aria-label="Types of work">
        <ul className="type-list">
          {services.map((s) => {
            const open = idx.openJobs.filter((j) => j.ServiceKey === s.Key).length;
            return (
              <li key={s.Key as string}>
                <a href={`#/settings/work?type=${encodeURIComponent(s.Key as string)}`} aria-current={s.Key === selectedKey ? "true" : undefined}>
                  <span style={{ fontWeight: 600 }}>{s.Title as string}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {describeRule(ruleFor(s.Key as string, data.services)).split(" · ")[0]}
                    {open ? ` · ${open} open` : ""}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="row-wrap" style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
          <label style={{ flex: "1 1 160px" }}>
            <span className="sr-only">New type of work</span>
            <input className="input" placeholder="New type of work" value={adding} onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
          <button type="button" className="btn" onClick={add} disabled={!adding.trim()}>Add</button>
        </div>
      </aside>
      <div className="col-main">
        {selected ? (
          <>
            <RuleCard key={selected.Key as string} service={selected} />
            <StagesCard key={`st-${selected.Key}`} service={selected.Key as string} />
          </>
        ) : (
          <div className="card empty">Choose a type of work.</div>
        )}
      </div>
    </div>
  );
}

const REPEATS: [number, string][] = [[0, "One-off (doesn't repeat)"], [1, "Monthly"], [3, "Quarterly"], [6, "Every 6 months"], [12, "Yearly"]];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function RuleCard({ service: s }: { service: Row }) {
  const { data, update } = useData();
  const idx = useIndex();
  const saved = ruleFor(s.Key as string, data.services);
  const builtIn = BUILT_IN_RULES[s.Key as string];
  const [name, setName] = useState(String(s.Title || ""));
  const [rule, setRule] = useState<Rule>(saved);
  const [hours, setHours] = useState(s.DefaultHours !== undefined ? String(s.DefaultHours) : "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => setState("idle"), [rule, name, hours]);

  const fixedMonth = Number((rule.fixed || "01-31").split("-")[0]);
  const fixedDay = Number((rule.fixed || "01-31").split("-")[1]);
  const set = (patch: Partial<Rule>) => setRule((r) => ({ ...r, ...patch }));
  const changed =
    JSON.stringify(ruleFields(rule)) !== JSON.stringify(ruleFields(saved)) ||
    name.trim() !== s.Title ||
    hours !== (s.DefaultHours !== undefined ? String(s.DefaultHours) : "");

  // worked example from a real open job where there is one
  const today = Date.now();
  const sampleJob = idx.openJobs
    .filter((j) => j.ServiceKey === s.Key && j.PeriodEnd)
    .sort((a, b) => Math.abs(Date.parse(a.PeriodEnd!) - today) - Math.abs(Date.parse(b.PeriodEnd!) - today))[0];
  const samplePe = sampleJob?.PeriodEnd || (rule.repeatMonths === 1 ? "2026-10-31" : "2026-03-31");
  const sampleGap = sampleJob?.Deadline && sampleJob.PeriodEnd
    ? Math.round((Date.parse(sampleJob.Deadline) - Date.parse(sampleJob.PeriodEnd)) / 86400000) : 0;
  const sampleDeadline = rule.deadline === "gap" && sampleJob?.Deadline ? sampleJob.Deadline : deadlineByRule(rule, samplePe, sampleGap);
  const next = nextPeriod(rule, samplePe, sampleDeadline);
  const openCount = idx.openJobs.filter((j) => j.ServiceKey === s.Key).length;

  const save = async () => {
    setState("saving");
    try {
      await update("Services", s, {
        ...ruleFields(rule),
        ...(name.trim() && name.trim() !== s.Title ? { Title: name.trim() } : {}),
        DefaultHours: hours === "" ? ("" as any) : Number(hours),
      });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="rule-h">
      <h2 id="rule-h">{s.Title as string}</h2>
      <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <label style={{ gridColumn: "1 / -1" }}>
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <SelectField label="Repeats" value={String(rule.repeatMonths)} onChange={(v) => set({ repeatMonths: Number(v) })}>
          {REPEATS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          {!REPEATS.some(([m]) => m === rule.repeatMonths) && <option value={rule.repeatMonths}>Every {rule.repeatMonths} months</option>}
        </SelectField>
        <label>
          Your hours per job (default {fmtHours(DEFAULT_HOURS[s.Key as string] ?? 1)})
          <input className="input" type="number" step="0.25" min="0" value={hours} placeholder={String(DEFAULT_HOURS[s.Key as string] ?? 1)}
            onChange={(e) => setHours(e.target.value)} />
        </label>
      </div>

      {rule.repeatMonths > 0 && (
        <fieldset className="fieldset">
          <legend>When it's due</legend>
          <label className="radio">
            <input type="radio" name="deadline" checked={rule.deadline === "after"} onChange={() => set({ deadline: "after" })} />
            <span>A set time after the period end</span>
          </label>
          {rule.deadline === "after" && (
            <div className="row-wrap" style={{ paddingLeft: 30 }}>
              <label className="inline-num">
                <input className="input" type="number" min="0" max="36" value={rule.months} onChange={(e) => set({ months: Number(e.target.value) })} aria-label="Months after period end" />
                months
              </label>
              <span className="muted">and</span>
              <label className="inline-num">
                <input className="input" type="number" min="0" max="366" value={rule.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Days after period end" />
                days
              </label>
            </div>
          )}
          <label className="radio">
            <input type="radio" name="deadline" checked={rule.deadline === "fixed"} onChange={() => set({ deadline: "fixed", fixed: rule.fixed || "01-31" })} />
            <span>A fixed date each year (e.g. 31 January for Self Assessment)</span>
          </label>
          {rule.deadline === "fixed" && (
            <div className="row-wrap" style={{ paddingLeft: 30 }}>
              <input className="input" type="number" min="1" max="31" value={fixedDay} style={{ width: 80 }} aria-label="Day"
                onChange={(e) => set({ fixed: `${String(fixedMonth).padStart(2, "0")}-${String(Number(e.target.value) || 1).padStart(2, "0")}` })} />
              <select className="input" value={fixedMonth} style={{ width: 160 }} aria-label="Month"
                onChange={(e) => set({ fixed: `${String(e.target.value).padStart(2, "0")}-${String(fixedDay).padStart(2, "0")}` })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <span className="muted">after the period end</span>
            </div>
          )}
          <label className="radio">
            <input type="radio" name="deadline" checked={rule.deadline === "gap"} onChange={() => set({ deadline: "gap" })} />
            <span>The same time after the period end as last time</span>
          </label>
          <label className="radio" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={rule.keepMonthEnd} onChange={(e) => set({ keepMonthEnd: e.target.checked })} />
            <span>Periods ending on the last day of a month stay at month end (28 Feb → 31 Mar)</span>
          </label>
        </fieldset>
      )}

      <div className="example" aria-live="polite">
        <strong>{describeRule(rule)}</strong>
        <span>
          {next
            ? <>For example: period to {fmtDate(samplePe)} is due {fmtDate(sampleDeadline)}. When it's completed, the next job is period to {fmtDate(next.PeriodEnd)}, due {fmtDate(next.Deadline)}.</>
            : <>Completing one of these jobs doesn't create another.</>}
        </span>
        {sampleJob && <span className="muted" style={{ fontSize: 12 }}>Example uses {idx.clientByKey.get(sampleJob.ClientKey)?.Title}'s current job.</span>}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Changes apply to jobs completed or added from now on. The {openCount} open job{openCount === 1 ? "" : "s"} keep their current dates.
      </p>
      <div className="form-actions" style={{ alignItems: "center", justifyContent: "space-between" }}>
        {builtIn ? (
          <button type="button" className="linkbtn" onClick={() => setRule(builtIn)}>Use the standard rule</button>
        ) : <span />}
        <div className="row-wrap">
          {state === "saved" && !changed && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
          {state === "error" && <span className="error-text">Couldn't save</span>}
          <button type="button" className="btn primary" onClick={save} disabled={!changed || state === "saving"}>
            {state === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
}

function StagesCard({ service }: { service: string }) {
  const { update, create, remove } = useData();
  const idx = useIndex();
  const stages = idx.stagesByService.get(service) || [];
  const inUse = idx.openJobs.filter((j) => j.ServiceKey === service);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string>();

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const n = stages.length + 1;
    try {
      await create("StageTemplates", { Key: `ST:${service}:${n}:${Date.now().toString(36)}`, Title: name, ServiceKey: service, StageNo: n });
      setNewName("");
    } catch {
      setError("Couldn't add the stage.");
    }
  };
  const removeLast = async () => {
    const last = stages[stages.length - 1];
    if (!last) return;
    const lastNo = last.StageNo as number;
    const onIt = inUse.filter((j) => (j.StageNo || 1) >= lastNo);
    if (onIt.length && !window.confirm(`${onIt.length} open job(s) are at this stage. They'll move back to the stage before. Remove it?`)) return;
    try {
      await remove("StageTemplates", last);
      const prev = stages[stages.length - 2];
      for (const j of onIt) await update("Jobs", j, { StageNo: Math.max(1, lastNo - 1), StageName: (prev?.Title as string) || "" });
    } catch {
      setError("Couldn't remove the stage.");
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="stages-h">
      <h2 id="stages-h">Stages</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The steps this work goes through, shown on every job. Rename a stage by editing it; it saves when you leave the box.
        {inUse.length ? ` ${inUse.length} open job${inUse.length === 1 ? "" : "s"} use these stages.` : ""}
      </p>
      <ol className="stage-edit">
        {stages.map((st) => (
          <li key={st.Key as string}>
            <span className="mono muted">{st.StageNo as number}</span>
            <StageName stage={st} onSave={async (v) => {
              await update("StageTemplates", st, { Title: v });
              for (const j of inUse.filter((j) => j.StageNo === st.StageNo)) await update("Jobs", j, { StageName: v });
            }} />
          </li>
        ))}
        {!stages.length && <li className="muted">No stages yet. Add the first one below.</li>}
      </ol>
      <div className="row-wrap">
        <label style={{ flex: "1 1 240px" }}>
          <span className="sr-only">New stage name</span>
          <input className="input" placeholder="New stage name" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} />
        </label>
        <button type="button" className="btn" onClick={add} disabled={!newName.trim()}>Add stage at the end</button>
        <button type="button" className="btn" onClick={removeLast} disabled={!stages.length}>Remove last stage</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

function StageName({ stage, onSave }: { stage: Row; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(String(stage.Title || ""));
  const commit = () => {
    const name = v.trim();
    if (!name || name === stage.Title) return setV(String(stage.Title || ""));
    onSave(name).catch(() => setV(String(stage.Title || "")));
  };
  return (
    <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label={`Stage ${stage.StageNo} name`} />
  );
}
