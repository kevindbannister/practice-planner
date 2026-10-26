// Client onboarding (Phase 4): from an accepted proposal to an active client. The rules live in lib/onboarding.ts;
// this file is the screens. Collecting identity documents (the portal) is kept apart from verifying and approving
// the AML work, and a client can only be activated once the mandatory controls are met.
import { useEffect, useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { readAgreed } from "../lib/engagements";
import {
  Aml, CHECK_KINDS, CLIENT_KINDS, Check, ENGAGEMENT_STATE_LABEL, Owner, Risk, StageLine, View, activate, activationPlan, amlProblems, approveAml, approveOnboarding, blockers, cancelOnboarding, clientFromLead, declineAml,
  detailsProblems, engagementState, isLiveOnboarding, onboardingCan, readAml, readOnboardingSettings, readStates, releaseHeld, setStage, saveAml, stageLines, startOnboarding, withdrawAml, withdrawApproval,
} from "../lib/onboarding";
import { readFeeSettings } from "../lib/fees";
import { clientTypeFor, typeLabel } from "../lib/proposals";
import { Lead, Opp, findDuplicates } from "../lib/sales";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useData } from "./data";
import { InviteForm } from "./PortalAdmin";
import { IdentityFor } from "./PortalIdentity";
import { usePortal } from "./portalKit";
import { money, useSales } from "./salesKit";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
const STATUS_CHIP: Record<string, [string, string]> = { done: ["Done", "green"], doing: ["In progress", "blue"], todo: ["To do", "amber"], na: ["Not needed", ""], blocked: ["Blocked", "red"] };

/** Everything the onboarding logic needs to describe one onboarding, gathered from the data and the portal. */
export function useOnboarding() {
  const s = useSales();
  const { data } = useData();
  const portal = usePortal();
  const settings = useMemo(() => readOnboardingSettings(data.settings), [data.settings]);
  const can = (a: "view" | "edit" | "approve" | "activate" | "configure") => onboardingCan(s.cfg, s.me, a);
  const pcan = (a: Parameters<typeof s.pcan>[0]) => s.pcan(a);
  const viewFor = (onb: Row): View | undefined => {
    const client = data.clients.find((c) => c.Key === onb.ClientKey);
    if (!client) return undefined;
    const people = portal.forClient(client.Key).map((r) => ({ id: r.person.id, name: r.person.name || r.person.email, status: r.person.status }));
    return { onb, defs: settings.stages, client, engagements: data.engagements, proposals: data.proposals, versions: data.proposalVersions, catalogue: s.catalogue, people, today: todayIso() };
  };
  const fees = useMemo(() => readFeeSettings(data.settings), [data.settings]);
  const authDone = (onb: Row) => { const d = settings.stages.find((x) => x.key === "agent"); return !d?.enabled || readStates(onb.Stages).agent?.status === "done"; };
  return { s, data, portal, settings, fees, can, pcan, viewFor, authDone };
}

// ------------------------------------------------------------------ list

