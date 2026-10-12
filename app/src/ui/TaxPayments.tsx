// Tax payments on a client's record (Self Assessment years and corporation tax), and the
// payment reminders list that turns them into emails in your Outlook drafts.
import { useMemo, useState } from "react";
import { addScope } from "../lib/auth";
import { Client, fmtDate, fmtMoney, todayIso } from "../lib/domain";
import { emailGreeting } from "../lib/comms";
import { newKey } from "../lib/planning";
import {
  DEFAULT_REMINDER, REMINDER_PLACEHOLDERS, ReminderGroup, ReminderTemplate, TaxPayment, calcSa, ctDue, fillReminder, isPaid, paymentLabel,
  poasFor, reminderGroups, saDates, taxYearLabel, taxYearOf, fmtLong,
} from "../lib/taxPayments";
import { Icon, href } from "./bits";
import { readSetting, useData, useIndex } from "./data";
import { CommsTabs, MAIL_SCOPE, mailAllowed, outlookDraft, useCommsPrefs } from "./commsKit";

const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber;
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/[£,\s]/g, "")) || 0);
const money = (n?: number) => fmtMoney(Number(n) || 0);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

function PayStatus({ p, today }: { p: TaxPayment; today: string }) {
  if (isPaid(p)) return <span className="chip green">Paid {fmtDate(String(p.PaidOn), { year: false })}</span>;
  if (!(Number(p.Amount) > 0)) return <span className="chip">Nothing to pay</span>;
  const d = days(today, String(p.DueDate));
  return (
    <span className="row-wrap" style={{ gap: 4 }}>
      {d < 0 ? <span className="chip red">{-d}d overdue</span> : d <= 30 ? <span className="chip amber">Due in {d}d</span> : <span className="chip">Due in {d}d</span>}
      {p.RemindedOn ? <span className="chip blue">Reminded {fmtDate(String(p.RemindedOn), { year: false })}</span> : null}
    </span>
  );
}

// ------------------------------------------------------------------ client tab

