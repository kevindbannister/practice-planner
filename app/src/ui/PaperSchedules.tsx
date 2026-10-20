// The schedules inside a working paper section: one editor that lays out the columns of any kind
// of schedule (list, asset register, account, VAT, payroll, expense, trial balance, journals...),
// the settings each kind needs (depreciation method and rate, balance brought forward, accruals,
// fee), and the summaries (lead schedule, fixed asset summary, final trial balance).
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import {
  AssetTotals, Col, DEFAULT_LINES, INFO_FIELDS, KIND_COLS, KIND_NAMES, Kind, Line, Section, Setup, Sub, accountCf, carryLines, carrySetup,
  colTotal, colValue, expenseCharge, finalTb, journalTotals, leadRows, linesFor, money, parseAmount, parseGrid, priorFor, priorPeriod,
  registerTotals, setupKey, setupOf, setupRow, readSetup, subsFor, vatOwed,
} from "../lib/papers";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Icon, companiesHouseUrl } from "./bits";
import { useData } from "./data";

// ------------------------------------------------------------------ saving

type NewLine = { Code?: string; Detail?: string; Amount?: number; Remark?: string; f?: Record<string, unknown> };
type Writer = {
  client: Client; period: string; busy: boolean; error?: string;
  setup: (itemKey: string) => Setup;
  writeSetup: (itemKey: string, patch: Setup, fields?: Row) => Promise<void>;
  addLines: (sectionKey: string, subKey: string, list: NewLine[], from?: number) => Promise<void>;
  patchLine: (l: Line, patch: Omit<NewLine, "f"> & { Done?: boolean; f?: Record<string, unknown> }) => Promise<void>;
  removeLine: (l: Line) => Promise<void>;
};
const WriterContext = createContext<Writer | null>(null);
const useWriter = () => useContext(WriterContext)!;

