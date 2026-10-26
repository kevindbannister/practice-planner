// Engagement letters for clients who are already in the system. A list of who has services no live letter covers, drafts
// built from each client's own services and fees, and moving a batch of drafts through review, approval and sending.
// Rules are in lib/letterGaps.ts and lib/engagements.ts; this file is the screen.
import { useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { DEFAULT_LAYOUT, DocLayout } from "../lib/docModel";
import { asEng, readBody, readList, sealHash, sendOut } from "../lib/engagements";
import { Gap, bulkAdvance, generateBatch, letterGaps } from "../lib/letterGaps";
import { gbp, freqLabel, pence } from "../lib/proposals";
import { href } from "./bits";
import { useData } from "./data";
import { useFiling } from "./EngagementsPage";
import { documentFileName, makePdf, snapshotOf, useDocs } from "./docsKit";
import { say, usePortal } from "./portalKit";
import { useSales } from "./salesKit";
import { Row } from "../lib/schema";

const BATCH = 50;
const SEND_BATCH = 25;
const PDF = "application/pdf";
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const STATE: Record<Gap["state"], [string, string]> = { ready: ["green", "Ready"], "no-fee": ["amber", "No fees recorded"], "not-reviewed": ["amber", "Wording not reviewed"] };

export function LettersForClients() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Gaps />
      <Drafts />
    </div>
  );
}

// ------------------------------------------------------------------ who has no letter