export function TaxPaymentsTab({ client: c }: { client: Client }) {
  const { data, update, remove } = useData();
  const today = todayIso();
  const mine = (data.taxPayments as TaxPayment[]).filter((p) => p.ClientKey === c.Key);
  const [adding, setAdding] = useState<"" | "sa" | "ct" | "other">("");
  const [editYear, setEditYear] = useState<string>();
  const years = [...new Set(mine.filter((p) => p.Tax === "SA").map((p) => String(p.EntryYear)))].sort().reverse();
  const ct = mine.filter((p) => p.Tax === "CT").sort((a, b) => String(b.DueDate).localeCompare(String(a.DueDate)));
  const other = mine.filter((p) => p.Tax === "OTHER").sort((a, b) => String(b.DueDate).localeCompare(String(a.DueDate)));
  const nextDue = mine.filter((p) => !isPaid(p) && Number(p.Amount) > 0 && String(p.DueDate) >= today).sort((a, b) => String(a.DueDate).localeCompare(String(b.DueDate)));
  const overdue = mine.filter((p) => !isPaid(p) && Number(p.Amount) > 0 && String(p.DueDate) < today);
  const company = isCompany(c);

  const markPaid = (p: TaxPayment) => update("TaxPayments", p, { PaidOn: isPaid(p) ? "" : today });
  const removeYear = async (y: string) => {
    if (!window.confirm(`Remove the ${y} payments from ${c.Title}'s record?`)) return;
    for (const p of mine.filter((x) => x.Tax === "SA" && x.EntryYear === y)) await remove("TaxPayments", p);
  };

  const row = (p: TaxPayment) => (
    <tr key={p.Key}>
      <td>{paymentLabel(p)}</td>
      <td className="mono">{fmtDate(String(p.DueDate))}</td>
      <td className="mono" style={{ textAlign: "right" }}>
        <AmountCell p={p} onSave={(v) => update("TaxPayments", p, { Amount: v })} />
      </td>
      <td><PayStatus p={p} today={today} /></td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <button type="button" className="btn small" onClick={() => markPaid(p)}>{isPaid(p) ? "Not paid" : "Mark paid"}</button>
        {p.Tax !== "SA" && (
          <button type="button" className="iconbtn small" aria-label={`Remove ${paymentLabel(p)}`} onClick={() => window.confirm("Remove this payment?") && remove("TaxPayments", p)}>
            <Icon name="close" size={14} />
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <div className="stack">
      <div className="tiles" style={{ maxWidth: 820 }}>
        <div className={`tile${overdue.length ? " red" : ""}`}>
          <div className="label">Overdue, not marked paid</div>
          <div className="value">{overdue.length ? money(overdue.reduce((t, p) => t + Number(p.Amount), 0)) : "None"}</div>
        </div>
        <div className="tile">
          <div className="label">Next payment</div>
          <div className="value" style={{ fontSize: 18 }}>
            {nextDue[0] ? <>{money(nextDue.filter((p) => p.DueDate === nextDue[0].DueDate).reduce((t, p) => t + Number(p.Amount), 0))} <span className="muted" style={{ fontSize: 13 }}>by {fmtDate(String(nextDue[0].DueDate))}</span></> : "Nothing due"}
          </div>
        </div>
      </div>

      <div className="row-wrap">
        <button type="button" className="btn primary" onClick={() => setAdding("sa")}><Icon name="plus" />Self Assessment year</button>
        <button type="button" className="btn" onClick={() => setAdding("ct")}><Icon name="plus" />Corporation tax</button>
        <button type="button" className="btn" onClick={() => setAdding("other")}><Icon name="plus" />Other payment</button>
        <span className="muted" style={{ fontSize: 12, flex: "1 1 220px" }}>
          These feed the payment reminders (Comms › Payment reminders), and the AI knows them when writing letters and emails.
        </span>
      </div>

      {(adding === "sa" || editYear) && (
        <SaYearForm client={c} year={editYear} onDone={() => { setAdding(""); setEditYear(undefined); }} />
      )}
      {adding === "ct" && <CtForm client={c} company={company} onDone={() => setAdding("")} />}
      {adding === "other" && <OtherForm client={c} onDone={() => setAdding("")} />}

      {years.map((y) => {
        const rows = mine.filter((p) => p.Tax === "SA" && p.EntryYear === y);
        const bal = rows.find((p) => p.Kind === "balancing");
        const order = { balancing: 1, poa1: 2, poa2: 3 } as Record<string, number>;
        return (
          <section key={y} className="card" aria-label={`${y} Self Assessment`}>
            <div className="card-head">
              <div className="stack" style={{ gap: 2 }}>
                <h2 style={{ margin: 0 }}>{y} tax return</h2>
                {bal && Number(bal.Bill) > 0 && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    Bill {money(Number(bal.Bill))}{Number(bal.OtherTax) ? ` + ${money(Number(bal.OtherTax))} other` : ""} · payments on account already made {money(Number(bal.PoaPaid))}
                  </span>
                )}
              </div>
              <div className="row-wrap">
                <button type="button" className="btn small" onClick={() => setEditYear(y)}>Change</button>
                <button type="button" className="iconbtn small" aria-label={`Remove ${y}`} onClick={() => removeYear(y)}><Icon name="close" size={14} /></button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="grid pay-table">
                <thead><tr><th scope="col">Payment</th><th scope="col">Due</th><th scope="col" style={{ textAlign: "right" }}>Amount</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{rows.sort((a, b) => order[a.Kind] - order[b.Kind]).map(row)}</tbody>
              </table>
            </div>
          </section>
        );
      })}

      {ct.length > 0 && (
        <section className="card" aria-label="Corporation tax">
          <div className="card-head"><h2 style={{ margin: 0 }}>Corporation tax</h2></div>
          <div className="table-wrap"><table className="grid pay-table"><tbody>{ct.map(row)}</tbody></table></div>
        </section>
      )}
      {other.length > 0 && (
        <section className="card" aria-label="Other payments">
          <div className="card-head"><h2 style={{ margin: 0 }}>Other payments</h2></div>
          <div className="table-wrap"><table className="grid pay-table"><tbody>{other.map(row)}</tbody></table></div>
        </section>
      )}
      {!mine.length && !adding && (
        <div className="card empty" style={{ padding: 24 }}>
          No tax payments yet. Add a Self Assessment year {company ? "or corporation tax " : ""}once the return is done, and reminders follow.
        </div>
      )}
    </div>
  );
}

function AmountCell({ p, onSave }: { p: TaxPayment; onSave: (v: number) => Promise<void> }) {
  const [v, setV] = useState<string | null>(null);
  if (v === null) {
    return <button type="button" className="linkbtn amount-btn" title="Change the amount" onClick={() => setV(String(Number(p.Amount) || 0))}>{money(Number(p.Amount))}</button>;
  }
  const commit = async () => {
    const n = num(v);
    setV(null);
    if (n !== Number(p.Amount)) await onSave(n);
  };
  return (
    <input className="input amount-input" inputMode="decimal" autoFocus value={v} aria-label={`Amount for ${paymentLabel(p)}`}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setV(null); }} />
  );
}

