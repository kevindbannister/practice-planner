// Settings, in three tabs: your working week; types of work (how each repeats, when it's
import { EmailSettings } from "./EmailSuggestions";
import { deadlineSource } from "../lib/plannerChecks";
import { AssistantSettings } from "./Assistant";
import { RoutinesCard } from "./Routines";
import { XeroSettings } from "./XeroSettings";
// due, default hours and its stages); and Companies House checks.
import React, { useEffect, useRef, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import {
  BUILT_IN_RULES, DEFAULT_HOURS, Hours, Rule, deadlineByRule, describeRule, newKey, nextPeriod, ruleFields, ruleFor,
} from "../lib/planning";
import { Row } from "../lib/schema";
import { DEFAULT_DAY_TYPES, DEFAULT_WEEK, DayType } from "../lib/dayTypes";
import { Icon, href, useRoute } from "./bits";
import { readSetting, useData, useIndex } from "./data";
import { DEFAULT_FILL } from "../lib/autoplan";
import { SelectField } from "./Editors";
import { recordsRule } from "../lib/chase";
import { moveItem, renumberStages } from "../lib/stages";
import { adoptWaitingJobs, finaliseDefault, isWaitStage } from "../lib/waiting";
import { Problem, clearProblems, problemText, readProblems } from "./ErrorBoundary";
import { svcClass } from "../lib/serviceColour";
import { CompaniesHouseSettings } from "./CompaniesHouse";
import { BackupSettings } from "./Backups";
import { CalendarSettings } from "./Calendar";
import { CommsSettings } from "./Comms";
import { ThemeChoice, useTheme } from "./theme";
import { signOut } from "../lib/auth";

declare const __DEMO__: boolean;

const DAYS: [keyof Hours, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"]];
const TABS: [string, string][] = [
  ["week", "Your week"], ["work", "Types of work"], ["calendar", "Calendar"], ["companies-house", "Companies House"], ["letters", "Letters and email"], ["xero", "Xero"], ["backups", "Backups"],
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
      {tab === "week" && <DayTypesCard />}
      {tab === "week" && <RoutinesCard />}
      {tab === "week" && <AppearanceCard />}
      {tab === "work" && <TypesOfWork />}
      {tab === "companies-house" && <CompaniesHouseSettings />}
      {tab === "backups" && <BackupSettings />}
      {tab === "calendar" && <CalendarSettings />}
      {tab === "letters" && <CommsSettings />}
      {tab === "letters" && <AssistantSettings />}
      {tab === "letters" && <EmailSettings />}
      {tab === "xero" && <XeroSettings />}
    </div>
  );
}

// ------------------------------------------------------------------ your week

function HoursCard() {
  const { settings, saveSetting, data } = useData();
  const [hours, setHours] = useState<Hours>(settings.hours);
  const [tight, setTight] = useState(String(settings.tightDays));
  const savedFill = readSetting<number>(data.settings, "planFill") ?? DEFAULT_FILL;
  const [fill, setFill] = useState(String(savedFill));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const changed = JSON.stringify(hours) !== JSON.stringify(settings.hours) || Number(tight) !== settings.tightDays || Number(fill) !== savedFill;

  const save = async () => {
    setState("saving");
    try {
      await saveSetting("hours", hours);
      await saveSetting("tightDays", Math.max(1, Math.round(Number(tight) || 21)));
      if (Number(fill) !== savedFill) await saveSetting("planFill", Math.min(100, Math.max(20, Math.round(Number(fill) || DEFAULT_FILL))));
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="hours-h" style={{ maxWidth: 560 }}>
      <h2 id="hours-h">Your week</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Hours you work each day. 9:00 to 17:30 with an hour for lunch is 7.5. The kind of day (below) decides how
        much of that is for client work.
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
        <label>
          "Suggest a plan" fills each day to (%)
          <input className="input" type="number" min="20" max="100" step="5" value={fill} onChange={(e) => setFill(e.target.value)} />
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

// ------------------------------------------------------------------ kinds of day

/**
 * What a day is for. Client days are for client work, business days for working on the practice,
 * mixed days split the hours, and days off have none. Each kind can hold back a buffer for
 * interruptions and admin. Any one day can be changed from the planner.
 */
function DayTypesCard() {
  const { settings, saveSetting } = useData();
  const [types, setTypes] = useState<DayType[]>(settings.dayTypes);
  const [week, setWeek] = useState<Record<string, string>>({ ...DEFAULT_WEEK, ...settings.week });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const changed = JSON.stringify(types) !== JSON.stringify(settings.dayTypes) || JSON.stringify(week) !== JSON.stringify({ ...DEFAULT_WEEK, ...settings.week });
  const over = types.some((t) => t.client + t.business > 100);
  const edit = (key: string, patch: Partial<DayType>) => setTypes(types.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const num = (v: string) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));

  const save = async () => {
    setState("saving");
    try {
      await saveSetting("dayTypes", types);
      await saveSetting("week", week);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  const reset = () => {
    setTypes(DEFAULT_DAY_TYPES.map((d) => ({ ...d })));
    setWeek({ ...DEFAULT_WEEK });
  };

  return (
    <section className="card pad stack" aria-labelledby="dtypes-h" style={{ maxWidth: 720 }}>
      <h2 id="dtypes-h">Kinds of day and your usual week</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Only the client share of a day counts as room for client work on the planner. The business share is time
        for working on the practice itself. The buffer is held back from both for interruptions and admin.
        You can change any single day from the planner.
      </p>
      <div className="dtypes-table" role="group" aria-label="Kinds of day">
        <div className="dtypes-row dtypes-head" aria-hidden="true">
          <span>Kind</span><span>Colour</span><span>Client %</span><span>Business %</span><span>Buffer %</span>
        </div>
        {types.map((t) => (
          <div key={t.key} className="dtypes-row">
            <input className="input" aria-label={`Name of ${t.key} day`} value={t.name} onChange={(e) => edit(t.key, { name: e.target.value })} />
            <input type="color" className="dtypes-colour" aria-label={`Colour for ${t.name}`} value={t.colour} onChange={(e) => edit(t.key, { colour: e.target.value })} />
            <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">Client %</span><input className="input" type="number" min="0" max="100" step="5" aria-label={`Client share of ${t.name}`} value={t.client} onChange={(e) => edit(t.key, { client: num(e.target.value) })} /></label>
            <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">Business %</span><input className="input" type="number" min="0" max="100" step="5" aria-label={`Business share of ${t.name}`} value={t.business} onChange={(e) => edit(t.key, { business: num(e.target.value) })} /></label>
            <label className="dtypes-cell"><span className="dtypes-lab" aria-hidden="true">Buffer %</span><input className="input" type="number" min="0" max="60" step="5" aria-label={`Buffer for ${t.name}`} value={t.buffer} onChange={(e) => edit(t.key, { buffer: Math.min(60, num(e.target.value)) })} /></label>
          </div>
        ))}
      </div>
      {over && <p className="error-text" role="alert" style={{ margin: 0 }}>Client and business shares can't add up to more than 100%.</p>}
      <h3 style={{ margin: "6px 0 0", fontSize: 14 }}>Your usual week</h3>
      <div className="form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {DAYS.map(([k, label]) => (
          <label key={k}>
            {label}
            <select className="input" value={week[k] || "client"} onChange={(e) => setWeek({ ...week, [k]: e.target.value })}>
              {types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="form-actions" style={{ alignItems: "center" }}>
        {state === "saved" && !changed && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
        {state === "error" && <span className="error-text">Couldn't save</span>}
        <button type="button" className="btn" onClick={reset} disabled={state === "saving"}>Back to the usual</button>
        <button type="button" className="btn primary" onClick={save} disabled={!changed || over || state === "saving"}>
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
      <ProblemsList />
      {!__DEMO__ && (
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span style={{ fontSize: 14 }}>Signed in{user ? ` as ${user}` : ""}</span>
          <button type="button" className="btn small" onClick={signOut}>Sign out</button>
        </div>
      )}
    </section>
  );
}

function ProblemsList() {
  const [list, setList] = useState<Problem[]>(readProblems);
  if (!list.length) return null;
  return (
    <details>
      <summary>Problems ({list.length})</summary>
      <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>Things that went wrong on this device. Copy them and send them over so they can be fixed.</p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map((p) => (
          <li key={p.at} style={{ fontSize: 13 }}>
            <strong>{new Date(p.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong> · {p.path} · {p.message}
          </li>
        ))}
      </ul>
      <div className="row-wrap" style={{ marginTop: 8 }}>
        <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(list.map(problemText).join("\n\n---\n\n")).catch(() => undefined)}>Copy details</button>
        <button type="button" className="btn small" onClick={() => { clearProblems(); setList([]); }}>Clear</button>
      </div>
    </details>
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
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><span className={`svc-dot ${svcClass(s.Key as string)}`} aria-hidden="true" />{s.Title as string}</span>
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
  const savedFin = s.FinaliseHours !== undefined && s.FinaliseHours !== null ? String(s.FinaliseHours) : "";
  const [finalise, setFinalise] = useState(savedFin);
  const hasWait = (idx.stagesByService.get(s.Key as string) || []).some(isWaitStage);
  const savedRecords = recordsRule(s.Key as string, data.services);
  const [records, setRecords] = useState(savedRecords);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => setState("idle"), [rule, name, hours, records, finalise]);

  const fixedMonth = Number((rule.fixed || "01-31").split("-")[0]);
  const fixedDay = Number((rule.fixed || "01-31").split("-")[1]);
  const set = (patch: Partial<Rule>) => setRule((r) => ({ ...r, ...patch }));
  const changed =
    JSON.stringify(ruleFields(rule)) !== JSON.stringify(ruleFields(saved)) ||
    name.trim() !== s.Title ||
    hours !== (s.DefaultHours !== undefined ? String(s.DefaultHours) : "") || finalise !== savedFin ||
    records.needs !== savedRecords.needs || records.leadDays !== savedRecords.leadDays;

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
        FinaliseHours: finalise === "" ? ("" as any) : Number(finalise),
        RecordsNeeded: records.needs ? "yes" : "no",
        RecordsLeadDays: records.leadDays,
      });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="rule-h">
      <h2 id="rule-h">{s.Title as string}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        <strong style={{ color: "var(--ink)" }}>Where the deadline comes from.</strong> {deadlineSource(s.Key as string, s.RepeatMonths !== undefined && s.RepeatMonths !== null)}
      </p>
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
        <label>
          Time to finalise after the client approves (default {fmtHours(finaliseDefault(s.Key as string, []))})
          <input className="input" type="number" step="0.25" min="0" value={finalise} placeholder={String(finaliseDefault(s.Key as string, []))}
            onChange={(e) => setFinalise(e.target.value)} />
          {!hasWait && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>Used once a stage below is marked "With client".</span>}
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

      <fieldset className="fieldset">
        <legend>Records from the client</legend>
        <label className="radio">
          <input type="checkbox" checked={records.needs} onChange={(e) => setRecords({ ...records, needs: e.target.checked })} />
          <span>This work needs records from the client (shows on the Chase list when they're due)</span>
        </label>
        {records.needs && (
          <div className="row-wrap" style={{ paddingLeft: 30 }}>
            <span>Need them</span>
            <label className="inline-num">
              <input className="input" type="number" min="0" max="365" value={records.leadDays} aria-label="Days before the deadline"
                onChange={(e) => setRecords({ ...records, leadDays: Math.max(0, Number(e.target.value) || 0) })} />
              days before the deadline
            </label>
          </div>
        )}
      </fieldset>

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
          <button type="button" className="linkbtn" onClick={() => { setRule(builtIn); setRecords(recordsRule(s.Key as string)); }}>Use the standard rule</button>
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
  const { data, update, updateMany, create, remove } = useData();
  const idx = useIndex();
  const stages = idx.stagesByService.get(service) || [];
  const inUse = idx.openJobs.filter((j) => j.ServiceKey === service);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<Row[] | null>(null); // while dragging: the order being shown
  const [dragKey, setDragKey] = useState<string>();
  const listRef = useRef<HTMLOListElement>(null);
  const shown = order || stages;

  /** Save a new order: stage numbers, the jobs on each stage, and each client's stage details. */
  const saveOrder = async (ordered: Row[]) => {
    const r = renumberStages(
      ordered,
      inUse,
      data.clientStages.filter((cs) => cs.ServiceKey === service),
    );
    if (!r.templates.length) return;
    setSaving(true);
    setError(undefined);
    try {
      await updateMany("StageTemplates", r.templates);
      await updateMany("Jobs", r.jobs);
      await updateMany("ClientServiceStages", r.clientStages);
    } catch {
      setError("Couldn't save the new order. It's been put back; try again.");
    } finally {
      setSaving(false);
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stages.length || from === to) return;
    void saveOrder(moveItem(stages, from, to));
  };

  // drag by the handle (mouse, pen or finger): the list re-orders as you move, and saves on release
  const startDrag = (e: React.PointerEvent, key: string) => {
    if (saving) return;
    e.preventDefault();
    const list = listRef.current;
    if (!list) return;
    let current = [...stages];
    document.body.classList.add("is-dragging");
    setDragKey(key);
    setOrder(current);
    const onMove = (ev: PointerEvent) => {
      const items = [...list.querySelectorAll<HTMLElement>("li[data-key]")];
      const from = current.findIndex((st) => st.Key === key);
      let to = items.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (to === -1) to = items.length - 1;
      else if (to > from) to -= 1;
      if (to !== from) {
        current = moveItem(current, from, to);
        setOrder(current);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-dragging");
      setDragKey(undefined);
      setOrder(null);
      void saveOrder(current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

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
  const removeStage = async (st: Row) => {
    const no = Number(st.StageNo);
    const onIt = inUse.filter((j) => (j.StageNo || 1) === no);
    const msg = onIt.length
      ? `${onIt.length} open job(s) are at "${st.Title}". They'll move to the stage before it. Remove the stage?`
      : `Remove the stage "${st.Title}"?`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      await remove("StageTemplates", st);
      const rest = stages.filter((x) => x._id !== st._id);
      // jobs on the removed stage go back one; everything after it closes the gap
      const prevName = (rest[Math.max(0, no - 2)]?.Title as string) || "";
      const jobChanges = inUse
        .filter((j) => (j.StageNo || 1) >= no)
        .map((j) => {
          const n = (j.StageNo || 1) === no ? Math.max(1, no - 1) : (j.StageNo || 1) - 1;
          return { row: j, patch: { StageNo: n, StageName: (j.StageNo || 1) === no ? prevName : String(rest[n - 1]?.Title || j.StageName || "") } };
        });
      await updateMany("StageTemplates", rest.map((x, i) => ({ row: x, patch: { StageNo: i + 1 } })).filter((c) => Number(c.row.StageNo) !== c.patch.StageNo));
      await updateMany("Jobs", jobChanges);
      await updateMany(
        "ClientServiceStages",
        data.clientStages
          .filter((cs) => cs.ServiceKey === service && Number(cs.StageNo) > no)
          .map((cs) => ({ row: cs, patch: { StageNo: Number(cs.StageNo) - 1 } })),
      );
    } catch {
      setError("Couldn't remove the stage.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="stages-h">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 id="stages-h">Stages</h2>
        {saving && <span className="muted" style={{ fontSize: 13 }} role="status">Saving…</span>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The steps this work goes through, shown on every job. Drag a stage by its handle to change the order, or use the arrows.
        Rename a stage by editing it; it saves when you leave the box. Mark the stage where the work is with the client
        (such as sent for approval) as "With client": the job comes off the plan until you speak to them, then comes back to finalise.
        {inUse.length ? ` ${inUse.length} open job${inUse.length === 1 ? "" : "s"} use these stages and stay on the same stage when you re-order.` : ""}
      </p>
      <ol className="stage-edit" ref={listRef}>
        {shown.map((st, i) => (
          <li key={st.Key as string} data-key={st.Key as string} className={dragKey === st.Key ? "dragging" : undefined}>
            <span className="stage-grip" aria-hidden="true" onPointerDown={(e) => startDrag(e, st.Key as string)} title="Drag to re-order">
              <Icon name="grip" />
            </span>
            <span className="mono muted">{i + 1}</span>
            <StageName stage={st} onSave={async (v) => {
              await update("StageTemplates", st, { Title: v });
              const jobs = inUse.filter((j) => j.StageNo === st.StageNo).map((j) => ({ row: j, patch: { StageName: v } }));
              await updateMany("Jobs", jobs);
            }} />
            <span className="stage-buttons">
              <button
                type="button"
                className={`waitbtn${isWaitStage(st) ? " on" : ""}`}
                aria-pressed={isWaitStage(st)}
                aria-label={`Waiting for the client at ${st.Title}`}
                title="At this stage the work is with the client (for example sent for approval). The job comes off the plan until you speak to them, then comes back to finalise."
                disabled={saving}
                onClick={async () => {
                  const on = !isWaitStage(st);
                  try {
                    await update("StageTemplates", st, { WaitClient: on });
                    // jobs already at this stage are prepared: what's left is finalising
                    if (on) await updateMany("Jobs", adoptWaitingJobs(inUse, stages.map((x) => (x.Key === st.Key ? { ...x, WaitClient: true } : x)), data.services, todayIso()));
                  } catch {
                    setError("Couldn't save that change.");
                  }
                }}
              >
                <Icon name="clock" size={14} /><span>With client</span>
              </button>
              <button type="button" className="iconbtn small" aria-label={`Move ${st.Title} up`} disabled={i === 0 || saving} onClick={() => move(i, i - 1)}>
                <Icon name="up" size={14} />
              </button>
              <button type="button" className="iconbtn small" aria-label={`Move ${st.Title} down`} disabled={i === shown.length - 1 || saving} onClick={() => move(i, i + 1)}>
                <Icon name="down" size={14} />
              </button>
              <button type="button" className="iconbtn small" aria-label={`Remove ${st.Title}`} disabled={saving} onClick={() => removeStage(st)}>
                <Icon name="close" size={14} />
              </button>
            </span>
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
        <button type="button" className="btn" onClick={add} disabled={!newName.trim() || saving}>Add stage at the end</button>
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
