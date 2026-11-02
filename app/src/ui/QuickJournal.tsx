// A journal keyed in from a panel that drops from the top of the screen, over whatever working paper is open, so the
// other pages can be looked at while it's written. It is saved into the Journals schedule; the page doesn't change.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { linesFor } from "../lib/papers";
import { QLine, blankLine, checkJournal, imbalance, rebalance, setAmount, toPaperLines } from "../lib/quickJournal";
import { Icon } from "./bits";
import { useData } from "./data";
import { AccountList, nextJournal, useWriter } from "./PaperSchedules";

export function QuickJournalButton() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <>
      <button type="button" className="quick-journal-btn" aria-expanded={open} aria-haspopup="dialog" title="New journal (opens over this page)" aria-label="New journal"
        onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      {done && <span className="quick-journal-done" role="status">{done}</span>}
      <QuickJournal open={open} onClose={() => setOpen(false)} onSaved={(m) => { setDone(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setDone(""), 5000); }} />
    </>
  );
}

function QuickJournal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const { data } = useData();
  const w = useWriter();
  const [lines, setLines] = useState<QLine[]>([blankLine(), blankLine()]);
  const [narrative, setNarrative] = useState("");
  const [error, setError] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const journals = linesFor(data.paperLines, w.client.Key, w.period, "journals", "main");
  const no = nextJournal(journals);
  const tb = linesFor(data.paperLines, w.client.Key, w.period, "tb", "main");

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => first.current?.focus(), 120);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { window.clearTimeout(t); document.removeEventListener("keydown", key); };
  }, [open, onClose]);

  const patch = (i: number, p: Partial<QLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const pickAccount = (i: number, name: string) => {
    const hit = tb.find((l) => l.Detail.trim().toLowerCase() === name.trim().toLowerCase());
    patch(i, { account: name, ...(hit && !lines[i].code ? { code: hit.Code } : {}) });
  };
  const pickCode = (i: number, code: string) => {
    const hit = code.trim() ? tb.find((l) => l.Code.trim().toLowerCase() === code.trim().toLowerCase()) : undefined;
    patch(i, { code, ...(hit && !lines[i].account ? { account: hit.Detail } : {}) });
  };
  const diff = imbalance(lines);
  const save = async () => {
    const c = checkJournal(lines);
    if (!c.ok) { setError(c.message || ""); return; }
    setError("");
    await w.addLines("journals", "main", toPaperLines(lines, no, narrative.trim()));
    onSaved(`Journal ${no} added to Journals`);
    setLines([blankLine(), blankLine()]);
    setNarrative("");
    onClose();
  };

  return createPortal(
    <div className={`quick-journal${open ? " open" : ""}`} role="dialog" aria-label="New journal" aria-hidden={!open}>
      <div className="quick-journal-card">
        <div className="quick-journal-head">
          <strong><Icon name="book" size={16} /> New journal {no}</strong>
          <span className="quick-journal-note">Goes into Journals · stays on this page</span>
          <button type="button" className="quick-journal-x" onClick={onClose} aria-label="Close the journal" tabIndex={open ? 0 : -1}><Icon name="close" size={16} /></button>
        </div>
        <AccountList />
        <div className="quick-journal-wrap">
          <table className="quick-journal-table">
            <thead><tr><th scope="col">Journal</th><th scope="col">Code</th><th scope="col">Account</th><th scope="col" className="num">Debit</th><th scope="col" className="num">Credit</th><th scope="col">Narrative</th><th scope="col"><span className="sr-only">Delete line</span></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="mono">{no}</td>
                  <td><input ref={i === 0 ? first : undefined} className="input" aria-label={`Line ${i + 1} code`} value={l.code} tabIndex={open ? 0 : -1} onChange={(e) => pickCode(i, e.target.value)} /></td>
                  <td><input className="input" list="tb-accounts" aria-label={`Line ${i + 1} account`} value={l.account} tabIndex={open ? 0 : -1} onChange={(e) => pickAccount(i, e.target.value)} /></td>
                  <td><input className="input num mono" inputMode="decimal" aria-label={`Line ${i + 1} debit`} value={l.dr} tabIndex={open ? 0 : -1} onChange={(e) => setLines((ls) => setAmount(ls, i, "dr", e.target.value))} /></td>
                  <td><input className="input num mono" inputMode="decimal" aria-label={`Line ${i + 1} credit`} value={l.cr} tabIndex={open ? 0 : -1} onChange={(e) => setLines((ls) => setAmount(ls, i, "cr", e.target.value))} /></td>
                  <td><input className="input" aria-label={`Line ${i + 1} narrative`} value={l.narrative} placeholder={narrative} tabIndex={open ? 0 : -1} onChange={(e) => patch(i, { narrative: e.target.value })} /></td>
                  <td><button type="button" className="quick-journal-del" aria-label={`Delete line ${i + 1}`} title={lines.length <= 2 ? "A journal keeps at least two lines" : "Delete this line"} disabled={lines.length <= 2} tabIndex={open ? 0 : -1}
                    onClick={() => setLines((ls) => rebalance(ls.filter((_, k) => k !== i)))}><Icon name="close" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="quick-journal-foot">
          <button type="button" className="quick-journal-link" tabIndex={open ? 0 : -1} onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add a line</button>
          <label className="quick-journal-narr">Narrative for every line<input className="input" value={narrative} tabIndex={open ? 0 : -1} onChange={(e) => setNarrative(e.target.value)} placeholder="e.g. Accrue year end fees" /></label>
          <span className={`quick-journal-bal${diff ? " off" : ""}`} role="status">{diff ? `Out by ${Math.abs(diff).toFixed(2)}` : lines.some((l) => l.dr || l.cr) ? "Balances ✔" : ""}</span>
          {error && <span className="quick-journal-err" role="alert">{error}</span>}
          <button type="button" className="quick-journal-save" disabled={w.busy} tabIndex={open ? 0 : -1} onClick={() => void save()}>Add journal</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