export function PaperWriter({ client, period, children }: { client: Client; period: string; children: ReactNode }) {
  const { data, update, create, createMany, remove } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const safely = async (work: () => Promise<unknown>) => {
    setError(undefined);
    setBusy(true);
    try {
      await work();
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const now = () => new Date().toISOString();
  const lineRow = (sectionKey: string, subKey: string, x: NewLine, seq: number): Row => ({
    Key: newKey("PL"), ClientKey: client.Key, PeriodEnd: period, SectionKey: sectionKey, SubKey: subKey,
    Code: x.Code || undefined, Detail: x.Detail || undefined, Amount: x.Amount, Remark: x.Remark || undefined,
    Figures: x.f && Object.keys(x.f).length ? JSON.stringify(x.f) : undefined, Seq: seq, Updated: now(),
  });
  const w: Writer = {
    client, period, busy, error,
    setup: (itemKey) => setupOf(data.papers, client.Key, period, itemKey),
    writeSetup: (itemKey, patch, fields = {}) =>
      safely(async () => {
        const row = setupRow(data.papers, client.Key, period, itemKey);
        const next = { ...readSetup(row), ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        const values = { ...fields, Setup: JSON.stringify(next), Updated: now() };
        if (row) await update("WorkingPapers", row, values);
        else await create("WorkingPapers", { Key: newKey("WP"), ClientKey: client.Key, PeriodEnd: period, ItemKey: itemKey, Status: "todo", ...values });
      }),
    addLines: (sectionKey, subKey, list, from) =>
      safely(async () => {
        const have = linesFor(data.paperLines, client.Key, period, sectionKey, subKey);
        let seq = from ?? have.reduce((m, l) => Math.max(m, l.Seq), 0) + 1;
        const rows = list.map((x) => lineRow(sectionKey, subKey, x, seq++));
        if (rows.length === 1) await create("PaperLines", rows[0]);
        else await createMany("PaperLines", rows);
      }),
    patchLine: (l, patch) =>
      safely(async () => {
        const { f, ...own } = patch;
        const values: Row = { ...(own as Row), Updated: now() };
        for (const k of Object.keys(values)) if (values[k] === undefined) values[k] = "";
        if (f) {
          const merged = { ...l.f, ...f };
          for (const k of Object.keys(merged)) if (merged[k] === undefined || merged[k] === "") delete merged[k];
          values.Figures = JSON.stringify(merged);
        }
        await update("PaperLines", l.row, values);
      }),
    removeLine: (l) => safely(() => remove("PaperLines", l.row)),
  };
  return <WriterContext.Provider value={w}>{children}</WriterContext.Provider>;
}

export const useWriterState = () => {
  const w = useWriter();
  return { busy: w.busy, error: w.error, writeSetup: w.writeSetup, setup: w.setup };
};

// ------------------------------------------------------------------ small inputs

/** An input that keeps what you type and saves when you leave it. */
function Field({ value, label, onSave, type = "text", area, className, placeholder, options, labels }: {
  value: string; label: string; onSave: (v: string) => unknown; type?: "text" | "money" | "int" | "date" | "pct";
  area?: boolean; className?: string; placeholder?: string; options?: string[]; labels?: Record<string, string>;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = (next = v) => {
    if (next !== value) void onSave(next);
  };
  if (options) {
    return (
      <select className={`input cell ${className || ""}`} aria-label={label} value={v} onChange={(e) => { setV(e.target.value); commit(e.target.value); }}>
        {options.map((o) => <option key={o} value={o}>{labels?.[o] || o || "–"}</option>)}
      </select>
    );
  }
  if (area) return <textarea className={`input cell ${className || ""}`} rows={2} aria-label={label} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => commit()} />;
  const numeric = type === "money" || type === "int" || type === "pct";
  return (
    <input className={`input cell${numeric ? " money" : ""} ${className || ""}`} aria-label={label} type={type === "date" ? "date" : "text"}
      inputMode={numeric ? "decimal" : undefined} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => commit()} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
  );
}

const asText = (x: unknown) => (x === undefined || x === null ? "" : String(x));
const numOrBlank = (s: string, type: string): number | "" => {
  if (type === "int") {
    const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : "";
  }
  return parseAmount(s) ?? "";
};

/** A labelled money box for a schedule's settings (balance b/f, accruals...). */
function SetupMoney({ itemKey, field, label, s }: { itemKey: string; field: string; label: string; s: Setup }) {
  const w = useWriter();
  const val = s[field] === undefined ? "" : String(s[field]);
  return (
    <label className="setup-field">
      <span>{label}</span>
      <Field value={val} label={label} type="money" onSave={(x) => w.writeSetup(itemKey, { [field]: parseAmount(x) })} />
    </label>
  );
}

function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`paper-stat${warn ? " warn" : ""}`}>
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

// ------------------------------------------------------------------ one schedule

export function Schedule({ section, sb }: { section: Section; sb: Sub }) {
  const { data } = useData();
  const w = useWriter();
  const itemKey = setupKey(section.key, sb.key);
  const s = setupOf(data.papers, w.client.Key, w.period, itemKey);
  const lines = linesFor(data.paperLines, w.client.Key, w.period, section.key, sb.key);

  let body: ReactNode;
  if (sb.kind === "info") body = <InfoForm itemKey={itemKey} s={s} />;
  else if (sb.kind === "report") body = <Report itemKey={itemKey} s={s} statutory={section.key === "statutory"} />;
  else if (sb.kind === "finaltb") body = <FinalTb />;
  else if (sb.kind === "queries") body = <Grid section={section} sb={sb} lines={lines} s={s} cols={[
    { key: "Detail", label: "Notes", type: "text", wide: true }, { key: "Remark", label: "Comments back", type: "text", wide: true },
  ]} done />;
  else body = (
    <>
      <KindSettings section={section} sb={sb} itemKey={itemKey} s={s} lines={lines} />
      <Grid section={section} sb={sb} lines={lines} s={s} cols={KIND_COLS[sb.kind] || KIND_COLS.list!} />
      <KindSummary sb={sb} s={s} lines={lines} itemKey={itemKey} />
    </>
  );
  return (
    <section className="card pad stack sched" aria-label={sb.title}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 className="sched-h">{sb.title}{sb.custom && KIND_NAMES[sb.kind] ? <span className="muted"> · {KIND_NAMES[sb.kind]}</span> : null}</h3>
        {sb.custom && <RemoveSchedule section={section} sb={sb} />}
      </div>
      {body}
    </section>
  );
}

function RemoveSchedule({ section, sb }: { section: Section; sb: Sub }) {
  const w = useWriter();
  const hidden = (w.setup(section.key).hidden as string[]) || [];
  return (
    <button type="button" className="linkbtn" onClick={() => {
      if (window.confirm(`Take "${sb.title}" off this year's paper? Its lines stay saved.`)) void w.writeSetup(section.key, { hidden: [...hidden, sb.key] });
    }}>Remove</button>
  );
}

/** Settings above the lines: depreciation, balance brought forward, accruals, fee. */
function KindSettings({ section, sb, itemKey, s, lines }: { section: Section; sb: Sub; itemKey: string; s: Setup; lines: Line[] }) {
  const w = useWriter();
  if (sb.kind === "register") {
    return (
      <div className="setup-row">
        <label className="setup-field">
          <span>Depreciation method</span>
          <Field value={asText(s.method || "none")} label="Depreciation method" options={["none", "rb", "sl"]} labels={{ none: "None", rb: "Reducing balance", sl: "Straight line" }}
            onSave={(x) => w.writeSetup(itemKey, { method: x })} />
        </label>
        <label className="setup-field">
          <span>Rate (% a year)</span>
          <Field value={asText(s.rate)} label="Depreciation rate" type="pct" onSave={(x) => w.writeSetup(itemKey, { rate: parseAmount(x) })} />
        </label>
        <span className="muted" style={{ fontSize: 12, alignSelf: "end" }}>Months is how much of the year to charge (6 for an asset bought half way through).</span>
      </div>
    );
  }
  if (sb.kind === "account") {
    return (
      <div className="setup-row">
        <SetupMoney itemKey={itemKey} field="bf" label={`Balance b/f (${sb.normal === "dr" ? "debit" : "credit"})`} s={s} />
        {sb.split && <SetupMoney itemKey={itemKey} field="within" label="Due within one year" s={s} />}
      </div>
    );
  }
  if (sb.kind === "vat") return <div className="setup-row"><SetupMoney itemKey={itemKey} field="bf" label="Owed at the start (b/f)" s={s} /></div>;
  if (sb.kind === "expense") {
    return (
      <div className="setup-row">
        <SetupMoney itemKey={itemKey} field="openingAccrual" label="Opening accrual" s={s} />
        <SetupMoney itemKey={itemKey} field="closingAccrual" label="Closing accrual" s={s} />
        <SetupMoney itemKey={itemKey} field="software" label="Balance per the software" s={s} />
      </div>
    );
  }
  if (sb.kind === "budget") return <div className="setup-row"><SetupMoney itemKey={itemKey} field="fee" label="Fee agreed / last year's fee" s={s} /></div>;
  void section;
  void lines;
  return null;
}

/** Figures under the lines: balance c/f, charge for the year, whether it balances. */
function KindSummary({ sb, s, lines }: { sb: Sub; s: Setup; lines: Line[]; itemKey: string }) {
  if (sb.kind === "account") {
    const cf = accountCf(lines, s, sb.normal);
    return (
      <div className="stat-row">
        <Stat label={`Balance c/f (${sb.normal === "dr" ? "debit" : "credit"})`} value={money(cf) || "0.00"} />
        {sb.split && <Stat label="Due after one year" value={money(cf - (Number(s.within) || 0)) || "0.00"} />}
      </div>
    );
  }
  if (sb.kind === "vat") return <div className="stat-row"><Stat label="Owed at the year end (c/f)" value={money(vatOwed(lines, s)) || "0.00"} /></div>;
  if (sb.kind === "expense") {
    const charge = expenseCharge(lines, s);
    const diff = s.software === undefined ? undefined : Math.round((charge - Number(s.software)) * 100) / 100;
    return (
      <div className="stat-row">
        <Stat label="Charge for the year" value={money(charge) || "0.00"} />
        {diff !== undefined && <Stat label="Difference to the software" value={money(diff) || "0.00"} warn={diff !== 0} />}
      </div>
    );
  }
  if (sb.kind === "budget") {
    const cols = KIND_COLS.budget!;
    const b = colTotal(lines, cols[1], s), a = colTotal(lines, cols[2], s), fee = Number(s.fee) || 0;
    return (
      <div className="stat-row">
        <Stat label="Recovery on budget" value={money(fee - b) || "0.00"} warn={fee - b < 0} />
        <Stat label="Recovery on actual" value={money(fee - a) || "0.00"} warn={fee - a < 0} />
      </div>
    );
  }
  if (sb.kind === "tb" || sb.kind === "opening") {
    const cols = KIND_COLS[sb.kind]!;
    const dr = colTotal(lines, cols.find((c) => c.key === (sb.kind === "tb" ? "dr" : "odr"))!, s);
    const cr = colTotal(lines, cols.find((c) => c.key === (sb.kind === "tb" ? "cr" : "ocr"))!, s);
    const diff = Math.round((dr - cr) * 100) / 100;
    return lines.length ? <div className="stat-row"><Stat label={diff ? "Out of balance by" : "Balances"} value={diff ? money(diff) : "✔"} warn={!!diff} /></div> : null;
  }
  if (sb.kind === "journals") {
    const off = journalTotals(lines).filter((j) => Math.abs(j.dr - j.cr) > 0.004);
    if (!lines.length) return null;
    return (
      <div className="stat-row">
        <Stat label={off.length ? "Journals that don't balance" : "Every journal balances"} value={off.length ? off.map((j) => `#${j.no} (${money(j.dr - j.cr)})`).join(", ") : "✔"} warn={off.length > 0} />
      </div>
    );
  }
  if (sb.kind === "register") {
    const t = registerTotals(lines, s);
    return lines.length ? <div className="stat-row"><Stat label="Charge for the year" value={money(t.charge) || "0.00"} /><Stat label="NBV c/f" value={money(t.nbvCf) || "0.00"} /></div> : null;
  }
  return null;
}

// ------------------------------------------------------------------ the grid of lines

function Grid({ section, sb, lines, s, cols, done }: { section: Section; sb: Sub; lines: Line[]; s: Setup; cols: Col[]; done?: boolean }) {
  const { data } = useData();
  const w = useWriter();
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const prior = priorPeriod(w.period);
  const priorLines = linesFor(data.paperLines, w.client.Key, prior, section.key, sb.key);
  const priorSetup = setupOf(data.papers, w.client.Key, prior, setupKey(section.key, sb.key));
  const showPrior = sb.kind === "list";
  const inputCols = cols.filter((c) => !c.calc);
  const hasTotals = cols.some((c) => c.total) && lines.length > 0;

  const carry = !lines.length ? carryLines(sb.kind, priorLines, priorSetup) : [];
  const defaults = !lines.length && !priorLines.length ? DEFAULT_LINES[sb.kind] || [] : [];
  const listCarry = sb.kind === "list" && lines.length > 0
    ? priorLines.filter((p) => p.Detail.trim() && !lines.some((l) => l.Detail.trim().toLowerCase() === p.Detail.trim().toLowerCase())).map((p) => ({ Code: p.Code, Detail: p.Detail }))
    : [];

  const startFromLastYear = async () => {
    const setup = carrySetup(sb, priorLines, priorSetup);
    if (Object.values(setup).some((x) => x !== undefined)) await w.writeSetup(setupKey(section.key, sb.key), setup);
    if (carry.length) await w.addLines(section.key, sb.key, carry, 1);
  };
  const canStartSetup = !lines.length && priorLines.length === 0 && Object.keys(priorSetup).length > 0 && ["account", "vat", "expense", "register"].includes(sb.kind) && !Object.keys(s).length;

  // pasted rows fill the columns you type into, in order (amounts tidied up)
  const pastedRows = parseGrid(paste).map((cells) => {
    const x: NewLine & { f: Record<string, unknown> } = { f: {} };
    const usable = cells.length < inputCols.length && inputCols[0].key === "Code" && cells.length >= 2 ? ["", ...cells] : cells;
    inputCols.forEach((c, i) => {
      const raw = usable[i];
      if (raw === undefined || raw === "") return;
      const value = c.type === "money" || c.type === "int" || c.type === "pct" ? numOrBlank(raw, c.type) : raw;
      if (value === "") return;
      if (c.key === "Code" || c.key === "Detail" || c.key === "Remark") (x as any)[c.key] = String(value);
      else if (c.key === "Amount") x.Amount = value as number;
      else x.f[c.key] = value;
    });
    return x;
  }).filter((x) => x.Detail || x.Code || x.Amount !== undefined || Object.keys(x.f).length);

  const save = (l: Line, c: Col, raw: string) => {
    const value = c.type === "money" || c.type === "int" || c.type === "pct" ? numOrBlank(raw, c.type) : raw;
    if (c.key === "Code" || c.key === "Detail" || c.key === "Remark") return w.patchLine(l, { [c.key]: String(value) } as any);
    if (c.key === "Amount") return w.patchLine(l, { Amount: value === "" ? undefined : (value as number) });
    return w.patchLine(l, { f: { [c.key]: value } });
  };
  const display = (l: Line, c: Col) => {
    const x = colValue(l, c, s);
    if (c.type === "money") return x === undefined || x === "" ? "" : String(x);
    return asText(x);
  };
  const colCount = cols.length + (showPrior ? 1 : 0) + (done ? 1 : 0) + 1;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className={`grid lines kind-${sb.kind}`}>
          <thead>
            <tr>
              {cols.map((c) => <th key={c.key} scope="col" className={c.type === "money" ? "num" : c.wide ? "wide" : undefined}>{c.label}</th>)}
              {showPrior && <th scope="col" className="num">{prior.slice(0, 4)}</th>}
              {done && <th scope="col" style={{ width: 80 }}>Completed</th>}
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.Key} className={done && l.Done ? "line-done" : undefined}>
                {cols.map((c) => (
                  <td key={c.key} className={c.type === "money" || c.type === "int" ? "num" : undefined}>
                    {c.calc ? <span className="mono calc">{money(c.calc(l, s) as number) || "–"}</span> : (
                      <Field value={c.type === "money" && display(l, c) ? money(Number(display(l, c))) : display(l, c)} label={`${c.label}${l.Detail ? ` for ${l.Detail}` : ""}`}
                        type={c.type === "status" ? "text" : c.type} options={c.options} area={done && c.type === "text"}
                        onSave={(x) => save(l, c, x)} />
                    )}
                  </td>
                ))}
                {showPrior && <td className="num mono muted">{money(priorFor(data.paperLines, w.client.Key, w.period, section.key, sb.key, l.Detail)) || "–"}</td>}
                {done && <td style={{ textAlign: "center" }}><input type="checkbox" checked={l.Done} aria-label={`Completed: ${l.Detail || "this note"}`} style={{ width: 18, height: 18 }} onChange={(e) => void w.patchLine(l, { Done: e.target.checked })} /></td>}
                <td><button type="button" className="iconbtn" aria-label={`Remove ${l.Detail || "this line"}`} disabled={w.busy} onClick={() => void w.removeLine(l)}><Icon name="close" size={14} /></button></td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={colCount} className="muted" style={{ padding: 12 }}>{done ? "Nothing here yet." : "No lines yet."}</td></tr>}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td key={c.key} className={c.type === "money" ? "num mono" : undefined}>
                    {c.total ? <strong>{money(colTotal(lines, c, s)) || "0.00"}</strong> : i === cols.findIndex((x) => x.type !== "date" && x.type !== "int" && !x.total) ? <strong>Total</strong> : null}
                  </td>
                ))}
                {showPrior && <td className="num mono muted">{money(priorLines.reduce((a, l) => a + (l.Amount || 0), 0)) || "–"}</td>}
                {done && <td />}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={w.busy} onClick={() => void w.addLines(section.key, sb.key, [sb.kind === "register" ? { f: { months: 12 } } : sb.kind === "journals" ? { f: { no: nextJournal(lines) } } : {}])}>
          + {done ? "Add a note" : "Add a line"}
        </button>
        {!done && <button type="button" className="btn small" onClick={() => setPasting(!pasting)} aria-expanded={pasting}>Paste from Excel</button>}
        {(carry.length > 0 || canStartSetup) && (
          <button type="button" className="btn small" disabled={w.busy} onClick={() => void startFromLastYear()}>
            Start from last year{carry.length ? ` (${carry.length} line${carry.length === 1 ? "" : "s"})` : ""}
          </button>
        )}
        {listCarry.length > 0 && (
          <button type="button" className="btn small" disabled={w.busy} onClick={() => void w.addLines(section.key, sb.key, listCarry)}>
            Bring in last year's {listCarry.length} other line{listCarry.length === 1 ? "" : "s"}
          </button>
        )}
        {defaults.length > 0 && (
          <button type="button" className="btn small" disabled={w.busy} onClick={() => void w.addLines(section.key, sb.key, defaults, 1)}>Use the standard list ({defaults.length})</button>
        )}
        {w.busy && <span className="muted" style={{ fontSize: 12 }}>Saving…</span>}
      </div>
      {pasting && (
        <div className="stack" style={{ gap: 8 }}>
          <label>
            Paste rows from Excel, the columns in this order: {inputCols.map((c) => c.label).join(", ")}
            <textarea className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </label>
          <div className="row-wrap">
            <button type="button" className="btn small primary" disabled={!pastedRows.length || w.busy}
              onClick={() => void w.addLines(section.key, sb.key, pastedRows).then(() => { setPaste(""); setPasting(false); })}>
              Add {pastedRows.length} line{pastedRows.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const nextJournal = (lines: Line[]) => {
  const nos = lines.map((l) => Number(l.f.no) || 0);
  const last = nos.length ? Math.max(...nos) : 0;
  // a new journal starts once the last one balances
  const t = journalTotals(lines).find((j) => j.no === last);
  return !last ? 1 : t && Math.abs(t.dr - t.cr) < 0.005 && (t.dr || t.cr) ? last + 1 : last;
};

// ------------------------------------------------------------------ job details, reports, final TB

function InfoForm({ itemKey, s }: { itemKey: string; s: Setup }) {
  const w = useWriter();
  return (
    <div className="form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
      {INFO_FIELDS.map((f) => (
        <label key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
          {f.label}
          <Field value={asText(s[f.key] ?? (f.key === "periodType" ? "Year" : f.key === "months" ? "12" : ""))} label={f.label} options={f.options}
            onSave={(x) => w.writeSetup(itemKey, { [f.key]: x })} />
        </label>
      ))}
    </div>
  );
}

function Report({ itemKey, s, statutory }: { itemKey: string; s: Setup; statutory?: boolean }) {
  const w = useWriter();
  const text = asText(s.text);
  const [editing, setEditing] = useState(!text);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const rows = parseGrid(text);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const chUrl = statutory ? companiesHouseUrl(w.client.CompanyNumber as string | undefined) : undefined;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {statutory && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {w.client.CompanyNumber ? <>Company number <span className="mono">{w.client.CompanyNumber}</span>. </> : null}
          {chUrl && <a href={chUrl} target="_blank" rel="noreferrer">Open on Companies House</a>}
          {chUrl ? " for the details and filing history; paste anything you want to keep below." : "Paste the details and filing history below."}
        </p>
      )}
      {editing ? (
        <>
          <textarea className="input" rows={8} aria-label="Pasted report" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste the report here (from Excel or the software's export)" />
          <div className="row-wrap">
            <button type="button" className="btn small primary" disabled={w.busy || draft === text} onClick={() => void w.writeSetup(itemKey, { text: draft }).then(() => setEditing(false))}>Save</button>
            {text && <button type="button" className="btn small" onClick={() => { setDraft(text); setEditing(false); }}>Cancel</button>}
          </div>
        </>
      ) : (
        <>
          <div className="table-wrap">
            <table className="grid report">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>{Array.from({ length: width }, (_, j) => <td key={j} className={/^[-(£]?[\d,]+(\.\d+)?\)?$/.test(r[j] || "") ? "num mono" : undefined}>{r[j] || ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-wrap"><button type="button" className="btn small" onClick={() => setEditing(true)}>Edit</button></div>
        </>
      )}
    </div>
  );
}

function FinalTb() {
  const { data } = useData();
  const w = useWriter();
  const tb = linesFor(data.paperLines, w.client.Key, w.period, "tb", "main");
  const journals = ["main", "review", "final"].flatMap((k) => linesFor(data.paperLines, w.client.Key, w.period, "journals", k));
  const rows = finalTb(tb, journals);
  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>Put the software's trial balance in "Year end trial balance" and any journals in "Journals"; the final trial balance is worked out here.</p>;
  const sum = (k: "tbDr" | "tbCr" | "jDr" | "jCr" | "dr" | "cr") => money(rows.reduce((a, r) => a + r[k], 0)) || "0.00";
  const diff = Math.round(rows.reduce((a, r) => a + r.dr - r.cr, 0) * 100) / 100;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="grid lines">
          <thead>
            <tr><th scope="col">Code</th><th scope="col" className="wide">Account</th><th scope="col" className="num">TB debit</th><th scope="col" className="num">TB credit</th><th scope="col" className="num">Journals debit</th><th scope="col" className="num">Journals credit</th><th scope="col" className="num">Final debit</th><th scope="col" className="num">Final credit</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code + r.account}>
                <td className="mono">{r.code}</td><td>{r.account}</td>
                {(["tbDr", "tbCr", "jDr", "jCr"] as const).map((k) => <td key={k} className="num mono muted">{money(r[k]) && r[k] ? money(r[k]) : "–"}</td>)}
                <td className="num mono">{r.dr ? money(r.dr) : "–"}</td><td className="num mono">{r.cr ? money(r.cr) : "–"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td /><td><strong>Total</strong></td>{(["tbDr", "tbCr", "jDr", "jCr", "dr", "cr"] as const).map((k) => <td key={k} className="num mono"><strong>{sum(k)}</strong></td>)}</tr>
          </tfoot>
        </table>
      </div>
      <div className="stat-row"><Stat label={diff ? "Out of balance by" : "Balances"} value={diff ? money(diff) : "✔"} warn={!!diff} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ summaries

/** The lead schedule: each schedule's figure this year and last (typed in the first year). */
export function LeadTable({ section }: { section: Section }) {
  const { data } = useData();
  const w = useWriter();
  const rows = leadRows(section, data.papers, data.paperLines, w.client.Key, w.period);
  if (!rows.length) return null;
  const within = rows.filter((r) => !r.after), after = rows.filter((r) => r.after);
  const sum = (l: typeof rows, k: "now" | "before") => Math.round(l.reduce((a, r) => a + (r[k] || 0), 0) * 100) / 100;
  const priorCell = (r: (typeof rows)[number]) => {
    if (!r.priorTyped) return <span className="mono muted">{money(r.before) || "–"}</span>;
    const field = r.sub.split ? (r.after ? undefined : "priorWithin") : "prior";
    if (!field) return <span className="mono muted">{money(r.before) || "–"}</span>;
    const key = setupKey(section.key, r.sub.key);
    return <Field value={r.before === undefined ? "" : money(r.before)} label={`Last year: ${r.label}`} type="money" placeholder="–" onSave={(x) => w.writeSetup(key, { [field]: parseAmount(x) })} />;
  };
  const block = (list: typeof rows, label?: string) => (
    <>
      {label && <tr className="lead-label"><td colSpan={3}>{label}</td></tr>}
      {list.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num mono">{money(r.now) || "–"}</td><td className="num">{priorCell(r)}</td></tr>)}
      {list.length > 1 && <tr className="lead-sub"><td>{label ? `Total ${label.toLowerCase()}` : "Total"}</td><td className="num mono">{money(sum(list, "now")) || "–"}</td><td className="num mono muted">{money(sum(list, "before")) || "–"}</td></tr>}
    </>
  );
  const typed = rows.some((r) => r.priorTyped);
  return (
    <section className="card pad stack" aria-label={`${section.title} lead schedule`}>
      <table className="grid lead">
        <thead><tr><th scope="col">Lead schedule</th><th scope="col" className="num">{w.period.slice(0, 4)}</th><th scope="col" className="num">{priorPeriod(w.period).slice(0, 4)}</th></tr></thead>
        <tbody>
          {after.length && within.length ? <>{block(within, "Due within one year")}{block(after, "Due after one year")}</> : block(rows)}
          {after.length > 0 && within.length > 0 && <tr className="lead-total"><td>Total</td><td className="num mono">{money(sum(rows, "now")) || "–"}</td><td className="num mono">{money(sum(rows, "before")) || "–"}</td></tr>}
        </tbody>
      </table>
      {typed && <p className="muted" style={{ margin: 0, fontSize: 12 }}>No paper for last year in the planner yet, so type last year's figures from the accounts.</p>}
    </section>
  );
}

/** The fixed asset summary: cost, depreciation and NBV for each class, from the registers. */
export function AssetSummary({ section }: { section: Section }) {
  const { data } = useData();
  const w = useWriter();
  const classes = subsFor(section, data.papers, w.client.Key, w.period).filter((x) => x.kind === "register");
  const cols = classes.map((sb) => {
    const s = setupOf(data.papers, w.client.Key, w.period, setupKey(section.key, sb.key));
    const lines = linesFor(data.paperLines, w.client.Key, w.period, section.key, sb.key);
    const rate = s.method && s.method !== "none" && s.rate ? `${s.rate}% ${s.method === "rb" ? "RB" : "SL"}` : "";
    return { sb, t: registerTotals(lines, s), rate };
  });
  const sumOf = (k: keyof AssetTotals) => Math.round(cols.reduce((a, c) => a + c.t[k], 0) * 100) / 100;
  const ROWS: [string, keyof AssetTotals | null][] = [
    ["Cost", null], ["Cost b/f", "costBf"], ["Additions", "add"], ["Disposals", "disp"], ["Cost c/f", "costCf"],
    ["Depreciation", null], ["Depreciation b/f", "depBf"], ["Charge for the year", "charge"], ["Eliminated on disposal", "depDisp"], ["Depreciation c/f", "depCf"],
    [`NBV at ${fmtDate(w.period)}`, "nbvCf"], [`NBV at ${fmtDate(priorPeriod(w.period))}`, "nbvBf"],
  ];
  const proceeds = Number(w.setup(section.key).proceeds) || 0;
  const disposedNbv = Math.round((sumOf("disp") - sumOf("depDisp")) * 100) / 100;
  return (
    <section className="card pad stack" aria-label={`${section.title} summary`}>
      <div className="table-wrap">
        <table className="grid lead assets">
          <thead>
            <tr><th scope="col" /> {cols.map((c) => <th key={c.sb.key} scope="col" className="num">{c.sb.title}{c.rate ? <div className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{c.rate}</div> : null}</th>)}<th scope="col" className="num">Total</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([label, k]) => k ? (
              <tr key={label} className={k === "costCf" || k === "depCf" || k === "nbvCf" ? "lead-sub" : undefined}>
                <td>{label}</td>{cols.map((c) => <td key={c.sb.key} className="num mono">{money(c.t[k]) || "–"}</td>)}<td className="num mono"><strong>{money(sumOf(k)) || "–"}</strong></td>
              </tr>
            ) : <tr key={label} className="lead-label"><td colSpan={cols.length + 2}>{label}</td></tr>)}
          </tbody>
        </table>
      </div>
      {sumOf("disp") > 0 && (
        <div className="setup-row">
          <SetupMoney itemKey={section.key} field="proceeds" label="Proceeds from disposals" s={w.setup(section.key)} />
          <Stat label="NBV of disposals" value={money(disposedNbv) || "0.00"} />
          <Stat label={proceeds - disposedNbv >= 0 ? "Profit on disposal" : "Loss on disposal"} value={money(Math.abs(proceeds - disposedNbv)) || "0.00"} />
        </div>
      )}
    </section>
  );
}

/** Add a schedule of your own to a section (another expense heading, another bank account...). */
export function AddSchedule({ section }: { section: Section }) {
  const { data } = useData();
  const w = useWriter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>(section.key === "expenditure" ? "expense" : "list");
  const all = useMemo(() => subsFor(section, data.papers, w.client.Key, w.period), [section, data.papers, w.client.Key, w.period]);
  const add = async () => {
    const name = title.trim();
    if (!name) return;
    const extra = all.filter((x) => x.custom).map(({ key, title: t2, kind: k, normal, after }) => ({ key, title: t2, kind: k, normal, after }));
    const key = `x${Date.now().toString(36)}`;
    await w.writeSetup(section.key, { extra: [...extra, { key, title: name, kind, normal: kind === "account" ? "cr" : undefined }] });
    setTitle("");
    setOpen(false);
  };
  if (!open) return <div><button type="button" className="btn small" onClick={() => setOpen(true)}>+ Add a schedule</button></div>;
  return (
    <div className="card pad row-wrap" style={{ gap: 8, alignItems: "end" }}>
      <label style={{ flex: "1 1 220px" }}>Name<input className="input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={section.key === "expenditure" ? "e.g. Rent and rates" : "e.g. Savings account"} /></label>
      <label>Kind
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {(["list", "account", "expense", "register", "payroll", "report"] as Kind[]).map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
        </select>
      </label>
      <button type="button" className="btn primary" disabled={!title.trim() || w.busy} onClick={() => void add()}>Add</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