function SaYearForm({ client: c, year, onDone }: { client: Client; year?: string; onDone: () => void }) {
  const { data, create, update } = useData();
  const all = data.taxPayments as TaxPayment[];
  const today = todayIso();
  const existing = year ? all.filter((p) => p.ClientKey === c.Key && p.Tax === "SA" && p.EntryYear === year) : [];
  const bal = existing.find((p) => p.Kind === "balancing");
  const [start, setStart] = useState(year ? Number(year.slice(0, 4)) : taxYearOf(today) - 1);
  const label = taxYearLabel(start);
  const taken = !year && all.some((p) => p.ClientKey === c.Key && p.Tax === "SA" && p.EntryYear === label);
  const [bill, setBill] = useState(bal?.Bill !== undefined ? String(bal.Bill) : "");
  const [other, setOther] = useState(bal?.OtherTax ? String(bal.OtherTax) : "");
  const defaultPoa = poasFor(all, c.Key, label);
  const [poaPaid, setPoaPaid] = useState(bal?.PoaPaid !== undefined ? String(bal.PoaPaid) : defaultPoa ? String(defaultPoa) : "");
  const [atSource, setAtSource] = useState(!!bal?.MostlyAtSource);
  const calc = calcSa({ bill: num(bill), other: num(other), poaPaid: num(poaPaid), mostlyAtSource: atSource });
  const amt = (k: string) => existing.find((p) => p.Kind === k);
  const [manual, setManual] = useState<{ balancing?: string; poa1?: string; poa2?: string }>(
    year ? { balancing: String(amt("balancing")?.Amount ?? ""), poa1: String(amt("poa1")?.Amount ?? ""), poa2: String(amt("poa2")?.Amount ?? "") } : {},
  );
  const val = (k: "balancing" | "poa1" | "poa2") => (manual[k] !== undefined ? num(manual[k]!) : calc[k]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const d = saDates(start);

  const save = async () => {
    if (taken) return setError(`${label} is already on the record. Use Change on that year instead.`);
    setBusy(true);
    try {
      const inputs = { Bill: num(bill), OtherTax: num(other), PoaPaid: num(poaPaid), MostlyAtSource: atSource };
      if (year) {
        for (const p of existing) {
          await update("TaxPayments", p, { Amount: val(p.Kind as "balancing"), ...(p.Kind === "balancing" ? inputs : {}) });
        }
      } else {
        const next = taxYearLabel(start + 1);
        const rows: TaxPayment[] = [
          { Key: newKey("TP"), ClientKey: c.Key, Tax: "SA", Kind: "balancing", EntryYear: label, TaxYear: label, Amount: val("balancing"), DueDate: d.balancing, ...inputs },
          { Key: newKey("TP"), ClientKey: c.Key, Tax: "SA", Kind: "poa1", EntryYear: label, TaxYear: next, Amount: val("poa1"), DueDate: d.poa1 },
          { Key: newKey("TP"), ClientKey: c.Key, Tax: "SA", Kind: "poa2", EntryYear: label, TaxYear: next, Amount: val("poa2"), DueDate: d.poa2 },
        ];
        for (const r of rows) await create("TaxPayments", { ...r, Title: `${c.Title}: ${paymentLabel(r)}` });
      }
      onDone();
    } catch {
      setError("Couldn't save. Try again.");
      setBusy(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => taxYearOf(today) - 4 + i);
  const field = (k: "balancing" | "poa1" | "poa2", text: string, due: string) => (
    <label>
      {text} <span className="muted" style={{ fontWeight: 400 }}>· due {fmtDate(due)}</span>
      <input className="input mono" inputMode="decimal" value={manual[k] ?? calc[k].toFixed(2)} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} />
    </label>
  );

  return (
    <section className="card pad stack sa-form" aria-labelledby="sa-h">
      <h2 id="sa-h" style={{ margin: 0 }}>{year ? `Change ${year}` : "Add a Self Assessment year"}</h2>
      <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <label>
          Tax year of the return
          <select className="input" value={start} disabled={!!year} onChange={(e) => { setStart(Number(e.target.value)); setManual({}); }}>
            {years.map((y) => <option key={y} value={y}>{taxYearLabel(y)} (6 April {y} to 5 April {y + 1})</option>)}
          </select>
        </label>
        <span />
        <label>
          Self Assessment bill for the year (income tax and Class 4 NIC)
          <input className="input mono" inputMode="decimal" placeholder="0.00" value={bill} onChange={(e) => { setBill(e.target.value); setManual({}); }} />
        </label>
        <label>
          Other tax due 31 January (capital gains, student loan, Class 2)
          <input className="input mono" inputMode="decimal" placeholder="0.00" value={other} onChange={(e) => { setOther(e.target.value); setManual({}); }} />
        </label>
        <label>
          Payments on account already made for {label}
          <input className="input mono" inputMode="decimal" placeholder="0.00" value={poaPaid} onChange={(e) => { setPoaPaid(e.target.value); setManual({}); }} />
          {defaultPoa > 0 && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>From last year's record: {money(defaultPoa)}</span>}
        </label>
        <label className="radio" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={atSource} onChange={(e) => { setAtSource(e.target.checked); setManual({}); }} />
          <span>More than 80% of the tax was taken at source (no payments on account)</span>
        </label>
      </div>
      <div className="example">
        <strong>To pay</strong>
        <span>{calc.why}{calc.refund ? ` HMRC owes ${money(calc.refund)} back (payments on account were more than the bill).` : ""} Check these against the tax computation; change any amount below.</span>
      </div>
      <div className="form" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {field("balancing", `${label} balancing payment`, d.balancing)}
        {field("poa1", `${taxYearLabel(start + 1)} first payment on account`, d.poa1)}
        {field("poa2", `${taxYearLabel(start + 1)} second payment on account`, d.poa2)}
      </div>
      <p style={{ margin: 0, fontSize: 14 }}>
        By {fmtDate(d.balancing)}: <strong>{money(val("balancing") + val("poa1"))}</strong> · by {fmtDate(d.poa2)}: <strong>{money(val("poa2"))}</strong>
      </p>
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={busy || taken}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}

function CtForm({ client: c, company, onDone }: { client: Client; company: boolean; onDone: () => void }) {
  const { create } = useData();
  const idx = useIndex();
  const ctJob = (idx.jobsByClient.get(c.Key) || []).filter((j) => j.ServiceKey === "CT600" && j.PeriodEnd).sort((a, b) => String(b.PeriodEnd).localeCompare(String(a.PeriodEnd)))[0];
  const [pe, setPe] = useState(ctJob?.PeriodEnd || "");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState<string>();
  const dueDate = due ?? (pe ? ctDue(pe) : "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pe || !dueDate) return;
    setBusy(true);
    const r: TaxPayment = { Key: newKey("TP"), ClientKey: c.Key, Tax: "CT", Kind: "ct", TaxYear: pe, Amount: num(amount), DueDate: dueDate };
    await create("TaxPayments", { ...r, Title: `${c.Title}: ${paymentLabel(r)}` });
    onDone();
  };
  return (
    <section className="card pad stack" aria-labelledby="ct-h">
      <h2 id="ct-h" style={{ margin: 0 }}>Add corporation tax</h2>
      {!company && <p className="muted" style={{ margin: 0, fontSize: 13 }}>This client isn't marked as a company.</p>}
      <div className="form" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <label>Period end<input className="input" type="date" value={pe} onChange={(e) => { setPe(e.target.value); setDue(undefined); }} /></label>
        <label>Corporation tax<input className="input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Due (9 months and 1 day after)<input className="input" type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={busy || !pe}>Save</button>
      </div>
    </section>
  );
}

function OtherForm({ client: c, onDone }: { client: Client; onDone: () => void }) {
  const { create } = useData();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const save = async () => {
    if (!label.trim() || !due) return;
    const r: TaxPayment = { Key: newKey("TP"), ClientKey: c.Key, Tax: "OTHER", Kind: "other", Label: label.trim(), Amount: num(amount), DueDate: due };
    await create("TaxPayments", { ...r, Title: `${c.Title}: ${r.Label}` });
    onDone();
  };
  return (
    <section className="card pad stack" aria-labelledby="ot-h">
      <h2 id="ot-h" style={{ margin: 0 }}>Add another payment</h2>
      <div className="form" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <label>What it is<input className="input" placeholder="e.g. Capital gains tax on property sale" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label>Amount<input className="input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Due<input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={!label.trim() || !due}>Save</button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ payment reminders

export function usePaymentReminderCount(): number {
  const { data } = useData();
  const today = todayIso();
  return useMemo(() => reminderGroups(data.taxPayments as TaxPayment[], today, 30).filter((g) => !g.reminded).length, [data.taxPayments, today]);
}

export function PaymentReminders() {
  const { data, store, create, updateMany, saveSetting } = useData();
  const idx = useIndex();
  const prefs = useCommsPrefs();
  const today = todayIso();
  const [window_, setWindow] = useState(30);
  const [busy, setBusy] = useState<string>("");
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const template = readSetting<ReminderTemplate>(data.settings, "payments.template") || DEFAULT_REMINDER;
  const groups = reminderGroups(data.taxPayments as TaxPayment[], today, window_);
  const byDate = new Map<string, ReminderGroup[]>();
  for (const g of groups) byDate.set(g.due, [...(byDate.get(g.due) || []), g]);
  const sender = (prefs.signName || "").split(" ")[0] || "[your name]";
  const toDo = groups.filter((g) => !g.reminded && idx.clientByKey.get(g.clientKey)?.Email);

  const mailFor = (g: ReminderGroup) => {
    const c = idx.clientByKey.get(g.clientKey)!;
    return fillReminder(template, g, { greeting: emailGreeting(c), utr: c.UTR as string | undefined, sender });
  };

  const draft = async (g: ReminderGroup) => {
    const c = idx.clientByKey.get(g.clientKey);
    const to = String(c?.Email || "");
    if (!c || !to) throw new Error("no email");
    const mail = mailFor(g);
    const msg = await outlookDraft(store.graph, { to, subject: mail.subject, body: mail.body, signature: prefs.emailSignature });
    const now = new Date().toISOString();
    await create("Communications", {
      Key: newKey("M"), Title: mail.subject, ClientKey: c.Key, Kind: "email", Status: "outlook", Subject: mail.subject, Body: mail.body,
      Brief: `Payment reminder for ${fmtLong(g.due)}`, ToEmail: to, Created: now, Updated: now, OutlookUrl: msg.webLink || "",
    });
    await updateMany("TaxPayments", g.payments.map((row) => ({ row, patch: { RemindedOn: today } })));
  };

  const run = async (list: ReminderGroup[], label: string) => {
    if (!mailAllowed()) return addScope(MAIL_SCOPE, true);
    setBusy(label);
    setError(undefined);
    setResult(undefined);
    let done = 0;
    const failed: string[] = [];
    for (const g of list) {
      try {
        await draft(g);
        done++;
      } catch {
        failed.push(idx.clientByKey.get(g.clientKey)?.Title || g.clientKey);
      }
    }
    setBusy("");
    setResult(`${done} reminder${done === 1 ? "" : "s"} put in your Outlook drafts. Check them and send them from Outlook.`);
    if (failed.length) setError(`Couldn't make: ${failed.join(", ")}. Try again.`);
  };

  const markPaid = (g: ReminderGroup) => updateMany("TaxPayments", g.payments.map((row) => ({ row, patch: { PaidOn: today } })));

  const aiLink = (g: ReminderGroup) => {
    const brief = `Remind them that this tax is due to HMRC by ${fmtLong(g.due)}: ${g.payments.map((p) => `${paymentLabel(p)} ${fmtMoney(Number(p.Amount))}`).join("; ")}. Total ${fmtMoney(g.total)}.`;
    return `#/comms/new?kind=email&client=${encodeURIComponent(g.clientKey)}&brief=${encodeURIComponent(brief)}`;
  };

  return (
    <div className="page">
      <CommsTabs current="payments" />
      <div className="page-head">
        <div>
          <h1>Payment reminders</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Tax payments due soon and not marked paid, one email per client and date. They come from each client's Tax payments tab.
          </p>
        </div>
        <div className="row-wrap">
          <label>
            <span className="sr-only">Due within</span>
            <select className="input" value={window_} onChange={(e) => setWindow(Number(e.target.value))} style={{ width: "auto" }}>
              <option value={14}>Due in 14 days</option>
              <option value={30}>Due in 30 days</option>
              <option value={60}>Due in 60 days</option>
              <option value={120}>Due in 120 days</option>
            </select>
          </label>
          <button type="button" className="btn primary" disabled={!toDo.length || !!busy} onClick={() => run(toDo, "all")}>
            <Icon name="mail" />{busy === "all" ? "Making drafts…" : `Draft ${toDo.length || ""} reminder${toDo.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      {!mailAllowed() && <p className="muted" style={{ margin: 0, fontSize: 13 }}>The first time, Microsoft asks you to let the planner create Outlook drafts. It never sends anything itself.</p>}
      {result && <div className="alert green-alert" role="status">{result}</div>}
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}

      {[...byDate.entries()].map(([due, list]) => (
        <section key={due} className="card" aria-label={`Due ${fmtLong(due)}`}>
          <div className="card-head">
            <h2 style={{ margin: 0 }}>Due {fmtDate(due, { weekday: true })}</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              {due < today ? `${days(due, today)} days overdue` : `in ${days(today, due)} days`} · {list.length} client{list.length === 1 ? "" : "s"} · {fmtMoney(list.reduce((t, g) => t + g.total, 0))}
            </span>
          </div>
          <ul className="remind-list">
            {list.map((g) => {
              const c = idx.clientByKey.get(g.clientKey);
              return (
                <li key={`${g.clientKey}-${g.due}`}>
                  <div className="stack" style={{ gap: 2, minWidth: 0, flex: "1 1 auto" }}>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      {c ? <a className="cell-title" href={href("clients", c.Key, "tax")}>{c.Title}</a> : g.clientKey}
                      {g.overdue && <span className="chip red">Overdue</span>}
                      {g.reminded && <span className="chip blue">Reminded {fmtDate(g.reminded, { year: false })}</span>}
                      {!c?.Email && <span className="chip amber">No email on file</span>}
                    </div>
                    <span style={{ fontSize: 13 }}>
                      {g.payments.map((p) => `${paymentLabel(p)} ${fmtMoney(Number(p.Amount))}`).join(" · ")} · <strong>{fmtMoney(g.total)}</strong>
                    </span>
                  </div>
                  <div className="row-wrap" style={{ gap: 6 }}>
                    <button type="button" className="btn small" onClick={() => markPaid(g)}>Paid</button>
                    <a className="btn small" href={aiLink(g)}><Icon name="spark" />Write with AI</a>
                    <button type="button" className="btn small primary" disabled={!c?.Email || !!busy} onClick={() => run([g], g.clientKey)}>
                      {busy === g.clientKey ? "Drafting…" : g.reminded ? "Draft again" : "Draft email"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!groups.length && <div className="card empty" style={{ padding: 24 }}>No tax payments due in the next {window_} days that aren't marked paid.</div>}

      <ReminderTemplateEditor template={template} onSave={(t) => saveSetting("payments.template", t)} />
    </div>
  );
}

function ReminderTemplateEditor({ template, onSave }: { template: ReminderTemplate; onSave: (t: ReminderTemplate) => Promise<void> }) {
  const [draft, setDraft] = useState(template);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const changed = draft.subject !== template.subject || draft.body !== template.body;
  return (
    <details className="card">
      <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Reminder wording</h2></summary>
      <div className="stack" style={{ padding: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Used for every reminder drafted from this page. These fill themselves in: {REMINDER_PLACEHOLDERS.map(([k, v], i) => (
            <span key={k}>{i ? ", " : ""}<span className="mono">{k}</span> {v}</span>
          ))}. Your email signature is added underneath.
        </p>
        <div className="form" style={{ gridTemplateColumns: "1fr" }}>
          <label>Subject<input className="input" value={draft.subject} onChange={(e) => { setDraft({ ...draft, subject: e.target.value }); setState("idle"); }} /></label>
          <label>Message<textarea className="input" rows={14} value={draft.body} onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setState("idle"); }} /></label>
        </div>
        <div className="form-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" className="linkbtn" onClick={() => setDraft(DEFAULT_REMINDER)}>Use the standard wording</button>
          <div className="row-wrap">
            {state === "saved" && !changed && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
            {state === "error" && <span className="error-text">Couldn't save</span>}
            <button type="button" className="btn primary" disabled={!changed || state === "saving"}
              onClick={async () => { setState("saving"); try { await onSave(draft); setState("saved"); } catch { setState("error"); } }}>
              {state === "saving" ? "Saving…" : "Save wording"}
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
