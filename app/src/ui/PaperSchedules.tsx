// The schedules inside a working paper section: one editor that lays out the columns of any kind
// of schedule (list, asset register, account, VAT, payroll, expense, trial balance, journals...),
// the settings each kind needs (depreciation method and rate, balance brought forward, accruals,
// fee), and the summaries (lead schedule, fixed asset summary, final trial balance).
import { AccountsWorkingPapers } from "./AccountsWorkingPapers";
import { OpeningBalances } from "./OpeningBalances";
import { Fragment, ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import {
  AssetTotals, Col, DEFAULT_LINES, INFO_FIELDS, KIND_COLS, KIND_NAMES, Kind, Line, Section, Setup, Sub, accountCf, carryLines, carrySetup,
  colTotal, colValue, expenseCharge, journalTotals, leadRows, linesFor, money, parseAmount, parseGrid, pasteColumns, priorFor, priorPeriod,
  registerTotals, setupKey, setupOf, setupRow, readSetup, subsFor, vatOwed, journalMatches, SECTIONS,
} from "../lib/papers";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Icon, companiesHouseUrl } from "./bits";
import { readSetting, useData } from "./data";
import { BookMeta, LedgerExtras, LedgerTable, bookKeyFor, useXeroBook } from "./XeroLedger";
import { AccountsFigures, ChartRow, DESTS, DEST_BY_KEY, IRIS_BUILT_IN, Mapping, accountsFigures, controlNote, mapTb, onSide, paperAccounts, parseChart, savedMaps, tbTotals } from "../lib/tbMap";

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
function Field({ value, label, onSave, type = "text", area, className, placeholder, options, labels, list }: {
  value: string; label: string; onSave: (v: string) => unknown; type?: "text" | "money" | "int" | "date" | "pct";
  area?: boolean; className?: string; placeholder?: string; options?: string[]; labels?: Record<string, string>; list?: string;
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
    <input className={`input cell${numeric ? " money" : ""} ${className || ""}`} aria-label={label} type={type === "date" ? "date" : "text"} list={list}
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

/** The IRIS chart: Kevin's loaded chart, topped up with the codes the system already knows. */
let chartCache: { settings: unknown; chart: ChartRow[] } | undefined;
export function useChart(): ChartRow[] {
  const { data } = useData();
  return useMemo(() => {
    if (chartCache && chartCache.settings === data.settings) return chartCache.chart;
    const loaded = readSetting<ChartRow[]>(data.settings, "papers.irisChart") || [];
    const chart = [...loaded, ...IRIS_BUILT_IN.filter((b) => !loaded.some((c) => c.code === b.code))];
    chartCache = { settings: data.settings, chart };
    return chart;
  }, [data.settings]);
}

/** The mapped final trial balance for a year (saved choices, else suggestions); undefined when there's no trial balance. */
function useTbMaps(period: string): Mapping[] | undefined {
  const { data } = useData();
  const w = useWriter();
  const chart = useChart();
  return useMemo(() => {
    // many parts of a page ask for the same year's mapping: work it out once per change of data
    const key = `${w.client.Key}|${period}`;
    const hit = mapCache.get(key);
    if (hit && hit.lines === data.paperLines && hit.papers === data.papers && hit.chart === chart) return hit.maps;
    const rows = paperAccounts(data.paperLines, w.client.Key, period);
    const maps = rows.length ? mapTb(rows, { lines: data.paperLines, papers: data.papers }, w.client.Key, period, chart) : undefined;
    mapCache.set(key, { lines: data.paperLines, papers: data.papers, chart, maps });
    if (mapCache.size > 20) mapCache.delete(mapCache.keys().next().value as string);
    return maps;
  }, [data.paperLines, data.papers, chart, w.client.Key, period]);
}
const mapCache = new Map<string, { lines: Row[]; papers: Row[]; chart: ChartRow[]; maps: Mapping[] | undefined }>();

/** Save where accounts go (and their IRIS codes) on this year's trial balance settings. */
function useMapWriter() {
  const { data } = useData();
  const w = useWriter();
  return (list: { key: string; iris?: string; dest: string }[]) => {
    const maps = { ...savedMaps(data.papers, w.client.Key, w.period) };
    for (const x of list) maps[x.key] = { iris: x.iris || undefined, dest: x.dest };
    return w.writeSetup("tb/main", { maps });
  };
}

/** The trial balance figure for each place in the papers (undefined until there is a trial balance). */
function useTbChecks(period?: string): Map<string, number> | undefined {
  const w = useWriter();
  const maps = useTbMaps(period || w.period);
  return useMemo(() => (maps ? tbTotals(maps) : undefined), [maps]);
}

/** The sections the trial balance puts balances into (shown even if turned off). */
export function useSectionsInUse(): Set<string> {
  const w = useWriter();
  const maps = useTbMaps(w.period);
  return useMemo(() => new Set((maps || []).filter((m) => m.balance && m.dest !== "ignore").map((m) => m.dest.split("/")[0])), [maps]);
}
const diffOf = (a: number, b: number) => Math.round((a - b) * 100) / 100;

// ------------------------------------------------------------------ trial balance accounts in a schedule

/** The trial balance accounts that belong to a schedule: a line each (the software's figure, journals, final), a total, and a link to move one that's in the wrong place. */
function TbItems({ section, sb }: { section: Section; sb: Sub }) {
  const w = useWriter();
  const maps = useTbMaps(w.period);
  const writeMaps = useMapWriter();
  const [moving, setMoving] = useState<string>();
  const [ledger, setLedger] = useState<string>();
  const { book } = useXeroBook(w.setup("xero/main") as BookMeta);
  const { data } = useData();
  if (!maps) return null;
  const base = `${section.key}/${sb.key}`;
  const keys = sb.kind === "register" ? [`${base}#cost`, `${base}#dep`] : sb.split ? [base, `${base}#after`] : [base];
  const blocks = keys.map((key) => ({ dest: DEST_BY_KEY.get(key)!, items: maps.filter((m) => m.dest === key && (m.balance !== 0 || m.swBalance !== 0)) })).filter((b) => b.dest && b.items.length);
  if (!blocks.length) return null;
  const hasControl = blocks.some((b) => b.items.some((m) => controlNote(m.acct.account, m.dest)));
  const hasJournals = blocks.some((b) => b.items.some((m) => m.jBalance));
  const move = async (m: Mapping, dest: string) => {
    setMoving(undefined);
    if (dest !== m.dest) await writeMaps([{ key: m.acct.key, iris: m.iris, dest }]);
  };
  const cols = (hasJournals ? 6 : 4) + (book ? 1 : 0);
  const ledgerKey = (m: Mapping) => (book ? bookKeyFor(book, m.acct.key, m.acct.code) : undefined);
  // which extra views suit an account: control accounts, VAT and PAYE, with the schedules they reconcile to
  const ledgerExtras = (m: Mapping): LedgerExtras => {
    const label = controlNote(m.acct.account, m.dest)?.label || "";
    const kind: LedgerExtras["kind"] = /Debtors control/.test(label) ? "debtors" : /Creditors control/.test(label) ? "creditors" : /VAT control/.test(label) ? "vat" : /Payroll control/.test(label) && /paye|p a y e|national insurance/i.test(m.acct.account) ? "paye" : undefined;
    if (!kind) return {};
    const stagger = (w.setup("xero/main") as { stagger?: number[] }).stagger;
    const n = (x: unknown) => (typeof x === "number" ? x : Number(x) || 0);
    if (kind === "vat") return { kind, stagger, vat: linesFor(data.paperLines, w.client.Key, w.period, "vat", "returns").map((l) => ({ Detail: l.Detail, out: n(l.f.out), inp: n(l.f.in), paid: n(l.f.paid) })) };
    if (kind === "paye") return { kind, payroll: linesFor(data.paperLines, w.client.Key, w.period, "wages", "records").map((l) => ({ Detail: l.Detail, due: Math.round((n(l.f.paye) + n(l.f.eeni) + n(l.f.erni)) * 100) / 100 })) };
    return { kind };
  };
  const countOf = (k?: string) => (book && k ? book.lines.reduce((n, l) => n + (l.a === k ? 1 : 0), 0) : 0);
  const side = (n: number, d: (typeof blocks)[number]["dest"]) => onSide(n, d.side);
  return (
    <div className="stack tb-items" style={{ gap: 6 }}>
      <h4 style={{ margin: 0 }}>From the trial balance</h4>
      <div className="table-wrap">
        <table className="grid lines tb-items-table">
          <thead>
            <tr>
              <th scope="col">Code</th><th scope="col" className="wide">Account</th><th scope="col">IRIS</th>
              {hasJournals && <><th scope="col" className="num">Software</th><th scope="col" className="num">Journals</th></>}
              <th scope="col" className="num">{hasJournals ? "Final" : "Amount"}</th>
              {book && <th scope="col" className="num">Xero</th>}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => {
              const sum = (k: "balance" | "swBalance" | "jBalance") => Math.round(b.items.reduce((a, m) => a + side(m[k], b.dest), 0) * 100) / 100;
              const label = b.dest.part === "cost" ? "Total cost" : b.dest.part === "dep" ? "Total depreciation" : b.dest.part === "after" ? "Total due after one year" : sb.split ? "Total due within one year" : "Total per trial balance";
              const heading = b.dest.part === "cost" ? "Cost" : b.dest.part === "dep" ? "Depreciation" : b.dest.part === "after" ? "Due after one year" : sb.split ? "Due within one year" : "";
              return (
                <Fragment key={b.dest.key}>
                  {heading && <tr className="lead-label"><td colSpan={cols}>{heading}</td></tr>}
                  {b.items.map((m) => {
                    const ctl = controlNote(m.acct.account, m.dest);
                    const open = moving === m.acct.key;
                    return (
                      <Fragment key={m.acct.key}>
                        <tr>
                          <td className="mono">{m.acct.code}</td>
                          <td>
                            <button type="button" className="linkbtn" aria-expanded={open} title="Click to move this account to a different schedule" onClick={() => setMoving(open ? undefined : m.acct.key)}>{m.acct.account}</button>
                            {ctl && <span className="tb-control" title={ctl.hint}>{ctl.label}</span>}
                            {!m.acct.inTb && <span className="tb-control tb-new" title="Not on the software's trial balance: a journal puts it there">From journals</span>}
                            {!m.saved && <span className="muted" style={{ fontSize: 11 }}> · suggested</span>}
                          </td>
                          <td className="mono muted" title={m.irisName}>{m.iris || m.irisName}</td>
                          {hasJournals && <><td className="num mono muted">{money(side(m.swBalance, b.dest)) || "–"}</td><td className="num mono muted">{m.jBalance ? money(side(m.jBalance, b.dest)) : "–"}</td></>}
                          <td className="num mono">{money(side(m.balance, b.dest)) || "0.00"}</td>
                          {book && (() => {
                            const k = ledgerKey(m), n = countOf(k), isOpen = ledger === m.acct.key;
                            return <td className="num">{k && (n || book.unreconciled.some((u) => u.a === k) || book.bank.some((x) => x.key === k)) ? <button type="button" className="linkbtn" aria-expanded={isOpen} onClick={() => setLedger(isOpen ? undefined : m.acct.key)}>{n} transaction{n === 1 ? "" : "s"}</button> : <span className="muted">–</span>}</td>;
                          })()}
                        </tr>
                        {book && ledger === m.acct.key && ledgerKey(m) && (
                          <tr className="tb-ledger"><td colSpan={cols}><LedgerTable book={book} accountKey={ledgerKey(m)!} name={m.acct.account} normal={b.dest.side} extras={ledgerExtras(m)} /></td></tr>
                        )}
                        {open && (
                          <tr className="tb-move"><td colSpan={cols}>
                            <label>Move {m.acct.account} to
                              <select className="input cell" autoFocus value={m.dest} onChange={(e) => void move(m, e.target.value)}>
                                {DEST_GROUPS.map(([g, list]) => <optgroup key={g} label={g}>{list.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>)}
                              </select>
                            </label>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr className="lead-sub">
                    <td colSpan={3}>{label}</td>
                    {hasJournals && <><td className="num mono">{money(sum("swBalance")) || "0.00"}</td><td className="num mono">{money(sum("jBalance")) || "–"}</td></>}
                    <td className="num mono">{money(sum("balance")) || "0.00"}</td>
                    {book && <td />}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasControl && <p className="muted" style={{ margin: 0, fontSize: 12 }}>A control account is the total of a ledger kept in the accounts software. Hover its tag to see what to agree it to.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ one schedule

export function Schedule({ section, sb }: { section: Section; sb: Sub }) {
  const { data } = useData();
  const w = useWriter();
  const itemKey = setupKey(section.key, sb.key);
  const s = { ...setupOf(data.papers, w.client.Key, w.period, itemKey), _period: w.period };
  const lines = linesFor(data.paperLines, w.client.Key, w.period, section.key, sb.key);

  let body: ReactNode;
  if (sb.kind === "info") body = <InfoForm itemKey={itemKey} s={s} />;
  else if (sb.kind === "report") body = <Report itemKey={itemKey} s={s} statutory={section.key === "statutory"} />;
  else if (sb.kind === "finaltb") body = <FinalTb />;
  else if (sb.kind === "summary") body = <AccountsSummary />;
  else if (sb.kind === "openbal") body = <OpeningBalances client={w.client} period={w.period} />;
  else if (sb.kind === "bank") body = <AccountsWorkingPapers client={w.client} period={w.period} />;
  else if (sb.kind === "queries") body = <Grid section={section} sb={sb} lines={lines} s={s} cols={[
    { key: "Detail", label: "Notes", type: "text", wide: true }, { key: "Remark", label: "Comments back", type: "text", wide: true },
  ]} done />;
  else body = (
    <>
      <KindSettings section={section} sb={sb} itemKey={itemKey} s={s} lines={lines} />
      {["list", "register", "account", "expense"].includes(sb.kind) && <TbItems section={section} sb={sb} />}
      {sb.kind === "journals" && <AccountList />}
      <Grid section={section} sb={sb} lines={lines} s={s} cols={KIND_COLS[sb.kind] || KIND_COLS.list!} />
      <KindSummary sb={sb} s={s} lines={lines} itemKey={itemKey} tbKey={`${section.key}/${sb.key}`} />
      {sb.kind === "tb" && section.key === "tb" && lines.length > 0 && <TbMapper />}
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
        <label className="setup-field">
          <span>Part year for additions</span>
          <Field value={asText(s.apportion || "months")} label="Part year for additions" options={["months", "days"]} labels={{ months: "By the Months column", days: "By days from the date bought" }}
            onSave={(x) => w.writeSetup(itemKey, { apportion: x === "days" ? "days" : undefined })} />
        </label>
        <span className="muted" style={{ fontSize: 12, alignSelf: "end" }}>
          {s.apportion === "days" ? "An asset bought this year is charged from its date to the year end (days ÷ 365)." : "Months is how much of the year to charge (6 for an asset bought half way through)."} Type a charge on a line to override it (a disposal, a rounding line).
        </span>
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

/** The accounts on the software's trial balance, to pick from on a journal line. */
function AccountList() {
  const { data } = useData();
  const w = useWriter();
  const tb = linesFor(data.paperLines, w.client.Key, w.period, "tb", "main");
  const names = [...new Map(tb.filter((l) => l.Detail.trim()).map((l) => [l.Detail.trim(), l.Code])).entries()];
  return <datalist id="tb-accounts">{names.map(([n, c]) => <option key={n} value={n}>{c}</option>)}</datalist>;
}

/** Whether each journal balances, and the journal lines that don't find an account on the trial balance. */
function JournalChecks({ lines }: { lines: Line[] }) {
  const { data } = useData();
  const w = useWriter();
  if (!lines.length) return null;
  const off = journalTotals(lines).filter((j) => Math.abs(j.dr - j.cr) > 0.004);
  const tb = linesFor(data.paperLines, w.client.Key, w.period, "tb", "main");
  const fresh = tb.length ? [...new Set(lines.filter((l) => (l.f.dr || l.f.cr) && !journalMatches(l, tb)).map((l) => l.Detail || l.Code))] : [];
  const dr = Math.round(lines.reduce((a, l) => a + (Number(l.f.dr) || 0), 0) * 100) / 100, cr = Math.round(lines.reduce((a, l) => a + (Number(l.f.cr) || 0), 0) * 100) / 100;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="stat-row">
        <Stat label="Debits" value={money(dr) || "0.00"} /><Stat label="Credits" value={money(cr) || "0.00"} />
        <Stat label={off.length ? "Journals that don't balance" : "Every journal balances"} value={off.length ? off.map((j) => `#${j.no} (${money(j.dr - j.cr)})`).join(", ") : "✔"} warn={off.length > 0} />
      </div>
      {fresh.length > 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          <strong>New accounts</strong> (not on the software's trial balance, so the final trial balance adds them): {fresh.join(" · ")}. If one should be an existing account, pick it from the list in the Account box.
        </p>
      )}
    </div>
  );
}

/** Figures under the lines: balance c/f, charge for the year, whether it balances. */
function KindSummary({ sb, s, lines, tbKey }: { sb: Sub; s: Setup; lines: Line[]; itemKey: string; tbKey: string }) {
  const checks = useTbChecks();
  const tb = sb.split ? (checks && (checks.has(tbKey) || checks.has(`${tbKey}#after`)) ? diffOf(checks.get(tbKey) || 0, -(checks.get(`${tbKey}#after`) || 0)) : undefined) : checks?.get(tbKey);
  const tbStats = (mine: number) => tb === undefined ? null : (
    <>
      <Stat label="Per trial balance" value={money(tb) || "0.00"} />
      <Stat label="Difference to the trial balance" value={money(diffOf(mine, tb)) || "0.00"} warn={diffOf(mine, tb) !== 0} />
    </>
  );
  if (sb.kind === "account") {
    const cf = accountCf(lines, s, sb.normal);
    return (
      <div className="stat-row">
        <Stat label={`Balance c/f (${sb.normal === "dr" ? "debit" : "credit"})`} value={money(cf) || "0.00"} />
        {sb.split && <Stat label="Due after one year" value={money(cf - (Number(s.within) || 0)) || "0.00"} />}
        {tbStats(cf)}
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
        {tbStats(charge)}
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
  if (sb.kind === "journals") return <JournalChecks lines={lines} />;
  if (sb.kind === "register") {
    const t = registerTotals(lines, s);
    const cost = checks?.get(`${tbKey}#cost`), dep = checks?.get(`${tbKey}#dep`);
    return lines.length ? (
      <div className="stat-row">
        <Stat label="Charge for the year" value={money(t.charge) || "0.00"} /><Stat label="NBV c/f" value={money(t.nbvCf) || "0.00"} />
        {cost !== undefined && <Stat label="Cost: difference to the trial balance" value={money(diffOf(t.costCf, cost)) || "0.00"} warn={diffOf(t.costCf, cost) !== 0} />}
        {dep !== undefined && <Stat label="Depreciation: difference to the trial balance" value={money(diffOf(t.depCf, dep)) || "0.00"} warn={diffOf(t.depCf, dep) !== 0} />}
      </div>
    ) : null;
  }
  if (sb.kind === "list" && lines.length && tb !== undefined) {
    const mine = Math.round(lines.reduce((a, l) => a + (l.Amount || 0), 0) * 100) / 100;
    return <div className="stat-row"><Stat label="Breakdown total" value={money(mine) || "0.00"} />{tbStats(mine)}</div>;
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
  const priorSetup = { ...setupOf(data.papers, w.client.Key, prior, setupKey(section.key, sb.key)), _period: prior };
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
  const canStartSetup = !lines.length && priorLines.length === 0 && Object.keys(priorSetup).length > 1 && ["account", "vat", "expense", "register"].includes(sb.kind) && !Object.keys(s).filter((k) => k !== "_period").length;

  // pasted rows fill the columns you type into: by their headings if the first row is headings, else in order (amounts tidied up)
  const grid = parseGrid(paste);
  const layout = pasteColumns(grid, inputCols);
  const pastedRows = grid.slice(layout.start).map((cells) => {
    const x: NewLine & { f: Record<string, unknown> } = { f: {} };
    // a row without a code (a name first) moves along one so the name lands in the name column
    const codeFirst = /\d/.test(cells[0] || "") && /^[A-Za-z0-9./\-]{1,12}$/.test(cells[0] || "");
    const usable = !layout.start && cells.length < inputCols.length && inputCols[0].key === "Code" && cells.length >= 2 && !codeFirst ? ["", ...cells] : cells;
    layout.order.forEach((c, i) => {
      if (!c) return;
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
              {showPrior && <th scope="col" className="num prior">{prior.slice(0, 4)}</th>}
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
                        type={c.type === "status" ? "text" : c.type} options={c.options} area={done && c.type === "text"} list={c.list}
                        onSave={(x) => save(l, c, x)} />
                    )}
                  </td>
                ))}
                {showPrior && <td className="num mono prior">{money(priorFor(data.paperLines, w.client.Key, w.period, section.key, sb.key, l.Detail)) || "–"}</td>}
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
                {showPrior && <td className="num mono prior">{money(priorLines.reduce((a, l) => a + (l.Amount || 0), 0)) || "–"}</td>}
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
            Paste rows from Excel. Include the heading row and the columns can be in any order (extra columns are left out); without headings, the columns in this order: {inputCols.map((c) => c.label).join(", ")}
            <textarea className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} />
          </label>
          {layout.start === 1 && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }} role="status">
              Headings found: {layout.order.map((c, i) => `${grid[0][i] || "(blank)"} → ${c ? c.label : "left out"}`).join(" · ")}
            </p>
          )}
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
  const w = useWriter();
  const maps = useTbMaps(w.period);
  if (!maps?.length) return <p className="muted" style={{ margin: 0 }}>Put the software's trial balance in "Year end trial balance" and any journals in "Journals"; the final trial balance is worked out here.</p>;
  const rows = maps.map((m) => m.acct);
  const sum = (k: "tbDr" | "tbCr" | "jDr" | "jCr" | "dr" | "cr") => money(rows.reduce((a, r) => a + r[k], 0)) || "0.00";
  const diff = Math.round(rows.reduce((a, r) => a + r.dr - r.cr, 0) * 100) / 100;
  const added = rows.filter((r) => !r.inTb).length;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="grid lines final-tb">
          <thead>
            <tr><th scope="col">Code</th><th scope="col" className="wide">Account</th><th scope="col">IRIS</th><th scope="col" className="num">TB debit</th><th scope="col" className="num">TB credit</th><th scope="col" className="num">Journals debit</th><th scope="col" className="num">Journals credit</th><th scope="col" className="num">Final debit</th><th scope="col" className="num">Final credit</th><th scope="col">Goes to</th></tr>
          </thead>
          <tbody>
            {maps.map(({ acct: r, iris, irisName, dest }) => (
              <tr key={r.key}>
                <td className="mono">{r.code}</td>
                <td>{r.account}{!r.inTb && <span className="tb-control tb-new" title="Not on the software's trial balance: a journal puts it there">From journals</span>}</td>
                <td className="mono muted" title={irisName}>{iris || irisName}</td>
                {(["tbDr", "tbCr", "jDr", "jCr"] as const).map((k) => <td key={k} className="num mono muted">{r[k] ? money(r[k]) : "–"}</td>)}
                <td className="num mono">{r.dr ? money(r.dr) : "–"}</td><td className="num mono">{r.cr ? money(r.cr) : "–"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{DEST_BY_KEY.get(dest)?.label || dest}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td /><td><strong>Total</strong></td><td />{(["tbDr", "tbCr", "jDr", "jCr", "dr", "cr"] as const).map((k) => <td key={k} className="num mono"><strong>{sum(k)}</strong></td>)}<td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="stat-row">
        <Stat label={diff ? "Out of balance by" : "Balances"} value={diff ? money(diff) : "✔"} warn={!!diff} />
        <Stat label="Accounts" value={`${rows.length}${added ? ` (${added} from journals)` : ""}`} />
      </div>
    </div>
  );
}

/** The accounts in summary from the final trial balance, with the checks that show the papers agree. */
function AccountsSummary() {
  const { data } = useData();
  const w = useWriter();
  const writeMaps = useMapWriter();
  const maps = useTbMaps(w.period);
  const priorMaps = useTbMaps(priorPeriod(w.period));
  const checksNow = useTbChecks();
  const checksPrior = useTbChecks(priorPeriod(w.period));
  if (!maps?.length) return <p className="muted" style={{ margin: 0 }}>Once there's a trial balance (and any journals), the profit and loss account, balance sheet and checks show here.</p>;
  const f = accountsFigures(maps), p = priorMaps?.length ? accountsFigures(priorMaps) : undefined;
  const y = w.period.slice(0, 4), py = priorPeriod(w.period).slice(0, 4);
  type R = [string, keyof AccountsFigures, ("sub" | "total" | "neg")?];
  const PL: R[] = [
    ["Turnover", "turnover"], ["Cost of sales", "costOfSales", "neg"], ["Gross profit", "grossProfit", "sub"], ["Other income", "otherIncome"], ["Expenses", "expenses", "neg"],
    ["Profit before tax", "pbt", "sub"], ["Tax on profit", "tax", "neg"], ["Profit after tax", "pat", "sub"], ["Dividends", "dividends", "neg"], ["Retained profit for the year", "retained", "total"],
  ];
  const BS: R[] = [
    ["Fixed assets", "fixed"], ["Investments", "investments"], ["Stock", "stock"], ["Debtors", "debtors"], ["Cash at bank and in hand", "bank"],
    ["Creditors due within one year", "creditorsWithin", "neg"], ["Net current assets", "netCurrent", "sub"], ["Creditors due after one year", "creditorsAfter", "neg"],
    ["Provisions for liabilities", "provisions", "neg"], ["Net assets", "netAssets", "total"],
    ["Share capital", "shares"], ["Reserves brought forward", "reservesBf"], ["Retained profit for the year", "retained"], ["Capital accounts", "capitalAccounts"], ["Capital and reserves", "capitalAndReserves", "total"],
  ];
  const table = (title: string, list: R[]) => (
    <table className="grid lead accounts-summary">
      <thead><tr><th scope="col">{title}</th><th scope="col" className="num">{y}</th>{p && <th scope="col" className="num prior">{py}</th>}</tr></thead>
      <tbody>
        {list.filter(([, k]) => k !== "capitalAccounts" || f.capitalAccounts || p?.capitalAccounts).map(([label, k, how]) => {
          const show = (x?: AccountsFigures) => (x ? money(how === "neg" ? -(x[k] as number) : (x[k] as number)) || "–" : "");
          return (
            <tr key={label} className={how === "sub" ? "lead-sub" : how === "total" ? "lead-total" : undefined}>
              <td>{label}</td><td className="num mono">{show(f)}</td>{p && <td className="num mono prior">{show(p)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // the checks
  const accts = maps.map((m) => m.acct);
  const swDiff = Math.round(accts.reduce((a, r) => a + r.tbDr - r.tbCr, 0) * 100) / 100;
  const finalDiff = Math.round(accts.reduce((a, r) => a + r.dr - r.cr, 0) * 100) / 100;
  const journalLines = SECTIONS.find((x) => x.key === "journals")!.subs.flatMap((sb) => linesFor(data.paperLines, w.client.Key, w.period, "journals", sb.key));
  const offJournals = ["obd", "main", "review", "final"].flatMap((k) => journalTotals(linesFor(data.paperLines, w.client.Key, w.period, "journals", k)).filter((j) => Math.abs(j.dr - j.cr) > 0.004).map((j) => `#${j.no} (${money(j.dr - j.cr)})`));
  const unsaved = maps.filter((m) => !m.saved).length;
  const leadDiffs: string[] = [];
  for (const sec of SECTIONS.filter((x) => x.summary === "lead")) {
    for (const r of leadRows(sec, data.papers, data.paperLines, w.client.Key, w.period, { now: checksNow, prior: checksPrior })) {
      if (r.fromTb || !checksNow) continue;
      const key = `${sec.key}/${r.sub.key}`;
      const t = r.sub.split ? (r.after ? checksNow.get(`${key}#after`) : checksNow.get(key)) : checksNow.get(key);
      if (t !== undefined && Math.abs(r.now - t) > 0.004) leadDiffs.push(`${sec.title} › ${r.label} (${money(r.now - t)})`);
    }
  }
  for (const sec of SECTIONS.filter((x) => x.summary === "assets")) {
    for (const sb of subsFor(sec, data.papers, w.client.Key, w.period).filter((x) => x.kind === "register")) {
      const lines = linesFor(data.paperLines, w.client.Key, w.period, sec.key, sb.key);
      if (!lines.length || !checksNow) continue;
      const t = registerTotals(lines, { ...setupOf(data.papers, w.client.Key, w.period, setupKey(sec.key, sb.key)), _period: w.period });
      const c = checksNow.get(`${sec.key}/${sb.key}#cost`) || 0, d = checksNow.get(`${sec.key}/${sb.key}#dep`) || 0;
      if (Math.abs(t.costCf - c) > 0.004) leadDiffs.push(`${sb.title}: cost (${money(t.costCf - c)})`);
      if (Math.abs(t.depCf - d) > 0.004) leadDiffs.push(`${sb.title}: depreciation (${money(t.depCf - d)})`);
    }
  }
  const priorCf = p ? p.reservesCf : undefined;
  const checks: [string, boolean, string][] = [
    ["Software trial balance balances", !swDiff, swDiff ? `Out by ${money(swDiff)}` : ""],
    ["Every journal balances", !offJournals.length, offJournals.join(", ")],
    ["Final trial balance balances", !finalDiff, finalDiff ? `Out by ${money(finalDiff)}` : ""],
    ["Every account has a place in the papers", !unsaved && !f.leftOut, [unsaved ? `${unsaved} suggestion${unsaved === 1 ? "" : "s"} not yet accepted` : "", f.leftOut ? `${money(f.leftOut)} left out` : ""].filter(Boolean).join("; ")],
    ["Schedules agree to the trial balance", !leadDiffs.length, leadDiffs.join(" · ")],
    ["Reserves brought forward agree to last year's papers", priorCf === undefined || Math.abs(priorCf - f.reservesBf) < 0.005, priorCf === undefined ? "No trial balance for last year" : Math.abs(priorCf - f.reservesBf) < 0.005 ? "" : `Last year carried forward ${money(priorCf)}; this year brings forward ${money(f.reservesBf)} (difference ${money(f.reservesBf - priorCf)})`],
    ["Net assets equal capital and reserves", !f.difference, f.difference ? `Difference ${money(f.difference)}` : ""],
  ];
  void journalLines;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <ul className="check-list">
        {checks.map(([label, ok, why]) => (
          <li key={label} className={ok ? "ok" : "warn"}>
            <span aria-hidden="true">{ok ? "✔" : "⚠"}</span> <strong>{label}</strong>{why && <span className="muted"> — {why}</span>}
            {label.startsWith("Every account") && unsaved > 0 && (
              <> <button type="button" className="linkbtn" disabled={w.busy} onClick={() => void writeMaps(maps.filter((m) => !m.saved).map((m) => ({ key: m.acct.key, iris: m.iris, dest: m.dest })))}>Accept them all</button>
              <span className="muted"> (or check them under Year end trial balance)</span></>
            )}
          </li>
        ))}
      </ul>
      <div className="summary-grid">
        <div className="table-wrap">{table("Profit and loss account", PL)}</div>
        <div className="table-wrap">{table("Balance sheet", BS)}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ summaries

/** The lead schedule: each schedule's figure this year and last (typed in the first year). */
export function LeadTable({ section }: { section: Section }) {
  const { data } = useData();
  const w = useWriter();
  const checks = useTbChecks();
  const priorChecks = useTbChecks(priorPeriod(w.period));
  const rows = leadRows(section, data.papers, data.paperLines, w.client.Key, w.period, { now: checks, prior: priorChecks });
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
  // the trial balance figure for each row (a split account's two parts map separately: within and after one year)
  const tbFor = (r: (typeof rows)[number]): number | undefined => {
    const key = `${section.key}/${r.sub.key}`;
    if (!r.sub.split) return checks?.get(key);
    const within = checks?.get(key), after = checks?.get(`${key}#after`);
    if (within === undefined && after === undefined) return undefined;
    return (r.after ? after : within) || 0;
  };
  const tbSum = (l: typeof rows) => l.reduce((a, r) => a + (tbFor(r) ?? r.now), 0);
  const tbCells = (now: number, t: number | undefined) => checks ? (
    <>
      <td className="num mono muted">{t === undefined ? "–" : money(t) || "0.00"}</td>
      <td className={`num mono${t !== undefined && diffOf(now, t) ? " diff-bad" : " diff-ok"}`}>{t === undefined ? "" : diffOf(now, t) ? money(diffOf(now, t)) : "✔"}</td>
    </>
  ) : null;
  const span = checks ? 5 : 3;
  const [open, setOpen] = useState<string[]>([]);
  // how a line shows its schedule: opens under the line, or in a panel beside the lead (kept per paper for now)
  const modeKey = `papers.leadMode.${section.key}`;
  const [mode, setModeState] = useState<"line" | "panel">(() => { try { return localStorage.getItem(modeKey) === "panel" ? "panel" : "line"; } catch { return "line"; } });
  const setMode = (m: "line" | "panel") => {
    setModeState(m);
    setOpen((o) => (m === "panel" ? o.slice(0, 1) : o));
    try { localStorage.setItem(modeKey, m); } catch { /* no storage */ }
  };
  const toggle = (k: string) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : mode === "panel" ? [k] : [...o, k]));
  const shown = new Set<string>(); // a split account has two rows; its schedule sits under the first
  const line = (r: (typeof rows)[number]) => {
    const k = r.sub.key, isOpen = open.includes(k), first = !shown.has(k);
    shown.add(k);
    return (
      <Fragment key={r.label}>
        <tr className={`lead-line${isOpen ? " is-open" : ""}`} onClick={(e) => { if (!(e.target as HTMLElement).closest("input,select,textarea")) toggle(k); }}>
          <td>
            <button type="button" className="lead-toggle" aria-expanded={isOpen} aria-controls={`lead-${section.key}-${k}`}
              onClick={(e) => { e.stopPropagation(); toggle(k); }}>
              <span className="lead-chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>{r.label}{r.fromTb && <span className="muted lead-fromtb" title="No schedule filled in yet, so this is the trial balance figure"> · per TB</span>}
            </button>
          </td>
          <td className="num mono">{money(r.now) || "–"}</td><td className="num prior">{priorCell(r)}</td>{tbCells(r.now, tbFor(r))}
        </tr>
        {isOpen && first && mode === "line" && <tr className="lead-open"><td colSpan={span} id={`lead-${section.key}-${k}`}><Schedule section={section} sb={r.sub} /></td></tr>}
      </Fragment>
    );
  };
  const block = (list: typeof rows, label?: string) => (
    <>
      {label && <tr className="lead-label"><td colSpan={span}>{label}</td></tr>}
      {list.map(line)}
      {list.length > 1 && <tr className="lead-sub"><td>{label ? `Total ${label.toLowerCase()}` : "Total"}</td><td className="num mono">{money(sum(list, "now")) || "–"}</td><td className="num mono prior">{money(sum(list, "before")) || "–"}</td>{tbCells(sum(list, "now"), Math.round(tbSum(list) * 100) / 100)}</tr>}
    </>
  );
  const typed = rows.some((r) => r.priorTyped);
  const panelRow = rows.find((r) => open.includes(r.sub.key));
  return (
    <section className="card pad stack" aria-label={`${section.title} lead schedule`}>
      <div className="row-wrap lead-mode">
        <span className="muted" style={{ fontSize: 12 }}>A line opens:</span>
        <div className="seg" role="group" aria-label="How a line opens its schedule">
          <button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>Under the line</button>
          <button type="button" aria-pressed={mode === "panel"} onClick={() => setMode("panel")}>Side panel</button>
        </div>
      </div>
      <div className={mode === "panel" && panelRow ? "lead-split" : undefined}>
      <div className="table-wrap lead-main">
      <table className="grid lead">
        <thead><tr><th scope="col">Lead schedule</th><th scope="col" className="num">{w.period.slice(0, 4)}</th><th scope="col" className="num prior">{priorPeriod(w.period).slice(0, 4)}</th>{checks && <><th scope="col" className="num">Per trial balance</th><th scope="col" className="num">Difference</th></>}</tr></thead>
        <tbody>
          {after.length && within.length ? <>{block(within, "Due within one year")}{block(after, "Due after one year")}</> : block(rows)}
          {after.length > 0 && within.length > 0 && <tr className="lead-total"><td>Total</td><td className="num mono">{money(sum(rows, "now")) || "–"}</td><td className="num mono prior">{money(sum(rows, "before")) || "–"}</td>{tbCells(sum(rows, "now"), Math.round(tbSum(rows) * 100) / 100)}</tr>}
        </tbody>
      </table>
      </div>
      {mode === "panel" && panelRow && (
        <aside className="lead-panel" aria-label={`${panelRow.label} schedule`}>
          <div className="lead-panel-head">
            <div><span className="eyebrow">Schedule</span><h3 style={{ margin: 0 }}>{panelRow.label} · {money(panelRow.now) || "0.00"}</h3></div>
            <button type="button" className="iconbtn" aria-label="Close the panel" onClick={() => setOpen([])}><Icon name="close" size={16} /></button>
          </div>
          <Schedule section={section} sb={panelRow.sub} />
        </aside>
      )}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{mode === "panel" ? "Click a line to open its schedule beside the lead." : "Click a line to open its schedule."}</p>
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
    const s: Setup = { ...setupOf(data.papers, w.client.Key, w.period, setupKey(section.key, sb.key)), _period: w.period };
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
  const checks = useTbChecks();
  const tbRow = (part: "cost" | "dep") => cols.map((c) => checks?.get(`${section.key}/${c.sb.key}#${part}`));
  const tbCost = tbRow("cost"), tbDep = tbRow("dep");
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
            {checks && ([["Cost per trial balance", tbCost, "costCf"], ["Depreciation per trial balance", tbDep, "depCf"]] as const).map(([label, vals, k]) => {
              const total = vals.reduce((a: number, x) => a + (x ?? 0), 0);
              return (
                <tr key={label} className="tb-check">
                  <td>{label}</td>
                  {cols.map((c, i) => {
                    const t = vals[i];
                    const d = t === undefined ? 0 : diffOf(c.t[k], t);
                    return <td key={c.sb.key} className={`num mono${d ? " diff-warn" : " muted"}`} title={d ? `Difference ${money(d)}` : undefined}>{t === undefined ? "–" : `${money(t) || "0.00"}${d ? " ⚠" : ""}`}</td>;
                  })}
                  <td className="num mono muted">{money(total) || "0.00"}</td>
                </tr>
              );
            })}
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

// ------------------------------------------------------------------ mapping the trial balance

/** Give each account of the final trial balance an IRIS code and a place in the papers. */
function TbMapper() {
  const { data, saveSetting } = useData();
  const w = useWriter();
  const loadedChart = useMemo(() => readSetting<ChartRow[]>(data.settings, "papers.irisChart") || [], [data.settings]);
  const chart = useChart();
  const maps = useTbMaps(w.period) || [];
  const writeMaps = useMapWriter();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [chartText, setChartText] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const unsaved = maps.filter((m) => !m.saved);
  const run = async (what: string, work: () => Promise<string | void>) => {
    setBusy(what);
    setError(undefined);
    setNote(undefined);
    try {
      const msg = await work();
      if (msg) setNote(msg);
    } catch {
      setError("That didn't all save. Try again.");
    } finally {
      setBusy("");
    }
  };
  const loadChart = () => run("chart", async () => {
    const rows = parseChart(chartText);
    if (!rows.length) throw new Error("empty");
    await saveSetting("papers.irisChart", rows);
    setChartText("");
    setLoading(false);
    return `${rows.length} IRIS codes loaded.`;
  });
  const setOne = (m: Mapping, patch: { iris?: string; dest?: string }) => writeMaps([{ key: m.acct.key, iris: patch.iris ?? m.iris, dest: patch.dest ?? m.dest }]);
  const groups = DEST_GROUPS;
  const shown = onlyOpen ? maps.filter((m) => !m.saved) : maps;
  const drcr = (n: number) => (n ? `${money(Math.abs(n))} ${n < 0 ? "Cr" : "Dr"}` : "–");

  return (
    <div className="stack tb-map" style={{ gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h4 style={{ margin: 0 }}>Map the final trial balance to IRIS and the schedules</h4>
        <span className="muted" style={{ fontSize: 12 }}>
          {loadedChart.length ? `IRIS chart: ${loadedChart.length} codes loaded` : `Using the ${IRIS_BUILT_IN.length} IRIS codes the system knows`} ·{" "}
          <button type="button" className="linkbtn" onClick={() => setLoading(!loading)} aria-expanded={loading}>{loadedChart.length ? "Replace the IRIS chart" : "Load the IRIS chart"}</button>
        </span>
      </div>
      {loading && (
        <div className="stack" style={{ gap: 8 }}>
          <label>
            Paste the IRIS Elements chart of accounts (code and name on each row, from Excel or a CSV export). A third column can say where it goes (e.g. creditors/accruals).
            <textarea className="input" rows={6} value={chartText} onChange={(e) => setChartText(e.target.value)} placeholder={"Code\tName\n…"} />
          </label>
          <div className="row-wrap">
            <input type="file" accept=".csv,.txt,text/csv" aria-label="IRIS chart file" onChange={(e) => e.target.files?.[0]?.text().then(setChartText)} />
            <button type="button" className="btn small primary" disabled={!parseChart(chartText).length || busy !== ""} onClick={() => void loadChart()}>
              Load {parseChart(chartText).length || ""} codes
            </button>
          </div>
        </div>
      )}
      <datalist id="iris-codes">{chart.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</datalist>
      <div className="row-wrap" style={{ gap: 8 }}>
        {unsaved.length > 0 && (
          <button type="button" className="btn small primary" disabled={busy !== ""} onClick={() => void run("save", async () => {
            await writeMaps(unsaved.map((m) => ({ key: m.acct.key, iris: m.iris, dest: m.dest })));
            return `${unsaved.length} suggestion${unsaved.length === 1 ? "" : "s"} saved.`;
          })}>
            {busy === "save" ? "Saving…" : `Accept the ${unsaved.length} suggestion${unsaved.length === 1 ? "" : "s"}`}
          </button>
        )}
        {unsaved.length > 0 && <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only show suggestions</label>}
        <span className="muted" style={{ fontSize: 12 }}>Accounts show in their schedules straight away. Change "Goes to" to move one; each schedule also has a link to move an account.</span>
      </div>
      <div className="table-wrap">
        <table className="grid lines tb-map-table">
          <thead>
            <tr><th scope="col">Code</th><th scope="col" className="wide">Account</th><th scope="col" className="num">Final balance</th><th scope="col">IRIS code</th><th scope="col" className="wide">Goes to</th><th scope="col">Suggested because</th></tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.acct.key} className={m.saved ? undefined : "tb-suggested"}>
                <td className="mono">{m.acct.code}</td>
                <td>{m.acct.account}{!m.acct.inTb && <span className="tb-control tb-new">From journals</span>}</td>
                <td className="num mono" title={m.jBalance ? `Software ${drcr(m.swBalance)}, journals ${drcr(m.jBalance)}` : undefined}>{drcr(m.balance)}</td>
                <td>
                  <IrisInput value={m.iris} label={`IRIS code for ${m.acct.account}`} onSave={(x) => setOne(m, { iris: x.trim() })} />
                  {m.irisName && <div className="muted" style={{ fontSize: 11 }}>{m.irisName}</div>}
                </td>
                <td>
                  <select className="input cell" aria-label={`Where ${m.acct.account} goes`} value={m.dest} onChange={(e) => void setOne(m, { dest: e.target.value })}>
                    {!DEST_BY_KEY.has(m.dest) && <option value={m.dest}>{m.dest}</option>}
                    {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>)}
                  </select>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{m.saved ? "Saved" : m.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="muted" role="status" style={{ margin: 0, fontSize: 13 }}>{note}</p>}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

const SECTION_GROUP = new Map<string, string>([
  ["goodwill", "Fixed assets"], ["fixed", "Fixed assets"], ["investments", "Fixed assets"],
  ["stock", "Current assets"], ["debtors", "Current assets"], ["bank", "Current assets"],
  ["creditors", "Liabilities"], ["loans", "Liabilities"], ["provisions", "Liabilities"], ["capital", "Capital and reserves"],
  ["income", "Profit and loss"], ["expenditure", "Profit and loss"], ["taxation", "Profit and loss"],
  ["vat", "Other schedules"], ["wages", "Other schedules"], ["creditors-ca", "Other schedules"], ["debtors-ca", "Other schedules"], ["workings", "Other schedules"],
]);

const DEST_GROUPS: [string, typeof DESTS][] = (() => {
  const by = new Map<string, typeof DESTS>();
  for (const d of DESTS) {
    const g = d.key === "ignore" ? "Other" : SECTION_GROUP.get(d.section) || "Other";
    by.set(g, [...(by.get(g) || []), d]);
  }
  return [...by.entries()];
})();

function IrisInput({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => unknown }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="input cell" list="iris-codes" aria-label={label} value={v} style={{ width: 96 }} onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && void onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
  );
}