export function OnboardingList() {
  const o = useOnboarding();
  const [all, setAll] = useState(false);
  const rows = o.data.onboardings.filter((x) => all || isLiveOnboarding(x)).sort((a, b) => str(b.Created).localeCompare(str(a.Created)));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0 }}>Clients being taken on. Start onboarding from an accepted proposal. A client only becomes active when every required control is met and an authorised person activates them.</p>
        <label className="row-wrap"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include activated and cancelled</label>
      </div>
      {!rows.length ? <div className="card empty"><p>Nobody is being onboarded. Open an accepted proposal and choose "Start onboarding".</p></div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Onboarding</th><th>Client</th><th>Progress</th><th>Waiting on</th><th>Status</th></tr></thead>
            <tbody>{rows.map((x) => {
              const v = o.viewFor(x);
              const lines = v ? stageLines(v).filter((l) => l.applies) : [];
              const done = lines.filter((l) => l.status === "done").length;
              const wait = v ? blockers(lines, { includeApproval: true })[0] : "";
              return (
                <tr key={str(x.Key)}>
                  <td><a href={href("sales", "onboard", str(x.Key))}>{str(x.Ref)}</a></td>
                  <td>{v ? <a href={href("clients", str(v.client.Key))}>{str(v.client.Title)}</a> : "—"}</td>
                  <td>{lines.length ? `${done} of ${lines.length} stages` : "—"}</td>
                  <td className="muted">{isLiveOnboarding(x) ? wait || (str(x.ApprovedBy) ? "Ready to activate" : "Ready for approval") : ""}</td>
                  <td><span className={`chip ${x.Status === "activated" ? "green" : x.Status === "cancelled" ? "" : "amber"}`}>{x.Status === "activated" ? "Activated" : x.Status === "cancelled" ? "Cancelled" : "In progress"}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ starting, from an accepted proposal

export function ProposalOnboarding({ proposal, version }: { proposal: Row; version: Row }) {
  const o = useOnboarding();
  const { s, data } = o;
  const [takeover, setTakeover] = useState(false);
  const [kind, setKind] = useState<string>("Ltd");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const existing = data.onboardings.find((x) => x.ProposalKey === proposal.Key && x.Status !== "cancelled");
  const client = data.clients.find((c) => c.Key === proposal.ClientKey);
  const lead = data.leads.find((l) => l.Key === proposal.LeadKey) as Lead | undefined;
  const dupes = useMemo(() => (!client && lead ? findDuplicates({ name: str(lead.Title), email: str(lead.Email), phone: str(lead.Phone) }, [], data.clients, data.contacts) : []), [client, lead, data.clients, data.contacts]);
  const strong = dupes.filter((d) => d.strong);
  if (str(proposal.Status) !== "accepted" || str(version.Status) !== "accepted") return null;
  const go = async () => {
    setBusy(true); setErr(undefined);
    try {
      const ctx = s.ctx();
      let target: Row | undefined = client as Row | undefined;
      if (!target) {
        if (!lead) throw new Error("This proposal has neither a client nor a lead.");
        if (strong.length && !override) throw new Error("A client with the same details already exists. Link the lead to that client instead (open the lead), or tick the box to create a new record anyway.");
        const r = clientFromLead({ lead, kind, opps: s.opps as Opp[], activities: data.activities as Row[], proposals: data.proposals, can: s.pcan }, ctx);
        if ("error" in r) throw new Error(r.error);
        await s.apply(r.written);
        target = r.client;
      }
      const w = startOnboarding({ proposal, version, client: target, existing: data.onboardings, takeover, today: todayIso(), can: s.pcan }, ctx);
      if ("error" in w) throw new Error(w.error);
      await s.apply({ patches: [], creates: [{ list: "Onboardings", row: w.onboarding }], log: [w.log as never], activities: [w.activity] });
      window.location.hash = `/sales/onboard/${w.onboarding.Key}`;
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ padding: 12, marginTop: 12 }} role="group" aria-label="Client onboarding">
      <strong>Client onboarding</strong>
      {existing ? <p style={{ margin: "6px 0 0" }}><a href={href("sales", "onboard", str(existing.Key))}>{str(existing.Ref)}</a> {existing.Status === "activated" ? <span className="chip green">Activated</span> : <span className="chip amber">In progress</span>}</p> : (
        <>
          <p className="muted" style={{ margin: "4px 0 8px" }}>Acceptance agrees the services and fees. It is not AML clearance, a signed engagement letter or activation. Onboarding tracks the rest and only activates the client when the required controls are met.</p>
          {!client && lead && (
            <div className="stack" style={{ gap: 8, marginBottom: 8 }}>
              <p style={{ margin: 0 }}>{lead.Title} is still a lead. Starting onboarding creates the client record and moves the lead's history across. It isn't active until activation.</p>
              <label className="doc-field" style={{ maxWidth: 260 }}><span>Type of client</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{CLIENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
              {dupes.length > 0 && (
                <div className="import-list warn" role="status">
                  <strong>Possible existing {dupes.length === 1 ? "match" : "matches"}:</strong>
                  <ul className="plain">{dupes.map((d) => <li key={d.kind + d.key}>{d.kind === "client" ? <a href={href("clients", d.key)}>{d.title}</a> : d.title} <span className="muted">({d.why.join(", ")})</span></li>)}</ul>
                  {strong.length > 0 && <label className="row-wrap"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> It's a different client: create a new record</label>}
                </div>
              )}
            </div>
          )}
          <label className="row-wrap"><input type="checkbox" checked={takeover} onChange={(e) => setTakeover(e.target.checked)} /> We are taking this client over from another accountant (adds the clearance step)</label>
          {s.pcan("edit") ? <div style={{ marginTop: 8 }}><button type="button" className="btn primary" disabled={busy} onClick={go}>{busy ? "Starting…" : "Start onboarding"}</button></div> : <p className="muted" style={{ marginBottom: 0 }}>You don't have permission to start onboarding.</p>}
        </>
      )}
      {err && <p role="alert" style={{ color: "var(--red-ink)", marginBottom: 0 }}>{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ detail

export function OnboardingDetail({ onbKey }: { onbKey: string }) {
  const o = useOnboarding();
  const { s, data, settings } = o;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();
  const onb = data.onboardings.find((x) => x.Key === onbKey);
  if (!onb) return <div className="card empty"><p>That onboarding wasn't found. <a href="#/sales/onboarding">Back to the list</a></p></div>;
  const v = o.viewFor(onb);
  if (!v) return <div className="card empty"><p>The client for this onboarding is missing.</p></div>;
  const { client } = v;
  const lines = stageLines(v);
  const live = isLiveOnboarding(onb);
  const ctx = () => s.ctx();
  const run = async (f: () => Promise<{ error: string } | unknown>, ok?: string) => {
    setBusy(true); setErr(undefined); setNote(undefined);
    try { const r = await f(); if (r && typeof r === "object" && "error" in r) setErr(String((r as { error: string }).error)); else if (ok) setNote(ok); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const doW = (w: ReturnType<typeof setStage>, ok?: string) => run(async () => ("error" in w ? w : s.apply(w)), ok);
  const proposal = data.proposals.find((p) => p.Key === onb.ProposalKey);
  const version = data.proposalVersions.find((x) => x.ProposalKey === onb.ProposalKey && Number(x.Version) === Number(onb.ProposalVersion));
  const independent = s.cfg.independentReview;
  const authDone = o.authDone(onb);
  const ready = !blockers(lines).length;
  const history = data.salesLog.filter((l) => l.EntityKey === onb.Key).sort((a, b) => str(b.At).localeCompare(str(a.At))).slice(0, 40);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card pad stack" style={{ gap: 6 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{str(onb.Ref)}: {str(client.Title)}</h2>
          <span className={`chip ${onb.Status === "activated" ? "green" : onb.Status === "cancelled" ? "" : "amber"}`}>{onb.Status === "activated" ? "Activated" : onb.Status === "cancelled" ? "Cancelled" : "In progress"}</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          <a href={href("clients", str(client.Key))}>Client record</a> · {typeLabel(clientTypeFor(str(client.Kind)))}{onb.Takeover === "yes" ? " · taking over from another accountant" : ""}
          {proposal && <> · <a href={href("sales", "proposal", str(proposal.Key))}>Proposal {str(proposal.Ref)}</a></>} · started {fmtDate(str(onb.Created).slice(0, 10))} by {str(onb.CreatedBy)} · planned start {fmtDate(str(onb.StartDate))}
        </p>
        {str(client.Status) && !/^active$/i.test(str(client.Status)) && <p className="muted" style={{ margin: 0 }}>Client status: {str(client.Status)}. The client is not active until activation.</p>}
        {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
        {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      </div>

      {lines.map((l) => (
        <section key={l.def.key} className="card pad stack" style={{ gap: 8 }} aria-label={l.def.label}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{l.def.label}{l.def.mandatory ? "" : <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}</h3>
            <span className={`chip ${STATUS_CHIP[l.status][1]}`}>{STATUS_CHIP[l.status][0]}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>{l.def.help}</p>
          <p style={{ margin: 0 }}>{l.detail}</p>
          {(live || (onb.Status === "activated" && l.def.key === "agent")) && l.applies && <StageBody l={l} v={v} o={o} busy={busy} doW={doW} run={run} lines={lines} ready={ready} independent={independent} authDone={authDone} version={version} />}
        </section>
      ))}

      {onb.Status === "activated" && <Activated onb={onb} v={v} o={o} version={version} authDone={authDone} busy={busy} run={run} />}

      {live && (
        <section className="card pad stack" aria-label="Cancel onboarding">
          <CancelBox disabled={busy} allowed={o.can("configure")} onCancel={(reason) => doW(cancelOnboarding(onb, reason, s.pcan, ctx()))} />
        </section>
      )}
      {onb.Status === "cancelled" && onb.Notes ? <p className="muted">Cancelled: {str(onb.Notes)}</p> : null}

      <section className="card pad stack" aria-label="History">
        <h3 style={{ margin: 0, fontSize: 15 }}>History</h3>
        {!history.length ? <p className="muted" style={{ margin: 0 }}>Nothing yet.</p> : (
          <table className="tbl"><tbody>{history.map((h) => <tr key={str(h.Key)}><td>{str(h.At).slice(0, 16).replace("T", " ")}</td><td>{str(h.Actor)}</td><td>{str(h.Action)}</td><td className="muted">{(() => { try { return Object.entries(JSON.parse(str(h.Detail) || "{}")).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join("; "); } catch { return ""; } })()}</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}

function CancelBox({ allowed, disabled, onCancel }: { allowed: boolean; disabled: boolean; onCancel: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!allowed) return <p className="muted" style={{ margin: 0 }}>Only a manager or partner can cancel an onboarding.</p>;
  return open ? (
    <div className="row-wrap">
      <input className="input" aria-label="Why is it being cancelled" placeholder="Why is it being cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn" disabled={disabled} onClick={() => onCancel(reason)}>Cancel this onboarding</button>
      <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Keep it</button>
    </div>
  ) : <div><button type="button" className="linkbtn danger-link" onClick={() => setOpen(true)}>Cancel this onboarding…</button></div>;
}

type Body = { l: StageLine; v: View; o: ReturnType<typeof useOnboarding>; busy: boolean; doW: (w: ReturnType<typeof setStage>, ok?: string) => void; run: (f: () => Promise<unknown>, ok?: string) => void; lines: StageLine[]; ready: boolean; independent: boolean; authDone: boolean; version?: Row };

function StageBody(p: Body) {
  const { l, v, o, busy, doW } = p;
  const { s } = o;
  const [why, setWhy] = useState("");
  const onb = v.onb;
  switch (l.def.kind) {
    case "details": {
      const problems = detailsProblems(v.client);
      const done = l.status === "done";
      return (
        <div className="stack" style={{ gap: 6 }}>
          {!done && problems.length > 0 && <ul className="plain">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
          <div className="row-wrap">
            <a className="btn" href={href("clients", str(v.client.Key))}>Open the client record</a>
            {!done && s.pcan("edit") && <button type="button" className="btn primary" disabled={busy || problems.length > 0} onClick={() => doW(setStage(onb, l.def, "done", "", v.client, s.pcan, s.ctx()))}>Confirm the details</button>}
            {done && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={() => doW(setStage(onb, l.def, "todo", "", v.client, s.pcan, s.ctx()))}>Reopen</button>}
          </div>
        </div>
      );
    }
    case "manual": {
      const st = l.status;
      return (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-wrap">
            {st !== "done" && s.pcan("edit") && <button type="button" className="btn primary" disabled={busy} onClick={() => doW(setStage(onb, l.def, "done", why, v.client, s.pcan, s.ctx()))}>Mark done</button>}
            {st === "todo" && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={() => doW(setStage(onb, l.def, "doing", why, v.client, s.pcan, s.ctx()))}>Mark in progress</button>}
            {st !== "na" && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={() => doW(setStage(onb, l.def, "na", why, v.client, s.pcan, s.ctx()))}>Not needed</button>}
            {(st === "done" || st === "na" || st === "doing") && s.pcan("edit") && <button type="button" className="btn" disabled={busy} onClick={() => doW(setStage(onb, l.def, "todo", "", v.client, s.pcan, s.ctx()))}>Reopen</button>}
          </div>
          <input className="input" aria-label={`Note for ${l.def.label}`} placeholder="Note (needed if marking it not needed)" value={why} onChange={(e) => setWhy(e.target.value)} />
          {l.def.key === "agent" && <p className="muted" style={{ margin: 0 }}>Services marked as needing an authorisation are held back at activation until this is done.</p>}
        </div>
      );
    }
    case "engagement": {
      const e = engagementState(str(onb.ClientKey), str(onb.ProposalKey), v.engagements);
      const eng = v.engagements.find((x) => str(x.Ref) === e.ref);
      return (
        <div className="row-wrap">
          {eng ? <a className="btn" href={href("sales", "engagement", str(eng.Key))}>Open {e.ref}</a> : <a className="btn primary" href={href("sales", "proposal", str(onb.ProposalKey))}>Create the letter from the proposal</a>}
          <span className="muted">{ENGAGEMENT_STATE_LABEL[e.state]}. Activation needs a fully signed or filed letter covering the agreed services.</span>
        </div>
      );
    }
    case "portal": return <PortalPanel v={v} />;
    case "aml": return <AmlPanel {...p} />;
    case "approval": {
      const approved = !!str(onb.ApprovedBy);
      return (
        <div className="row-wrap">
          {!approved && o.can("approve") && <button type="button" className="btn primary" disabled={busy} onClick={() => doW(approveOnboarding(onb, p.lines, p.independent, s.pcan, s.ctx()), "Approved.")}>Approve onboarding</button>}
          {approved && o.can("approve") && <button type="button" className="btn" disabled={busy} onClick={() => doW(withdrawApproval(onb, s.pcan, s.ctx()))}>Withdraw approval</button>}
          {!approved && !o.can("approve") && <span className="muted">A reviewer, manager or partner approves.</span>}
          {!approved && !p.ready && <span className="muted">Not ready: {blockers(p.lines)[0]}</span>}
          {p.independent && <span className="muted">Independent review is on: someone other than {str(onb.CreatedBy)} approves.</span>}
        </div>
      );
    }
    case "activation": return <ActivationPanel {...p} />;
    default: return null;
  }
}

// ------------------------------------------------------------------ portal invitation and identity requests

function PortalPanel({ v }: { v: View }) {
  const portal = usePortal();
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState("");
  const rows = portal.forClient(str(v.client.Key));
  if (portal.status && !portal.status.configured) return <p className="import-list warn" role="status">The client portal isn't switched on yet. <a href="#/portal/setup">See what's needed</a>.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.length > 0 && (
        <table className="tbl"><thead><tr><th>Person</th><th>Access</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.person.id}>
              <td>{r.person.name || r.person.email}<div className="muted">{r.person.email}</div></td>
              <td>{r.levelLabel}</td>
              <td><span className={`chip ${r.person.status === "active" ? "green" : "amber"}`}>{r.person.status === "active" ? "Can sign in" : r.person.status === "invited" ? "Invited, not accepted" : r.person.status}</span></td>
              <td><button type="button" className="linkbtn" aria-expanded={open === r.person.id} onClick={() => setOpen(open === r.person.id ? "" : r.person.id)}>Identity documents</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {rows.filter((r) => r.person.id === open).map((r) => <IdentityFor key={r.person.id} person={r.person} />)}
      <p className="muted" style={{ margin: 0 }}>One person can have several businesses on the same login; inviting an email that already has a login adds this business to it. Documents they upload are collected here and checked under the AML stage. Collecting a document does not complete AML.</p>
      <div><button type="button" className="btn" onClick={() => setInviting(!inviting)}>{inviting ? "Close" : "Invite someone to the portal"}</button></div>
      {inviting && <InviteForm clientKey={str(v.client.Key)} onDone={() => setInviting(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ AML: review and approval, separate from collecting documents

function AmlPanel(p: Body) {
  const { v, o, busy, doW } = p;
  const { s, portal } = o;
  const onb = v.onb;
  const saved = readAml(onb.Aml);
  const type = clientTypeFor(str(v.client.Kind));
  const [risk, setRisk] = useState<Risk>(saved.risk);
  const [basis, setBasis] = useState(saved.riskBasis);
  const [owners, setOwners] = useState<Owner[]>(saved.owners);
  const [noOwner, setNoOwner] = useState(saved.noOwnerNote);
  const [checks, setChecks] = useState<Check[]>(saved.checks);
  const [why, setWhy] = useState("");
  const [docs, setDocs] = useState<{ person: string; status: string; label: string }[] | null>(null);
  useEffect(() => { setRisk(saved.risk); setBasis(saved.riskBasis); setOwners(saved.owners); setNoOwner(saved.noOwnerNote); setChecks(saved.checks); }, [onb.Aml]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = portal.forClient(str(v.client.Key));
  useEffect(() => {
    if (!people.length) { setDocs([]); return; }
    let live = true;
    void portal.run((a) => a.identity()).then((r) => { if (live) setDocs(r.items.filter((i) => people.some((x) => x.person.id === i.userId)).map((i) => ({ person: i.person || i.email || "", status: i.status, label: i.title || i.kind }))); }).catch(() => { if (live) setDocs([]); });
    return () => { live = false; };
  }, [people.length, str(v.client.Key)]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = s.pcan("edit");
  const approved = saved.status === "approved";
  const draft: Aml = { ...saved, risk, riskBasis: basis, owners: owners.filter((x) => x.name.trim()), noOwnerNote: noOwner, checks };
  const problems = amlProblems(draft, type);
  const setCheck = (i: number, patch: Partial<Check>) => setChecks(checks.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = () => doW(saveAml(onb, { risk, riskBasis: basis, owners: draft.owners, noOwnerNote: noOwner, checks }, s.pcan, s.ctx()), "AML record saved. Saving does not approve it.");
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="card" style={{ padding: 10 }} role="group" aria-label="Identity documents collected">
        <strong>Documents collected (portal)</strong>
        <p className="muted" style={{ margin: "2px 0 6px" }}>These are only what the client has sent. A document is not a verified identity until a person records a check below.</p>
        {docs === null ? <span className="muted">Loading…</span> : !docs.length ? <span className="muted">No identity documents asked for or received yet. Ask for them from the portal invitation stage.</span> : <ul className="plain">{docs.map((d, i) => <li key={i}>{d.person}: {d.label}, {d.status}</li>)}</ul>}
      </div>

      <fieldset disabled={!edit || approved || busy} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="row-wrap">
          <label className="doc-field"><span>Risk rating</span><select className="input" value={risk} onChange={(e) => setRisk(e.target.value as Risk)}><option value="">Not assessed</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label className="doc-field" style={{ flex: 1, minWidth: 260 }}><span>What the rating is based on</span><input className="input" value={basis} onChange={(e) => setBasis(e.target.value)} /></label>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <strong>Beneficial owners{type === "limited" || type === "llp" ? "" : " (if any)"}</strong>
          {owners.map((x, i) => (
            <div className="inline-form" key={i}>
              <input className="input" aria-label="Owner name" placeholder="Name" value={x.name} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input className="input" style={{ width: 90 }} aria-label="Percentage held" type="number" min={0} max={100} placeholder="%" value={x.percent ?? ""} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, percent: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
              <input className="input" aria-label="Owner note" placeholder="Note (control, nationality…)" value={x.note} onChange={(e) => setOwners(owners.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
              <button type="button" className="linkbtn danger-link" onClick={() => setOwners(owners.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => setOwners([...owners, { name: "", percent: null, note: "" }])}>Add an owner</button></div>
          {!owners.some((x) => x.name.trim()) && <input className="input" aria-label="Why there are none to record" placeholder="If there are none to record, say why" value={noOwner} onChange={(e) => setNoOwner(e.target.value)} />}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <strong>Checks</strong>
          <p className="muted" style={{ margin: 0 }}>Record each check a person has carried out. A specialist AML provider can be recorded here too; the planner doesn't connect to one yet.</p>
          {checks.map((c, i) => (
            <div className="inline-form" key={c.id || i}>
              <select className="input" aria-label="Kind of check" value={c.kind} onChange={(e) => setCheck(i, { kind: e.target.value })}>{CHECK_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
              <select className="input" aria-label="Result" value={c.result} onChange={(e) => setCheck(i, { result: e.target.value as Check["result"] })}><option value="pending">Pending</option><option value="pass">Passed</option><option value="fail">Failed</option></select>
              <input className="input" aria-label="Check note" placeholder="Evidence or note" value={c.note} onChange={(e) => setCheck(i, { note: e.target.value })} />
              {c.by && <span className="muted">{c.by}</span>}
              <button type="button" className="linkbtn danger-link" onClick={() => setChecks(checks.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => setChecks([...checks, { id: "", kind: CHECK_KINDS[0], result: "pending", by: "", at: "", note: "" }])}>Add a check</button></div>
        </div>
        {edit && !approved && <div><button type="button" className="btn primary" onClick={save}>Save the AML record</button></div>}
      </fieldset>

      {!approved && saved.status !== "notstarted" && problems.length > 0 && <div className="import-list warn"><strong>Before this can be approved:</strong><ul className="plain">{problems.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {saved.status === "inprogress" && o.can("approve") && !approved && (
        <div className="row-wrap">
          <button type="button" className="btn primary" disabled={busy} onClick={() => doW(approveAml(onb, v.client, o.settings, p.independent, s.pcan, todayIso(), s.ctx()), "AML approved. The client's AML review date was set.")}>Approve AML</button>
          <input className="input" aria-label="Reason" placeholder="Reason (to decline)" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="btn" disabled={busy} onClick={() => doW(declineAml(onb, why, s.pcan, s.ctx()))}>Don't approve</button>
        </div>
      )}
      {(approved || saved.status === "declined") && o.can("approve") && (
        <div className="row-wrap">
          <input className="input" aria-label="Reason for withdrawing" placeholder="Reason" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="btn" disabled={busy} onClick={() => doW(withdrawAml(onb, why, s.pcan, s.ctx()))}>{approved ? "Withdraw approval" : "Reopen"}</button>
        </div>
      )}
      {p.independent && saved.preparedBy && <p className="muted" style={{ margin: 0 }}>Independent review is on: prepared by {saved.preparedBy}, so someone else approves.</p>}
      {approved && <p className="muted" style={{ margin: 0 }}>Re-verification due {fmtDate(saved.reviewDate)} (set from the {saved.risk} risk rating in Settings › Onboarding).</p>}
    </div>
  );
}

// ------------------------------------------------------------------ activation

function ActivationPanel(p: Body) {
  const { v, o, busy, run } = p;
  const { s, data } = o;
  const onb = v.onb;
  const ver = p.version;
  const agreed = ver ? readAgreed(ver.Agreed) : undefined;
  const plan = agreed ? activationPlan({ agreed, catalogue: s.catalogue, services: data.services, client: v.client, jobs: data.jobs as Row[], start: str(onb.StartDate) || todayIso(), authDone: p.authDone }) : [];
  const b = blockers(p.lines, { includeApproval: true });
  const annual = plan.reduce((a, x) => a + x.annual, 0);
  const go = () => run(async () => {
    if (!ver) return { error: "The accepted proposal version wasn't found." };
    const w = activate({ onb, lines: p.lines, client: v.client, version: ver, services: data.services, catalogue: s.catalogue, clientServices: data.clientServices, jobs: data.jobs as Row[], engagements: data.engagements, authDone: p.authDone, today: todayIso(), can: s.pcan, independent: p.independent, charges: data.feeCharges, reviewMonths: o.fees.reviewMonths, proposalRef: str(data.proposals.find((x) => x.Key === onb.ProposalKey)?.Ref) }, s.ctx());
    if ("error" in w) return w;
    await s.apply(w);
    return undefined;
  }, "Client activated.");
  return (
    <div className="stack" style={{ gap: 8 }}>
      <strong>What activation will do</strong>
      <ul className="plain" style={{ margin: 0 }}>
        <li>Make {str(v.client.Title)} an active client (the existing record, with the lead's history kept).</li>
        <li>Record the agreed fees against the client's services{annual ? `, ${money(annual)} a year in recurring fees` : ""}.</li>
        <li>Create the first job for each service below, with its checklist, period and deadline.</li>
        <li>Link the engagement letter and record the activation in the audit trail.</li>
      </ul>
      {plan.length > 0 && (
        <table className="tbl"><thead><tr><th>Service</th><th>Fee</th><th>What happens</th></tr></thead>
          <tbody>{plan.map((x) => (
            <tr key={x.serviceKey + x.name}>
              <td>{x.name}</td><td>{money(x.fee)} {x.period || "one-off"}</td>
              <td>{x.action === "start" && x.job ? <>Start a job: period to {fmtDate(x.job.PeriodEnd)}, deadline {fmtDate(x.job.Deadline)}{x.job.note ? <div className="muted">{x.job.note}</div> : null}</> : <><span className={`chip ${x.action === "held" ? "amber" : ""}`}>{x.action === "held" ? "Held" : "No job"}</span> <span className="muted">{x.reason}</span></>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {b.length > 0 && <div className="import-list warn"><strong>Not ready to activate:</strong><ul className="plain">{b.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {o.can("activate") ? <div><button type="button" className="btn primary" disabled={busy || b.length > 0} onClick={go}>{busy ? "Activating…" : "Activate client"}</button></div> : <p className="muted" style={{ margin: 0 }}>Only a manager or partner can activate a client.</p>}
    </div>
  );
}

function Activated({ onb, v, o, version, authDone, busy, run }: { onb: Row; v: View; o: ReturnType<typeof useOnboarding>; version?: Row; authDone: boolean; busy: boolean; run: (f: () => Promise<unknown>, ok?: string) => void }) {
  const { s, data } = o;
  const summary = (() => { try { return JSON.parse(str(onb.ActivationSummary) || "{}"); } catch { return {}; } })() as { started?: string[]; held?: string[]; skipped?: string[]; annual?: number };
  const held = summary.held || [];
  const release = () => run(async () => {
    if (!version) return { error: "The accepted proposal version wasn't found." };
    const w = releaseHeld({ onb, client: v.client, version, services: data.services, catalogue: s.catalogue, clientServices: data.clientServices, jobs: data.jobs as Row[], authDone, today: todayIso(), can: s.pcan }, s.ctx());
    if ("error" in w) return w;
    await s.apply(w);
    return undefined;
  }, "Held services started.");
  return (
    <section className="card pad stack" aria-label="Activation result">
      <h3 style={{ margin: 0, fontSize: 15 }}>Activated</h3>
      <p style={{ margin: 0 }}>Started: {summary.started?.length ? summary.started.join(", ") : "no services"}. {summary.annual ? `Recurring fees ${money(summary.annual)} a year.` : ""}</p>
      {!!summary.skipped?.length && <p className="muted" style={{ margin: 0 }}>Not started: {summary.skipped.join("; ")}</p>}
      {held.length > 0 && (
        <div className="import-list warn">
          <p style={{ margin: 0 }}><strong>Held:</strong> {held.join(", ")}. {authDone ? "The authorisation is now recorded, so these can be started." : "These need an agent authorisation. Mark it done in the Agent authorisations stage above (reopen it if needed), then start them here."}</p>
          {authDone && o.can("activate") && <button type="button" className="btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={release}>Start the held services</button>}
        </div>
      )}
    </section>
  );
}

/** A small card on the client page: where their onboarding stands. */
export function ClientOnboardingCard({ clientKey }: { clientKey: string }) {
  const { data } = useData();
  const rows = data.onboardings.filter((x) => x.ClientKey === clientKey).sort((a, b) => str(b.Created).localeCompare(str(a.Created)));
  if (!rows.length) return null;
  return (
    <section className="card pad stack" aria-label="Onboarding">
      <h2 style={{ margin: 0, fontSize: 16 }}>Onboarding</h2>
      <ul className="plain">{rows.map((x) => <li key={str(x.Key)}><a href={href("sales", "onboard", str(x.Key))}>{str(x.Ref)}</a> {x.Status === "activated" ? <span className="chip green">Activated {str(x.ActivatedOn).slice(0, 10)}</span> : x.Status === "cancelled" ? <span className="chip">Cancelled</span> : <span className="chip amber">In progress</span>}</li>)}</ul>
    </section>
  );
}
