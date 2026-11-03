// Bringing in a client's past tax returns from IRIS Elements all at once: pick the client, drop the PDF IRIS printed for each tax
// year (they are matched to years by what is in them, or dropped on a year's row), look over what was found for each year, and
// import the lot. Each year is saved as that year's return for the client, the same as a return imported one at a time.
import { useEffect, useMemo, useState } from "react";
import { Client, todayIso } from "../lib/domain";
import { SECTIONS, TaxReturn, hasSection, readReturn, rollForward } from "../lib/tax";
import { readSetup, setupRow } from "../lib/papers";
import { newKey } from "../lib/planning";
import { readIrisPdf } from "../lib/taxFile";
import { ImportFile, ImportResult, checkImport, readImport } from "../lib/taxImport";
import { YEARS, yearEnd, yearLabel, yearOf } from "../lib/taxRates";
import type { Row } from "../lib/schema";
import { Icon, href } from "./bits";
import { useData } from "./data";
import { KIND_LABEL } from "./TaxReturnView";

const TAX_ITEM = "_tax"; // where a return is kept (WorkingPapers.ItemKey), the same as TaxPage
const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber;
const gbp = (v: number) => `${v < 0 ? "-" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const same = (a?: unknown, b?: unknown) => String(a || "").replace(/\s/g, "").toUpperCase() === String(b || "").replace(/\s/g, "").toUpperCase();

type Progress = { y: number; state: "wait" | "doing" | "done" | "failed" };

export function BulkImportDialog({ clients, clientKey, onClose }: { clients: Client[]; clientKey?: string; onClose: () => void }) {
  const { data, create, update, updateMany } = useData();
  const [ck, setCk] = useState(clientKey || "");
  const [q, setQ] = useState("");
  const [slots, setSlots] = useState<Record<number, ImportFile[]>>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(0);
  const [replace, setReplace] = useState<Record<number, boolean>>({});
  const [anyway, setAnyway] = useState<Record<number, boolean>>({});
  const [notSubmitted, setNotSubmitted] = useState<Record<number, boolean>>({});
  const [run, setRun] = useState<Progress[] | null>(null);
  const [saving, setSaving] = useState(false);
  const client = clients.find((c) => c.Key === ck);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose, saving]);

  const companyNames = useMemo(() => (data.clients as Client[]).filter(isCompany).map((x) => String(x.Title || "")), [data.clients]);
  const thisYear = yearOf(todayIso());
  const years = useMemo(() => [...new Set([...YEARS.map((r) => r.year).filter((y) => y < thisYear), ...Object.keys(slots).filter((y) => slots[Number(y)]?.length).map(Number)])].sort((a, b) => a - b), [slots, thisYear]);
  const results = useMemo(() => {
    const out: Record<number, { res: ImportResult; chk: ReturnType<typeof checkImport> }> = {};
    for (const y of years) { const fs = slots[y]; if (fs?.length) { const res = readImport(fs, companyNames); out[y] = { res, chk: checkImport({ ...res, year: y }) }; } }
    return out;
  }, [slots, years, companyNames]);

  /** What this client already has for a year: nothing, an empty draft (replaced without asking), or a return with figures. */
  const existing = (y: number) => {
    const row = ck ? setupRow(data.papers, ck, yearEnd(y), TAX_ITEM) : undefined;
    if (!row) return undefined;
    const r = readReturn(readSetup(row).r);
    const figures = SECTIONS.some((s) => s.key !== "front" && s.key !== "payments" && hasSection(r, s.key)) || !!r.imported || r.status?.state === "submitted";
    return { row, r, figures };
  };

  const take = async (list: File[], forYear?: number) => {
    setReading((n) => n + 1);
    const msgs: string[] = [], adds: { y: number; file: ImportFile }[] = [];
    for (const f of list) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { msgs.push(`${f.name} isn't a PDF.`); continue; }
      try {
        const file = await readIrisPdf(f.name, new Uint8Array(await f.arrayBuffer()));
        const y = readImport([file]).year ?? forYear;
        if (!y) { msgs.push(`${f.name}: the tax year couldn't be found in it. Choose it on the year's own row.`); continue; }
        if (!YEARS.some((r) => r.year === y)) { msgs.push(`${f.name} is for ${yearLabel(y)}, which isn't one of the years held (${yearLabel(YEARS[0].year)} onwards).`); continue; }
        if (forYear && y !== forYear) msgs.push(`${f.name} is for ${yearLabel(y)}, so it went on that row.`);
        adds.push({ y, file });
      } catch { msgs.push(`${f.name} couldn't be read. Use the PDFs IRIS Elements prints (not scans).`); }
    }
    setSlots((prev) => {
      const out = { ...prev };
      for (const { y, file } of adds) {
        // a full return replaces an earlier one for the year; the calculation and summaries on their own add to each other
        const keep = (out[y] || []).filter((c) => c.name !== file.name && !(file.forms?.length && c.forms?.length));
        out[y] = [...keep, file];
      }
      return out;
    });
    setNotes(msgs);
    setReading((n) => n - 1);
  };
  const clear = (y: number) => setSlots((prev) => { const out = { ...prev }; delete out[y]; return out; });

  const state = (y: number) => {
    const t = results[y];
    if (!t) return undefined;
    const ex = existing(y);
    const utr = String(client?.UTR || "");
    const clash = !!(t.res.utr && utr && !same(t.res.utr, utr));
    const blocked = !t.res.found.length ? "Nothing was found to bring in." : ex?.figures && !replace[y] ? "Already has a return" : clash && !anyway[y] ? "Check the client" : "";
    return { ...t, ex, clash, blocked };
  };
  const ready = years.filter((y) => state(y) && !state(y)!.blocked);

  const go = async () => {
    if (!client || !ready.length) return;
    setSaving(true);
    setRun(ready.map((y) => ({ y, state: "wait" })));
    const done = new Map<number, TaxReturn>();
    for (const y of ready) {
      setRun((p) => p && p.map((x) => (x.y === y ? { ...x, state: "doing" } : x)));
      try {
        const t = state(y)!;
        const prevRow = setupRow(data.papers, client.Key, yearEnd(y - 1), TAX_ITEM);
        const prevRet = done.get(y - 1) || (prevRow ? readReturn(readSetup(prevRow).r) : undefined);
        const rolled = prevRet ? rollForward(prevRet, y - 1) : undefined;
        const r0 = t.res.ret;
        let r: TaxReturn = {
          ...r0,
          front: { ...r0.front, utr: r0.front.utr || String(client.UTR || "") || undefined, nino: r0.front.nino || String(client.NINumber || "") || undefined, dob: r0.front.dob || String(client.DateOfBirth || "") || undefined },
          status: notSubmitted[y] ? { state: "draft" } : { state: "submitted", irmark: t.res.irmark },
          imported: { from: "IRIS Elements", on: todayIso(), files: slots[y].map((f) => f.name) },
        };
        // payments on account expected this year follow from last year's return (unless the PDFs said what was paid)
        if (!r.payments.paidDifferent && rolled) r = { ...r, payments: { ...r.payments, expectedPoa1: rolled.expectedPoa1, expectedPoa2: rolled.expectedPoa2, expectedFrom: `the ${yearLabel(y - 1)} return`, priorLiability: r.payments.priorLiability ?? rolled.liability } };
        const period = yearEnd(y), row = t.ex?.row;
        const values = { Setup: JSON.stringify({ ...(row ? readSetup(row) : {}), r }), Updated: new Date().toISOString() };
        if (row) await update("WorkingPapers", row, values);
        else await create("WorkingPapers", { Key: newKey("WP"), ClientKey: client.Key, PeriodEnd: period, ItemKey: TAX_ITEM, Status: "todo", ...values });
        // the section statuses and notes from the return being replaced no longer apply
        const stale = (data.papers as Row[]).filter((x) => x.ClientKey === client.Key && x.PeriodEnd === period && String(x.ItemKey || "").startsWith("tax/"));
        if (stale.length) await updateMany("WorkingPapers", stale.map((x) => ({ row: x, patch: { Status: "todo", Note: "", Setup: "{}" } })));
        done.set(y, r);
        setRun((p) => p && p.map((x) => (x.y === y ? { ...x, state: "done" } : x)));
      } catch {
        setRun((p) => p && p.map((x) => (x.y === y ? { ...x, state: "failed" } : x)));
      }
    }
    setSaving(false);
  };

  const list = clients.filter((c) => !q || String(c.Title).toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const finished = !!run && !saving;
  const imported = run?.filter((x) => x.state === "done").length || 0;
  return (
    <div className="tax-add-sheet" role="presentation" onClick={() => !saving && onClose()}>
      <div className="tax-add-card tax-import tax-bulk" role="dialog" aria-modal="true" aria-label="Import past tax returns" onClick={(e) => e.stopPropagation()}>
        <div className="quick-journal-head">
          <strong><Icon name="download" size={16} /> Import past returns</strong>
          <span className="quick-journal-note">{client ? client.Title : "from IRIS Elements"}</span>
          <button type="button" className="quick-journal-x" onClick={onClose} disabled={saving} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        {run ? (
          <div className="stack" style={{ gap: 8 }}>
            {run.map((x) => (
              <div key={x.y} className="row-wrap" style={{ gap: 8 }}>
                <strong style={{ minWidth: 70 }}>{yearLabel(x.y)}</strong>
                {x.state === "wait" && <span className="muted">Waiting</span>}
                {x.state === "doing" && <span className="muted">Saving…</span>}
                {x.state === "done" && <><span className="ok-text">Imported</span><a href={href("tax", ck, String(x.y))} onClick={onClose}>Open the return</a></>}
                {x.state === "failed" && <span className="error-text" role="alert">Didn't save. Close this and try that year again.</span>}
              </div>
            ))}
            {finished && <p className="muted" style={{ margin: 0 }}>{imported} of {run.length} return{run.length === 1 ? "" : "s"} imported for {client?.Title}. Open each one to check it against IRIS.</p>}
            <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" className="btn primary" disabled={saving} onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="stack" style={{ gap: 12 }}>
              {!clientKey && (
                <label className="field"><span>Client</span>
                  <input className="input" placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a client" />
                  <select className="input" size={5} value={ck} onChange={(e) => setCk(e.target.value)} aria-label="Client">{list.map((c) => <option key={c.Key} value={c.Key}>{c.Title}{c.UTR ? ` · ${String(c.UTR)}` : ""}</option>)}</select>
                </label>
              )}
              {client ? (
                <>
                  <label className="tax-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void take(Array.from(e.dataTransfer.files)); }}>
                    <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { void take(Array.from(e.target.files || [])); e.target.value = ""; }} aria-label="Choose the PDFs for all the years" />
                    <span><Icon name="download" size={16} /> {reading ? "Reading…" : "Drop the IRIS PDFs for every year here, or choose them. They're matched to years from what's in them."}</span>
                  </label>
                  {notes.map((n) => <p key={n} className="warn" style={{ margin: 0 }}>{n}</p>)}
                  <div className="stack" style={{ gap: 8 }}>
                    {years.map((y) => {
                      const s = state(y);
                      return (
                        <div key={y} className={`tax-bulk-row${s ? "" : " empty"}`}>
                          <strong>{yearLabel(y)}</strong>
                          {!s ? (
                            <label className="tax-bulk-pick muted">
                              <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { void take(Array.from(e.target.files || []), y); e.target.value = ""; }} aria-label={`Choose the PDF for ${yearLabel(y)}`} />
                              <span>No file. Drop one here or choose it.</span>
                            </label>
                          ) : (
                            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                              <div className="row-wrap" style={{ gap: 6 }}>
                                {s.res.kinds.map((k) => <span key={k} className="chip blue">{KIND_LABEL[k]}</span>)}
                                {s.res.utr && <span className={`chip mono${s.clash ? " red" : ""}`}>UTR {s.res.utr}</span>}
                                <span className="muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{slots[y].map((f) => f.name).join(", ")}</span>
                              </div>
                              {s.res.found.length > 0 && <ul className="tax-found">{s.res.found.slice(0, 4).map((f) => <li key={f}>{f}</li>)}{s.res.found.length > 4 && <li className="muted">and {s.res.found.length - 4} more</li>}</ul>}
                              {s.chk.theirs !== undefined
                                ? <p className={s.chk.matches ? "ok-text" : "warn"} style={{ margin: 0, fontSize: 13 }}>{s.chk.matches ? `Matches IRIS: total tax ${gbp(s.chk.ours)}.` : `IRIS worked out ${gbp(s.chk.theirs)}; this comes to ${gbp(s.chk.ours)}. Check it after importing.`}</p>
                                : <p className="muted" style={{ margin: 0, fontSize: 13 }}>Total tax from these figures: {gbp(s.chk.ours)} (the files don't give IRIS's to compare).</p>}
                              {s.res.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0, fontSize: 13 }}>{w}</p>)}
                              {s.clash && <label className="row-wrap" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!anyway[y]} onChange={(e) => setAnyway({ ...anyway, [y]: e.target.checked })} /> <span className="warn">The UTR in the file isn't {client.Title}'s ({String(client.UTR)}). Import anyway</span></label>}
                              {s.ex?.figures && <label className="row-wrap" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!replace[y]} onChange={(e) => setReplace({ ...replace, [y]: e.target.checked })} /> <span className="warn">There's already a {yearLabel(y)} return with figures on it. Replace it</span></label>}
                              <label className="row-wrap" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!notSubmitted[y]} onChange={(e) => setNotSubmitted({ ...notSubmitted, [y]: !e.target.checked })} /> This return was submitted to HMRC</label>
                            </div>
                          )}
                          <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
                            {s && <span className={s.blocked ? "chip" : "chip green"}>{s.blocked || "Ready"}</span>}
                            {s && <button type="button" className="btn small" onClick={() => clear(y)} aria-label={`Remove the file for ${yearLabel(y)}`}>Remove</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <p className="muted" style={{ margin: 0 }}>Choose the client first.</p>}
            </div>
            <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={!client || !ready.length || !!reading} onClick={() => void go()}>{ready.length ? `Import ${ready.length} return${ready.length === 1 ? "" : "s"}` : "Import"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