function Gaps() {
  const s = useSales();
  const { data } = useData();
  const [q, setQ] = useState("");
  const [manager, setManager] = useState("");
  const [type, setType] = useState("");
  const [cover, setCover] = useState<"" | "none" | "partial">("");
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [result, setResult] = useState<{ made: { name: string; ref: string }[]; skipped: { name: string; reason: string }[]; remaining: number }>();
  const today = todayIso();
  const docs = useDocs();
  const brand = docs.brand(s.template.brandingId || undefined);
  const practice = brand.tradingName || brand.practiceName || "Our practice";

  const all = useMemo(() => letterGaps({ clients: data.clients, schedule: data.clientServices, services: data.services, catalogue: s.catalogue, engagements: s.engagements, settings: s.eng }), [data.clients, data.clientServices, data.services, s.catalogue, s.engagements, s.eng]);
  const managers = useMemo(() => [...new Set(all.map((g) => g.manager).filter(Boolean))].sort(), [all]);
  const rows = all.filter((g) =>
    (!q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase())) && (!manager || g.manager === manager) && (!type || g.type === type) &&
    (cover === "" || (cover === "none") === !g.hasLetter) && (!ready || g.state === "ready"));
  const pickable = rows.filter((g) => g.state === "ready");
  const chosen = picked.filter((k) => pickable.some((g) => g.clientKey === k));
  const toggle = (k: string) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);

  const draft = async () => {
    setErr(undefined); setResult(undefined); setBusy(true);
    try {
      const r = generateBatch(chosen, { schedule: data.clientServices, services: data.services, catalogue: s.catalogue, settings: s.eng, existing: s.engagements, practice, vatRate: s.vatRate, today, can: s.pcan }, data.clients, s.ctx(), BATCH);
      if (r.made.length) await s.apply(r.written);
      setResult({ made: r.made, skipped: r.skipped, remaining: r.remaining });
      setPicked(picked.filter((k) => !r.made.some((m) => m.clientKey === k)));
    } catch (e) { setErr(say(e) || "That didn't work. Nothing further was made; check the letters list and try again."); } finally { setBusy(false); }
  };

  return (
    <section className="card pad stack" aria-label="Clients without a letter">
      <div>
        <h2 style={{ margin: 0 }}>Clients without a letter</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Active clients with services that no letter in progress or in force covers. Drafts are built from each client's own services and fees as recorded here, not from a proposal, so check the fees before anything is sent.</p>
      </div>
      <div className="row-wrap inline-form" style={{ gap: 10 }}>
        <input className="input" style={{ maxWidth: 220 }} placeholder="Search clients" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Manager" style={{ maxWidth: 180 }} value={manager} onChange={(e) => setManager(e.target.value)}><option value="">Any manager</option>{managers.map((m) => <option key={m}>{m}</option>)}</select>
        <select className="input" aria-label="Client type" style={{ maxWidth: 180 }} value={type} onChange={(e) => setType(e.target.value)}><option value="">Any type</option><option value="individual">Individual</option><option value="limited">Limited company</option><option value="llp">LLP</option><option value="partnership">Partnership</option></select>
        <select className="input" aria-label="Cover" style={{ maxWidth: 200 }} value={cover} onChange={(e) => setCover(e.target.value as typeof cover)}><option value="">No letter or part-covered</option><option value="none">No letter at all</option><option value="partial">Some services covered</option></select>
        <label className="row-wrap"><input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} /> Ready only</label>
      </div>
      {!all.length ? <p className="muted" style={{ margin: 0 }}>Every active client's services are covered by a letter.</p> : !rows.length ? <p className="muted" style={{ margin: 0 }}>Nothing matches those filters.</p> : (
        <>
          <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
            <strong>{rows.length}</strong> <span className="muted">client{rows.length === 1 ? "" : "s"} · {pickable.length} ready{rows.some((g) => g.state === "no-fee") ? ` · ${rows.filter((g) => g.state === "no-fee").length} have no fees recorded (add them in each client's fee schedule, then they can be drafted)` : ""}</span>
            {s.pcan("edit") && <>
              <button type="button" className="btn" onClick={() => setPicked(chosen.length === pickable.length ? [] : pickable.map((g) => g.clientKey))}>{chosen.length === pickable.length && pickable.length ? "Clear selection" : `Select the ${pickable.length} ready`}</button>
              <button type="button" className="btn primary" disabled={busy || !chosen.length} onClick={draft}>{busy ? "Drafting…" : `Draft letters for ${chosen.length} selected`}</button>
            </>}
            {chosen.length > BATCH && <span className="muted">The first {BATCH} are made each time; run it again for the rest.</span>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th style={{ width: 28 }}></th><th>Client</th><th>Manager</th><th>Services without a letter</th><th>Position</th></tr></thead>
              <tbody>{rows.map((g) => (
                <tr key={g.clientKey}>
                  <td><input type="checkbox" aria-label={`Select ${g.name}`} disabled={g.state !== "ready" || !s.pcan("edit")} checked={chosen.includes(g.clientKey)} onChange={() => toggle(g.clientKey)} /></td>
                  <td><a href={href("clients", g.clientKey)}>{g.name}</a><div className="muted" style={{ fontSize: 12 }}>{g.hasLetter ? "Some services covered" : "No letter"}</div></td>
                  <td>{g.manager || "—"}</td>
                  <td>{g.uncovered.map((l) => <div key={l.serviceKey}>{l.name} <span className="muted">{l.included ? "included in package" : `${gbp(pence(l.price))} ${freqLabel(l.frequency).toLowerCase()}`}</span></div>)}</td>
                  <td><span className={`chip ${STATE[g.state][0]}`}>{STATE[g.state][1]}</span>{g.reason && g.state !== "no-fee" && <div className="muted" style={{ fontSize: 12 }}>{g.reason}</div>}{g.warnings.map((w) => <div key={w} className="muted" style={{ fontSize: 12 }}>{w}</div>)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {result && (
        <div role="status" className="card" style={{ padding: 12 }}>
          <strong>{result.made.length} draft{result.made.length === 1 ? "" : "s"} made.</strong> {result.made.length ? "They are in the list below, ready for review." : ""}
          {result.remaining > 0 && <div>{result.remaining} more selected: run it again to make them.</div>}
          {result.skipped.length > 0 && <><div style={{ marginTop: 6 }}>Not made ({result.skipped.length}):</div><ul className="plain" style={{ margin: "4px 0 0" }}>{result.skipped.map((k) => <li key={k.name}>{k.name}: <span className="muted">{k.reason}</span></li>)}</ul></>}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ drafts built from the schedule: review, approve, send

function Drafts() {
  const s = useSales();
  const { data } = useData();
  const docs = useDocs();
  const portal = usePortal();
  const file = useFiling();
  const today = todayIso();
  const brand = docs.brand(s.template.brandingId || undefined);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string[]>([]);
  const [err, setErr] = useState<string>();
  const [sure, setSure] = useState(false);

  const rows = s.engagements.filter((e) => String(e.Basis) === "schedule" && ["draft", "review", "approved"].includes(asEng(e.Status))).sort((a, b) => String(a.Ref).localeCompare(String(b.Ref)));
  const sel = rows.filter((e) => picked.includes(String(e.Key)));
  const nameOf = (e: Row) => data.clients.find((c) => c.Key === e.ClientKey)?.Title || "Client";
  const toggle = (k: string) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  const chip = (e: Row) => { const st = asEng(e.Status); return <span className={`chip ${st === "approved" ? "green" : st === "review" ? "blue" : ""}`}>{st === "approved" ? "Approved" : st === "review" ? "In review" : "Draft"}</span>; };

  const guard = async (fn: () => Promise<string[] | void>) => {
    setErr(undefined); setNote([]); setBusy(true);
    try { const r = await fn(); if (r) setNote(r); } catch (e) { setErr(say(e) || "That didn't work. Check the list and try again."); } finally { setBusy(false); }
  };
  const step = (to: "review" | "approved") => guard(async () => {
    const r = bulkAdvance(sel, to, s.cfg.independentReview, s.pcan, s.ctx());
    if (r.moved.length) await s.apply(r.written);
    return [`${r.moved.length} letter${r.moved.length === 1 ? "" : "s"} ${to === "review" ? "submitted for review" : "approved"}.`, ...r.skipped.map((x) => `${x.ref}: ${x.reason}`)];
  });

  const send = (method: "paper" | "portal") => guard(async () => {
    if (!s.pcan("send")) throw new Error("Only a manager or partner can send engagement letters.");
    const todo = sel.filter((e) => asEng(e.Status) === "approved").slice(0, SEND_BATCH);
    if (!todo.length) throw new Error("Choose letters that have been approved.");
    const done: string[] = [], out: string[] = [];
    for (const e of todo) {
      const client = data.clients.find((c) => c.Key === e.ClientKey);
      const label = `${e.Ref} ${client?.Title || ""}`;
      try {
        const people = method === "portal" ? portal.forClient(String(e.ClientKey)).filter((r) => r.person.status === "active") : [];
        if (method === "portal" && !people.length) { out.push(`${label}: nobody at this client has an active portal login. Send it on paper or invite them first.`); continue; }
        const layout: DocLayout = { ...DEFAULT_LAYOUT, header: brand.header || "", footer: brand.footer || "" };
        const body = readBody(e.Body);
        const title = String(e.Title);
        const pdf = await makePdf({ content: body, layout, branding: brand, title, reference: String(e.Ref), author: s.me });
        const hash = await sealHash(String(e.Body));
        const name = documentFileName(label, today, "");
        const { row } = await file(pdf.bytes, name, title, client?.Title || "", String(e.ClientKey), String(e.Ref), { BrandingId: brand.id, Pages: pdf.pages, Snapshot: snapshotOf(body, layout, { engagement: e.Ref }) });
        let w;
        if (method === "portal") {
          const cats = await portal.run((a) => a.documents(String(e.ClientKey)));
          const category = cats.categories.find((c) => /engagement/i.test(c)) || cats.categories[0] || "Other";
          const d = await portal.run((a) => a.addDocument({ clientKey: String(e.ClientKey), title, category, fileName: `${name}.pdf`.replace(/\.pdf\.pdf$/, ".pdf"), content: b64(pdf.bytes), publish: false, notify: false, assignedTo: [], requiresApproval: false }));
          const req = await portal.run((a) => a.createSigning({ clientKey: String(e.ClientKey), docId: d.document.id, title, signatoryIds: people.map((p) => p.person.id), sequential: false, message: "Please read and sign our engagement letter.", expiresInDays: 30 }));
          w = sendOut(e, { hash, portalDocId: d.document.id, signingId: req.request.id, docKey: String(row.Key), signatories: req.request.signatories.map((x) => x.name), method: "portal" }, client, s.pcan, today, s.ctx());
        } else {
          w = sendOut(e, { hash, docKey: String(row.Key), signatories: readList(e.Signatories), method: "paper" }, client, s.pcan, today, s.ctx());
        }
        if ("error" in w) { out.push(`${label}: ${w.error}`); continue; }
        await s.apply(w);
        done.push(label);
        setPicked((p) => p.filter((k) => k !== String(e.Key)));
      } catch (x) { out.push(`${label}: ${say(x) || "failed"}`); }
    }
    const left = sel.filter((e) => asEng(e.Status) === "approved").length - todo.length;
    return [`${done.length} letter${done.length === 1 ? "" : "s"} ${method === "portal" ? "sent for signature through the portal" : "issued on paper"}.`, ...out, ...(left > 0 ? [`${left} more selected: run it again to send them.`] : [])];
  });

  if (!rows.length && !note.length) return null;
  const approvedN = sel.filter((e) => asEng(e.Status) === "approved").length;
  return (
    <section className="card pad stack" aria-label="Drafts for existing clients">
      <div>
        <h2 style={{ margin: 0 }}>Letters built from client records</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Drafts made above, until they are sent. Open one to read or change it; submit, approve and send them here in batches. Each letter is checked on its own, and a letter you prepared can't be approved by you if approval has to be independent.</p>
      </div>
      <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn" onClick={() => setPicked(sel.length === rows.length ? [] : rows.map((e) => String(e.Key)))}>{sel.length === rows.length && rows.length ? "Clear selection" : `Select all ${rows.length}`}</button>
        {s.pcan("edit") && <button type="button" className="btn" disabled={busy || !sel.some((e) => asEng(e.Status) === "draft")} onClick={() => step("review")}>Submit for review</button>}
        {s.pcan("approve") && <button type="button" className="btn" disabled={busy || !sel.some((e) => ["draft", "review"].includes(asEng(e.Status)))} onClick={() => step("approved")}>Approve</button>}
        {s.pcan("send") && <>
          <label className="row-wrap"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I've read these letters and want to send {approvedN} approved</label>
          <button type="button" className="btn primary" disabled={busy || !sure || !approvedN} onClick={() => send("portal")}>Send through the portal</button>
          <button type="button" className="btn" disabled={busy || !sure || !approvedN} onClick={() => send("paper")}>Issue on paper</button>
        </>}
        {busy && <span className="muted" role="status">Working…</span>}
      </div>
      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th style={{ width: 28 }}></th><th>Letter</th><th>Client</th><th>Services</th><th>Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={String(e.Key)}>
                <td><input type="checkbox" aria-label={`Select ${String(e.Ref)}`} checked={picked.includes(String(e.Key))} onChange={() => toggle(String(e.Key))} /></td>
                <td><a href={href("sales", "engagement", String(e.Key))}>{String(e.Ref)}</a></td>
                <td>{nameOf(e)}</td>
                <td>{readList(e.ServiceNames).join(", ")}</td>
                <td>{chip(e)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {note.length > 0 && <div role="status" className="card" style={{ padding: 12 }}>{note.map((n, i) => <div key={i} style={i ? { marginTop: 4 } : undefined}>{n}</div>)}</div>}
    </section>
  );
}
