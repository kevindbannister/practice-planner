// Brings a client's payments, credits and charges in from their HMRC Self Assessment account. The person copies the lines from the
// agent services account page and pastes them in. Each line is shown with the tax year and kind it has been matched to, and can be
// changed or left out, before anything is saved. Each year touched is saved as that year's return (a blank one is started where
// there isn't one yet).
import { useMemo, useState } from "react";
import { Client, todayIso } from "../lib/domain";
import { applyAccount, importedKeys, parseAccount, planAccount, PlanRow, Role } from "../lib/hmrcAccount";
import { setupRow, readSetup } from "../lib/papers";
import { newKey } from "../lib/planning";
import { TaxReturn, readReturn } from "../lib/tax";
import { YEARS, yearEnd, yearLabel, yearOf } from "../lib/taxRates";
import { Icon } from "./bits";
import { useData } from "./data";

const TAX_ITEM = "_tax"; // where a return is kept (WorkingPapers.ItemKey), the same as TaxPage
const gbp = (v: number) => `${v < 0 ? "-" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KINDS: { value: Role["kind"] | "skip"; label: string }[] = [
  { value: "poa1", label: "First payment on account" },
  { value: "poa2", label: "Second payment on account" },
  { value: "balancing", label: "Balance for the year before" },
  { value: "payment", label: "Other payment" },
  { value: "charge", label: "Late payment interest or penalty" },
  { value: "credit", label: "Interest or repayment received" },
  { value: "skip", label: "Leave out" },
];
const STATUS: Record<PlanRow["status"], { label: string; cls: string }> = {
  match: { label: "Matches", cls: "chip green" },
  check: { label: "Check", cls: "chip red" },
  already: { label: "Already in", cls: "chip" },
  outside: { label: "Year not held", cls: "chip" },
  skip: { label: "Left out", cls: "chip" },
};

export function HmrcAccountDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const { data, create, update } = useData();
  const [text, setText] = useState("");
  const [choose, setChoose] = useState<Record<number, Role | null>>({});
  /** the person's own ticks: a line is approved by default only when it matches the return */
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ saved: number[]; failed: number[] } | null>(null);

  // what this client already has for each year held (the returns the lines are checked against)
  const returns = useMemo(() => {
    const m = new Map<number, TaxReturn>();
    for (const y of YEARS.map((x) => x.year)) {
      const row = setupRow(data.papers, client.Key, yearEnd(y), TAX_ITEM);
      if (row) m.set(y, readReturn(readSetup(row).r));
    }
    return m;
  }, [data.papers, client.Key]);

  const parsed = useMemo(() => parseAccount(text), [text]);
  const plan = useMemo(() => planAccount(parsed.rows, returns, importedKeys(returns), choose), [parsed.rows, returns, choose]);

  const canApprove = (p: PlanRow) => !!p.role && (p.status === "match" || p.status === "check");
  const isApproved = (p: PlanRow, i: number) => canApprove(p) && (i in approved ? approved[i] : p.status === "match");
  // only the approved lines are brought in
  const toApply = useMemo(() => plan.map((p, i): PlanRow => (isApproved(p, i) ? p : { ...p, role: undefined })), [plan, approved]);
  const changed = useMemo(() => applyAccount(toApply, returns), [toApply, returns]);
  const approvedCount = toApply.filter((p) => p.role).length;
  const counts = (st: PlanRow["status"]) => plan.filter((p) => p.status === st).length;
  const newYears = [...changed.keys()].filter((y) => !returns.has(y)).sort((a, b) => a - b);

  const setRow = (i: number, kind: Role["kind"] | "skip", year: number) => {
    setChoose((prev) => ({ ...prev, [i]: kind === "skip" ? null : { kind, year } }));
    if (kind !== "skip") setApproved((prev) => ({ ...prev, [i]: true }));
  };
  const deleteRow = (i: number) => setChoose((prev) => ({ ...prev, [i]: null }));
  const putBack = (i: number) => setChoose((prev) => { const next = { ...prev }; delete next[i]; return next; });

  const save = async () => {
    if (!changed.size) return;
    setSaving(true);
    const saved: number[] = [], failed: number[] = [];
    for (const [y, r] of changed) {
      try {
        const row = setupRow(data.papers, client.Key, yearEnd(y), TAX_ITEM);
        // a blank return started here takes the client's details, the same as one started from the return
        const next: TaxReturn = row ? r : {
          ...r,
          front: { ...r.front, utr: r.front.utr || String(client.UTR || "") || undefined, nino: r.front.nino || String(client.NINumber || "") || undefined, dob: r.front.dob || String(client.DateOfBirth || "") || undefined },
        };
        const values = { Setup: JSON.stringify({ ...(row ? readSetup(row) : {}), r: next }), Updated: new Date().toISOString() };
        if (row) await update("WorkingPapers", row, values);
        else await create("WorkingPapers", { Key: newKey("WP"), ClientKey: client.Key, PeriodEnd: yearEnd(y), ItemKey: TAX_ITEM, Status: "todo", ...values });
        saved.push(y);
      } catch {
        failed.push(y);
      }
    }
    setSaving(false);
    setResult({ saved, failed });
  };

  const done = !!result && !saving;

  return (
    <div className="tax-add-sheet" role="presentation" onClick={() => !saving && onClose()}>
      <div className="tax-add-card tax-import tax-bulk tax-account" role="dialog" aria-modal="true" aria-label="Bring in the HMRC account" onClick={(e) => e.stopPropagation()}>
        <div className="quick-journal-head">
          <strong><Icon name="download" size={16} /> Payments from the HMRC account</strong>
          <span className="quick-journal-note">{client.Title}</span>
          <button type="button" className="quick-journal-x" onClick={onClose} disabled={saving} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        {done ? (
          <div className="stack" style={{ gap: 8 }}>
            {result!.saved.length > 0 && <p className="ok-text" style={{ margin: 0 }}>Payments saved for {result!.saved.sort((a, b) => a - b).map(yearLabel).join(", ")}.</p>}
            {result!.failed.length > 0 && <p className="error-text" role="alert" style={{ margin: 0 }}>Didn't save for {result!.failed.map(yearLabel).join(", ")}. Close this and bring those lines in again.</p>}
            <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" className="btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="stack" style={{ gap: 12 }}>
              <label className="field">
                <span>Paste the lines from the HMRC account</span>
                <textarea className="input" rows={5} value={text} onChange={(e) => { setText(e.target.value); setChoose({}); setApproved({}); }} placeholder={"30 Jul 2026    Payment    1,673.84\n31 Jan 2023    Repayment supplement (interest)    .08"} aria-label="Lines from the HMRC account" style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }} />
              </label>

              {parsed.rows.length > 0 && (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {parsed.rows.length} line{parsed.rows.length === 1 ? "" : "s"} read: {counts("match")} match the return, {counts("check")} to check, {counts("system")} already in the return, {counts("already")} brought in before, {counts("outside")} for years not held, {counts("skip")} left out. Approve the lines to bring in, and delete any that aren't wanted.
                </p>
              )}
              {parsed.skipped.length > 0 && <p className="warn" style={{ margin: 0, fontSize: 13 }}>Not read (not a date, description and amount): {parsed.skipped.slice(0, 3).join(" · ")}{parsed.skipped.length > 3 ? ` and ${parsed.skipped.length - 3} more` : ""}</p>}

              {plan.length > 0 && (
                <div className="table-wrap">
                  <table className="grid">
                    <thead><tr><th>Approve</th><th>Date</th><th>HMRC account</th><th>In the return</th><th>Goes to</th><th>Tax year</th><th>Check</th><th></th></tr></thead>
                    <tbody>
                      {plan.map((p, i) => {
                        const deleted = choose[i] === null;
                        const kind = p.role ? p.role.kind : "skip";
                        const year = p.role?.year ?? yearOf(p.row.date);
                        const st = STATUS[p.status];
                        return (
                          <tr key={p.row.key + i} style={deleted ? { opacity: 0.55 } : undefined}>
                            <td>
                              <input type="checkbox" aria-label={`Approve ${p.row.description} on ${p.row.date}`} disabled={!canApprove(p) || deleted} checked={isApproved(p, i)} onChange={(e) => setApproved((prev) => ({ ...prev, [i]: e.target.checked }))} />
                            </td>
                            <td className="mono" style={{ whiteSpace: "nowrap" }}>{p.row.date}</td>
                            <td><div>{p.row.description}</div><div className="mono">{gbp(p.row.amount)}</div></td>
                            <td><div className="tax-note">{p.system ?? (p.role && (p.role.kind === "poa1" || p.role.kind === "poa2") ? "Nothing paid yet" : "Not in the return")}</div></td>
                            <td>
                              <select className="input" value={kind} disabled={deleted} aria-label={`What ${p.row.description} on ${p.row.date} is`} onChange={(e) => setRow(i, e.target.value as Role["kind"] | "skip", year)} style={{ minWidth: 230 }}>
                                {KINDS.filter((k) => k.value !== "skip").map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                                <option value="skip">Leave out</option>
                              </select>
                            </td>
                            <td>
                              <select className="input" value={year} disabled={kind === "skip" || deleted} aria-label={`Tax year for ${p.row.description} on ${p.row.date}`} onChange={(e) => setRow(i, kind, Number(e.target.value))} style={{ minWidth: 100 }}>
                                {[...YEARS].reverse().map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}
                              </select>
                            </td>
                            <td><span className={st.cls}>{st.label}</span><div className="tax-note">{p.note}</div></td>
                            <td>
                              {deleted
                                ? <button type="button" className="btn small" onClick={() => putBack(i)}>Put back</button>
                                : <button type="button" className="btn small" onClick={() => deleteRow(i)} aria-label={`Delete ${p.row.description} on ${p.row.date} from this import`}>Delete</button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {newYears.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>A blank return is started for {newYears.map(yearLabel).join(", ")}, where there isn't one yet.</p>}
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Lines already in a return aren't added again. To remove a payment that is already in a return, use its Remove button on the return's payments.</p>
            </div>
            <div className="row-wrap" style={{ gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="btn primary" disabled={!approvedCount || saving} onClick={() => void save()}>
                {approvedCount ? `Bring in ${approvedCount} approved line${approvedCount === 1 ? "" : "s"}` : "Approve lines to bring in"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
