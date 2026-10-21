// Importing a working paper workbook into a company's papers for a year: the preview says what was
// found and what needs a look, then the chosen parts are written (replacing what's there for them).
import { useState } from "react";
import { Client } from "../lib/domain";
import { priorPeriod } from "../lib/papers";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { ImportLine, ImportPlan, planImport } from "../lib/workbookImport";
import { readXlsx } from "../lib/xlsxRead";
import { useData } from "./data";
import { useWriterState } from "./PaperSchedules";

type Part = "tb" | "journals" | "registers" | "queries" | "info" | "prior";
const PART_LABEL: Record<Part, string> = {
  tb: "Year end trial balance (software)", journals: "Journals and opening balance differences", registers: "Fixed asset registers",
  queries: "Notes and queries", info: "Job information", prior: "Last year's trial balance",
};

const normCo = (s: string) => s.toLowerCase().replace(/\b(limited|ltd|the|plc|llp)\b/g, "").replace(/[^a-z0-9]+/g, "");

export function WorkbookImport({ client, period }: { client: Client; period: string }) {
  const { data, createMany, removeMany } = useData();
  const w = useWriterState();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ImportPlan>();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [parts, setParts] = useState<Set<Part>>(new Set(["tb", "journals", "registers", "queries", "info", "prior"]));
  const prior = priorPeriod(period);

  const mine = (p: string, sec: string, sub?: string) =>
    data.paperLines.filter((r) => r.ClientKey === client.Key && r.PeriodEnd === p && r.SectionKey === sec && (!sub || (r.SubKey || "main") === sub));
  const have: Record<Part, number> = {
    tb: mine(period, "tb", "main").length,
    journals: mine(period, "journals", "main").length + mine(period, "journals", "obd").length,
    registers: (plan?.registers || []).reduce((a, g) => a + mine(period, "fixed", g.sub).length, 0),
    queries: mine(period, "queries", "main").length,
    info: 0,
    prior: mine(prior, "tb", "main").length,
  };
  const count: Record<Part, number> = {
    tb: plan?.tb.length || 0, journals: (plan?.journals.length || 0) + (plan?.obd.length || 0), registers: (plan?.registers || []).reduce((a, g) => a + g.lines.length, 0),
    queries: plan?.queries.length || 0, info: plan && Object.keys(plan.info).length ? 1 : 0, prior: plan?.priorTb.length || 0,
  };

  const choose = async (file?: File) => {
    setError(undefined);
    setPlan(undefined);
    setDone(undefined);
    if (!file) return;
    setFileName(file.name);
    try {
      const book = await readXlsx(new Uint8Array(await file.arrayBuffer()));
      const p = planImport(book, period);
      if (!p.tb.length && !p.journals.length && !p.registers.length) throw new Error("nothing");
      setPlan(p);
      // last year's trial balance only comes in if last year has none
      setParts(new Set((Object.keys(PART_LABEL) as Part[]).filter((k) => (k !== "prior" || !mine(prior, "tb", "main").length) && (k === "info" ? Object.keys(p.info).length : true))));
    } catch (e) {
      setError(e instanceof Error && e.message === "nothing"
        ? "That workbook doesn't have a trial balance sheet (TB and the year, with a Description column), journals or fixed asset registers this can read."
        : "That file couldn't be read. It needs to be an Excel workbook (.xlsx or .xlsm).");
    }
  };

  const linesToRows = (p: string, sec: string, sub: string, list: ImportLine[]): Row[] => {
    const now = new Date().toISOString();
    return list.map((x, i) => {
      const f = Object.fromEntries(Object.entries(x.f || {}).filter(([, v]) => v !== undefined && v !== ""));
      return {
        Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: p, SectionKey: sec, SubKey: sub,
        Code: x.Code || undefined, Detail: x.Detail || undefined, Amount: x.Amount, Remark: x.Remark || undefined,
        Figures: Object.keys(f).length ? JSON.stringify(f) : undefined, Seq: i + 1, Updated: now,
      };
    });
  };

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setError(undefined);
    try {
      const out: Row[] = [], old: Row[] = [];
      const put = (p: string, sec: string, sub: string, list: ImportLine[]) => {
        old.push(...mine(p, sec, sub));
        out.push(...linesToRows(p, sec, sub, list));
      };
      if (parts.has("tb")) put(period, "tb", "main", plan.tb);
      if (parts.has("journals")) { put(period, "journals", "obd", plan.obd); put(period, "journals", "main", plan.journals); }
      if (parts.has("registers")) for (const g of plan.registers) put(period, "fixed", g.sub, g.lines);
      if (parts.has("queries")) put(period, "queries", "main", plan.queries);
      if (parts.has("prior") && plan.priorTb.length) put(prior, "tb", "main", plan.priorTb);
      if (old.length) await removeMany("PaperLines", old);
      if (out.length) await createMany("PaperLines", out);
      if (parts.has("registers")) for (const g of plan.registers) await w.writeSetup(`fixed/${g.sub}`, g.setup);
      if (parts.has("info") && Object.keys(plan.info).length) await w.writeSetup("info/main", plan.info);
      setDone(`Imported ${out.length} lines from ${fileName}. The Accounts summary (under Trial balance) shows whether everything agrees.`);
      setPlan(undefined);
    } catch {
      setError("Not everything saved. Try the import again; it replaces what it put in.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" onClick={() => setOpen(true)}>Import a working paper workbook</button>
        {done && <span className="muted" role="status" style={{ fontSize: 13 }}>{done}</span>}
      </div>
    );
  }
  const wrongCompany = plan?.company && normCo(plan.company) !== normCo(client.Title);
  return (
    <section className="card pad stack import-panel" aria-label="Import a working paper workbook">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Import a working paper workbook</h3>
        <button type="button" className="linkbtn" onClick={() => { setOpen(false); setPlan(undefined); }}>Close</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        An Excel working paper with a Control Sheet, Notes, "TB {period.slice(0, 4)}" (and last year's), Journals and Fixed Assets sheets. Each part you tick replaces what's in the papers for it.
      </p>
      <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" aria-label="Workbook file" onChange={(e) => void choose(e.target.files?.[0])} />
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      {done && <p className="muted" role="status" style={{ margin: 0 }}>{done}</p>}
      {plan && (
        <div className="stack" style={{ gap: 10 }}>
          {wrongCompany && <div className="alert amber"><strong>Different company?</strong><span>The workbook is for {plan.company}; these papers are {client.Title}.</span></div>}
          <div>
            <strong style={{ fontSize: 14 }}>Found</strong>
            <ul className="import-list">{plan.found.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          {plan.problems.length > 0 && (
            <div>
              <strong style={{ fontSize: 14 }}>Worth a look</strong>
              <ul className="import-list warn">{plan.problems.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          <fieldset className="import-parts">
            <legend>Bring in</legend>
            {(Object.keys(PART_LABEL) as Part[]).filter((k) => count[k]).map((k) => (
              <label key={k} className="row-wrap" style={{ gap: 8 }}>
                <input type="checkbox" checked={parts.has(k)} onChange={(e) => setParts((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                <span>{PART_LABEL[k]}{k === "prior" ? ` (${prior.slice(0, 4)})` : ""}: {k === "info" ? "nature of business, VAT, software" : `${count[k]} lines`}</span>
                {have[k] > 0 && parts.has(k) && <span className="muted" style={{ fontSize: 12 }}>replaces {have[k]} line{have[k] === 1 ? "" : "s"} already there</span>}
              </label>
            ))}
          </fieldset>
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={busy || !parts.size} onClick={() => void run()}>{busy ? "Importing…" : "Import"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
