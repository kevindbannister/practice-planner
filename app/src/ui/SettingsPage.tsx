// Settings: working hours, the "tight" threshold, default hours per type of work,
// and the list of stages for each type of work.
import { useState } from "react";
import { fmtHours } from "../lib/domain";
import { DEFAULT_HOURS, Hours } from "../lib/planning";
import { Row } from "../lib/schema";
import { useData, useIndex } from "./data";
import { SelectField } from "./Editors";

const DAYS: [keyof Hours, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"]];

export function SettingsPage() {
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="cols">
        <div className="col-main">
          <StagesCard />
        </div>
        <div className="col-side">
          <HoursCard />
          <ServiceHoursCard />
        </div>
      </div>
    </div>
  );
}

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
    <section className="card pad stack" aria-labelledby="hours-h">
      <h2 id="hours-h">Your week</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Hours you can give to client work each day. 9:00 to 17:30 with an hour for lunch is 7.5.
      </p>
      <div className="form" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {DAYS.map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              className="input" type="number" step="0.25" min="0" max="24" value={hours[k]}
              onChange={(e) => setHours({ ...hours, [k]: Number(e.target.value) })}
            />
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

function ServiceHoursCard() {
  const { data, update } = useData();
  const services = data.services.slice().sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  return (
    <section className="card pad stack" aria-labelledby="svc-hours-h">
      <h2 id="svc-hours-h">Hours per job</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Your time for each type of work, used when a job has no estimate of its own. Saves as you go.
      </p>
      <div className="stack" style={{ gap: 6 }}>
        {services.map((s) => (
          <ServiceHours key={s.Key as string} service={s} onSave={(v) => update("Services", s, { DefaultHours: v })} />
        ))}
      </div>
    </section>
  );
}

function ServiceHours({ service: s, onSave }: { service: Row; onSave: (v: any) => Promise<void> }) {
  const builtIn = DEFAULT_HOURS[s.Key as string] ?? 1;
  const [v, setV] = useState(s.DefaultHours !== undefined ? String(s.DefaultHours) : "");
  const commit = () => {
    const current = s.DefaultHours !== undefined ? String(s.DefaultHours) : "";
    if (v === current) return;
    onSave(v === "" ? "" : Number(v)).catch(() => setV(current));
  };
  return (
    <label className="kv" style={{ alignItems: "center" }}>
      <span>{s.Title as string}</span>
      <input
        className="input" type="number" step="0.25" min="0" value={v} placeholder={fmtHours(builtIn)}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={{ width: 90, minHeight: 36, padding: "4px 8px", textAlign: "right" }}
        aria-label={`${s.Title} hours`}
      />
    </label>
  );
}

function StagesCard() {
  const { data, update, create, remove } = useData();
  const idx = useIndex();
  const services = data.services
    .filter((s) => s.Key !== "TASK")
    .sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const [service, setService] = useState<string>((services.find((s) => s.Key === "ACCS_LTD")?.Key as string) || (services[0]?.Key as string) || "");
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
    const onIt = inUse.filter((j) => (j.StageNo || 1) >= (last.StageNo as number)).length;
    if (onIt && !window.confirm(`${onIt} open job(s) are at this stage. They'll move back to the stage before. Remove it?`)) return;
    try {
      await remove("StageTemplates", last);
      for (const j of inUse.filter((j) => (j.StageNo || 1) >= (last.StageNo as number))) {
        const prev = stages[stages.length - 2];
        await update("Jobs", j, { StageNo: Math.max(1, (last.StageNo as number) - 1), StageName: (prev?.Title as string) || "" });
      }
    } catch {
      setError("Couldn't remove the stage.");
    }
  };

  return (
    <section className="card pad stack" aria-labelledby="stages-h">
      <h2 id="stages-h">Stages</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        The steps each type of work goes through. Rename a stage by editing it; changes save when you leave the box.
      </p>
      <div style={{ maxWidth: 360 }}>
        <SelectField label="Type of work" value={service} onChange={setService}>
          {services.map((s) => <option key={s.Key as string} value={s.Key as string}>{s.Title as string}</option>)}
        </SelectField>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{inUse.length} open job{inUse.length === 1 ? "" : "s"} use these stages.</p>
      <ol className="stage-edit">
        {stages.map((s) => (
          <li key={s.Key as string}>
            <span className="mono muted">{s.StageNo as number}</span>
            <StageName stage={s} onSave={async (v) => {
              await update("StageTemplates", s, { Title: v });
              for (const j of inUse.filter((j) => j.StageNo === s.StageNo)) await update("Jobs", j, { StageName: v });
            }} />
          </li>
        ))}
        {!stages.length && <li className="muted">No stages yet.</li>}
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
    <input
      className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label={`Stage ${stage.StageNo} name`}
    />
  );
}
