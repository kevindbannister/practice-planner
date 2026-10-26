// On a client's page: create them in Xama, ask them to verify their ID, run the AML check, and see
// how it's going, without leaving the planner. Each step that writes to Xama asks first, because
// some of them use Xama credit.
import { useEffect, useMemo, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { Client } from "../lib/domain";
import { FakeXama } from "../lib/fakeXama";
import { HttpXama, XamaApi, XamaStatus } from "../lib/xama";
import { IdOptions, NewAccount, Progress, askForIdCheck, createAccount, draftAccount, idOptions, missingForAml, missingForCreate, progress, progressText, runAmlCheck } from "../lib/xamaActions";
import { readClient, xamaLink } from "../lib/xamaSync";
import { href } from "./bits";
import { isDemo } from "./commsKit";
import { useData } from "./data";
import { useXamaConfig } from "./XamaSettings";
import { todayIso } from "../lib/domain";

type Step = null | "create" | "id" | "aml";

export function XamaClientPanel({ client }: { client: Client }) {
  const { update } = useData();
  const cfg = useXamaConfig();
  const api: XamaApi = useMemo(() => (isDemo() ? new FakeXama() : new HttpXama(getAccessToken)), []);
  const [status, setStatus] = useState<XamaStatus | null>(null);
  const [step, setStep] = useState<Step>(null);
  const [draft, setDraft] = useState<NewAccount>(() => draftAccount(client));
  const [opts, setOpts] = useState<IdOptions | null>(null);
  const [level, setLevel] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);

  const xamaId = String(client.XamaId || "").trim();
  const firm = cfg.firmId.trim();
  useEffect(() => { void api.status().then(setStatus); }, [api]);
  useEffect(() => { setDraft(draftAccount(client)); }, [client.Key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status && !status.configured) return <p className="muted">Xama isn't connected yet. <a href={href("settings", "xama")}>Set it up in Settings</a> to create and check clients from here.</p>;
  if (!firm) return <p className="muted">Add your Xama client ID in <a href={href("settings", "xama")}>Settings › Xama</a> to create and check clients from here.</p>;

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true); setNote(null);
    try {
      const done = await work();
      if (done) setNote({ ok: true, text: done });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  };

  const create = () => run(async () => {
    const id = await createAccount(api, cfg, draft, client.Key);
    await update("Clients", client, { XamaId: id, XamaStatus: "No assessment" });
    setStep(null);
    return "Created in Xama and linked. Next: ask the client to verify their ID.";
  });

  const openId = async () => {
    setStep("id"); setNote(null);
    if (opts) return;
    await run(async () => {
      const o = await idOptions(api, cfg);
      setOpts(o);
      setLevel((o.levels.find((l) => l.isDefault) || o.levels[0])?.id || "");
      setTemplate((o.templates.find((t) => t.isDefault) || o.templates[0])?.id || "");
    });
  };

  const sendId = () => run(async () => {
    await askForIdCheck(api, cfg, xamaId, { level, template: template || undefined });
    setStep(null);
    setProg(await progress(api, cfg, xamaId));
    return `Xama has emailed ${client.Email || "the client"} a link to verify their ID.`;
  });

  const aml = () => run(async () => {
    await runAmlCheck(api, cfg, xamaId);
    setStep(null);
    setProg(await progress(api, cfg, xamaId));
    return "AML check started. It takes a few seconds: press Check progress, then Refresh result.";
  });

  const check = () => run(async () => { setProg(await progress(api, cfg, xamaId)); });

  const refresh = () => run(async () => {
    const r = await readClient(api, cfg, client, todayIso());
    if (r.error) throw new Error(r.error);
    if (r.summary) await update("Clients", client, { XamaId: r.xamaId || xamaId, XamaStatus: r.summary.status, AMLReview: r.summary.review });
    return r.summary ? `Updated: ${r.summary.status}.` : "Nothing found in Xama yet.";
  });

  const set = (k: keyof NewAccount, v: string) => setDraft({ ...draft, [k]: v } as NewAccount);
  const missing = missingForCreate(draft);
  const txt = prog ? progressText(prog) : null;
  const field = (k: keyof NewAccount, label: string, type = "text", required = false) => (
    <label className="field" style={{ display: "grid", gap: 4 }}>
      <span>{label}{required && !String(draft[k]).trim() ? <span className="error-text"> (needed)</span> : null}</span>
      <input className="input" type={type} value={String(draft[k])} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <div className="stack" style={{ gap: 10, marginTop: 4 }}>
      {!xamaId ? (
        step !== "create" ? (
          <div>
            <button type="button" className="btn small" onClick={() => { setStep("create"); setNote(null); }}>Add to Xama…</button>
            <span className="muted" style={{ marginLeft: 8 }}>Not in Xama yet.</span>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>Creates this client in your Xama account, with the person Xama will check. Nothing is sent to the client yet. Check the details:</p>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
              {field("name", "Client name", "text", true)}
              <label className="field" style={{ display: "grid", gap: 4 }}><span>Type</span>
                <select className="input" value={draft.type} onChange={(e) => set("type", e.target.value)}>
                  <option value="COMPANY">Company</option><option value="INDIVIDUAL">Individual</option>
                </select>
              </label>
              {draft.type === "COMPANY" && field("regNumber", "Company number")}
              {field("firstName", "Contact first name", "text", true)}
              {field("lastName", "Contact last name", "text", true)}
              {field("email", "Contact email", "email", true)}
              {field("phone", "Phone")}
              {field("dob", "Date of birth", "date")}
              {field("street", "Street")}
              {field("city", "Town or city")}
              {field("postcode", "Postcode")}
            </div>
            <p className="muted" style={{ margin: 0 }}>Date of birth and address aren't needed to create the client, but Xama needs them to run its AML check.</p>
            <div className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn primary" disabled={busy || missing.length > 0} onClick={() => void create()}>{busy ? "Creating…" : "Create in Xama"}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => setStep(null)}>Cancel</button>
              {missing.length > 0 && <span className="muted">Still needed: {missing.join(", ")}.</span>}
            </div>
          </div>
        )
      ) : (
        <>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small" disabled={busy} onClick={() => void openId()}>Ask client to verify ID…</button>
            <button type="button" className="btn small" disabled={busy} onClick={() => { setStep("aml"); setNote(null); }}>Run AML check…</button>
            <button type="button" className="btn small" disabled={busy} onClick={() => void check()}>Check progress</button>
            <button type="button" className="btn small" disabled={busy} onClick={() => void refresh()}>Refresh result</button>
            <a className="btn small" href={xamaLink(xamaId)} target="_blank" rel="noreferrer">Open in Xama</a>
          </div>

          {step === "id" && (
            <div className="card pad stack" style={{ gap: 10, background: "var(--surface-2)" }}>
              {opts ? (
                <>
                  <p style={{ margin: 0 }}>Xama will email <b>{client.Email || "the client"}</b> a link to verify their identity. This may use Xama credit.</p>
                  {!client.Email && <p className="error-text" style={{ margin: 0 }}>This client has no email on file. Add one first: Xama needs it.</p>}
                  <label className="field" style={{ display: "grid", gap: 4, maxWidth: 360 }}><span>Which ID check</span>
                    <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                      {opts.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                  {opts.templates.length > 0 && (
                    <label className="field" style={{ display: "grid", gap: 4, maxWidth: 360 }}><span>Email wording</span>
                      <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
                        {opts.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="row-wrap" style={{ gap: 8 }}>
                    <button type="button" className="btn primary" disabled={busy || !level || !client.Email} onClick={() => void sendId()}>{busy ? "Sending…" : "Send the request"}</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => setStep(null)}>Cancel</button>
                  </div>
                </>
              ) : <p className="muted" style={{ margin: 0 }}>{busy ? "Asking Xama what it offers…" : "Couldn't load Xama's options."}</p>}
            </div>
          )}

          {step === "aml" && (
            <div className="card pad stack" style={{ gap: 10, background: "var(--surface-2)" }}>
              <p style={{ margin: 0 }}>Runs Xama's AML check (identity, PEP and sanctions) on this client's main contact. It needs their full name, date of birth and address on the Xama contact, and may use Xama credit.</p>
              {missingForAml(draftAccount(client)).length > 0 && <p className="muted" style={{ margin: 0 }}>The planner doesn't hold their {missingForAml(draftAccount(client)).join(" or ")}. If it's in Xama already that's fine; if not, Xama will say what's missing.</p>}
              <div className="row-wrap" style={{ gap: 8 }}>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void aml()}>{busy ? "Starting…" : "Run the AML check"}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => setStep(null)}>Cancel</button>
              </div>
            </div>
          )}

          {txt && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="kv"><span>ID check</span><span>{txt.id}</span></div>
              <div className="kv"><span>AML check</span><span>{txt.aml}</span></div>
            </div>
          )}
        </>
      )}
      {note && <p role={note.ok ? "status" : "alert"} className={note.ok ? "" : "error-text"} style={{ margin: 0 }}>{note.text}</p>}
    </div>
  );
}
