// The AML records as one timeline: every client review, screening check, training record, action, registration, MLRO report and independent
// review, each dated, with what is coming up next. Each entry says which form it lives in, so it opens in that form. Nothing is copied: the
// timeline is read from the same stored records the forms use.
import { Rec, Store } from "./amlPack";

export type RecType = "review" | "screening" | "training" | "action" | "registration" | "mlro" | "independent";
/** The kinds of entry, in the order they are offered. `form` is the form the entries are kept in; `single` is a register that grows by rows. */
export const REC_TYPES: { type: RecType; form: string; label: string; add: string; single: boolean }[] = [
  { type: "review", form: "reviews", label: "Client reviews", add: "Client review", single: false },
  { type: "screening", form: "screening", label: "Screening", add: "Screening check", single: false },
  { type: "training", form: "training", label: "Training", add: "Training record", single: true },
  { type: "action", form: "actions", label: "Actions", add: "Action", single: true },
  { type: "registration", form: "registrations", label: "Registrations", add: "Registration or approval", single: true },
  { type: "mlro", form: "mlro", label: "MLRO report", add: "MLRO annual report", single: false },
  { type: "independent", form: "independent", label: "Independent review", add: "Independent review", single: false },
];
export const FORM_OF = Object.fromEntries(REC_TYPES.map((t) => [t.form, t.type])) as Record<string, RecType>;

export type Tone = "green" | "amber" | "red" | "";
export type Entry = {
  key: string; type: RecType; form: string; /** the record's id, for a form with one record each time */ rec?: string; date: string; title: string; detail: string;
  /** the row in a register, to open it there */ row?: number; /** somewhere else to open it (a client's AML page, for a Xama check) */ to?: string;
  chip: string; tone: Tone; /** a date still to come (or missed) rather than something done */ upcoming: boolean; client?: string;
};

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string => { const x = str(v).slice(0, 10); return ISO.test(x) ? x : ""; };
const gap = (to: string, today: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

/** How a date still to come stands: red once it has passed, amber within 60 days, otherwise nothing to worry about. */
function dueTone(on: string, today: string): { chip: string; tone: Tone } {
  const d = gap(on, today);
  return d < 0 ? { chip: `Overdue ${-d} day${d === -1 ? "" : "s"}`, tone: "red" } : d <= 60 ? { chip: d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`, tone: "amber" } : { chip: "Scheduled", tone: "green" };
}

type Stores = Record<string, Store>;
/** `xama` is each client's AML check as Xama reported it (identity, PEP and sanctions), shown with the screening checks. */
type Open = { name: (clientKey: string) => string; today: string; xama?: { client: string; on: string; state: string; pep: number; sanctions: number }[] };

export function timeline(stores: Stores, o: Open): Entry[] {
  const out: Entry[] = [];
  const recs = (form: string) => [...(stores[form]?.records || [])];
  const latest = (list: Rec[]) => [...list].sort((a, b) => b.created.localeCompare(a.created))[0];

  // client reviews: one entry each, and the next review from each client's latest
  const reviews = recs("reviews");
  for (const r of reviews) {
    const client = str(r.values.client), who = o.name(client) || "No client chosen";
    out.push({ key: `review:${r.id}`, type: "review", form: "reviews", rec: r.id, date: day(r.values.on) || r.created, title: `Review of ${who}`, detail: [str(r.values.newRating) && `Risk ${str(r.values.newRating).toLowerCase()}`, str(r.values.reviewer) && `by ${str(r.values.reviewer)}`].filter(Boolean).join(", "), chip: r.status === "Approved" ? "Approved" : "Draft", tone: r.status === "Approved" ? "green" : "amber", upcoming: false, client });
  }
  const byClient = new Map<string, Rec>();
  for (const r of reviews) { const k = str(r.values.client); const cur = byClient.get(k); if (!cur || r.created > cur.created) byClient.set(k, r); }
  for (const [client, r] of byClient) {
    const next = day(r.values.next); if (!next || r.status !== "Approved") continue;
    out.push({ key: `review-next:${r.id}`, type: "review", form: "reviews", rec: r.id, date: next, title: `Review of ${o.name(client) || "client"} due`, detail: "", ...dueTone(next, o.today), upcoming: true, client });
  }

  for (const r of recs("screening")) {
    const client = str(r.values.client), result = str(r.values.result), on = day(r.values.on) || r.created;
    const tone: Tone = /confirmed/i.test(result) ? "red" : /possible|further/i.test(result) ? "amber" : result ? "green" : r.status === "Approved" ? "green" : "amber";
    out.push({ key: `screening:${r.id}`, type: "screening", form: "screening", rec: r.id, date: on, title: `${str(r.values.who) || o.name(client) || "Screening check"}${client && str(r.values.who) ? ` (${o.name(client)})` : ""}`, detail: [str(r.values.role), str(r.values.source)].filter(Boolean).join(", "), chip: result || (r.status === "Approved" ? "Approved" : "Draft"), tone, upcoming: false, client });
  }

  for (const x of o.xama || []) {
    if (!day(x.on) || x.state === "waiting") continue;
    const hit = x.state === "check";
    out.push({ key: `xama:${x.client}`, type: "screening", form: "screening", to: `#/clients/${encodeURIComponent(x.client)}/aml`, date: day(x.on), title: `${o.name(x.client) || "Client"}: Xama AML check`, detail: "Identity, PEP and sanctions, from Xama", chip: hit ? `Possible matches: ${x.pep} PEP, ${x.sanctions} sanctions` : "No match", tone: hit ? "red" : "green", upcoming: false, client: x.client });
  }

  // training: a row for each person's course, and when it is next due
  for (const r of recs("training")) {
    const rows = Array.isArray(r.values.people) ? (r.values.people as Record<string, unknown>[]) : [];
    rows.forEach((p, i) => {
      const on = day(p.on), next = day(p.next), who = str(p.person) || "Someone", course = str(p.course);
      if (on || course || str(p.result)) out.push({ key: `training:${r.id}:${i}`, type: "training", form: "training", row: i, date: on, title: `${who}: ${course || "training"}`, detail: str(p.result), chip: !on ? "No date" : str(p.result) ? "Recorded" : "No result noted", tone: on && str(p.result) ? "green" : "amber", upcoming: false });
      if (next) out.push({ key: `training-next:${r.id}:${i}`, type: "training", form: "training", row: i, date: next, title: `${who}: training due`, detail: course, ...dueTone(next, o.today), upcoming: true });
    });
  }

  // actions: dated by when they are due, and green once done
  for (const r of recs("actions")) {
    const rows = Array.isArray(r.values.actions) ? (r.values.actions as Record<string, unknown>[]) : [];
    rows.forEach((a, i) => {
      const status = str(a.status) || "Open", due = day(a.due), done = status === "Done";
      const t = done ? { chip: "Done", tone: "green" as Tone } : due ? { ...dueTone(due, o.today), chip: gap(due, o.today) < 0 ? `${status}, overdue` : status } : { chip: status, tone: "amber" as Tone };
      out.push({ key: `action:${r.id}:${i}`, type: "action", form: "actions", row: i, date: due, title: `${str(a.ref) ? `${str(a.ref)}: ` : ""}${str(a.action) || "Action"}`, detail: [str(a.owner) && `Owner: ${str(a.owner)}`, !due && !done && "no due date"].filter(Boolean).join(", "), chip: t.chip, tone: t.tone, upcoming: !done && !!due && due >= o.today });
    });
  }

  // registrations and approvals: when each was done, and when it next needs renewing
  for (const r of recs("registrations")) {
    const rows = Array.isArray(r.values.items) ? (r.values.items as Record<string, unknown>[]) : [];
    rows.forEach((a, i) => {
      const on = day(a.on), next = day(a.next), item = str(a.item) || "Registration";
      if (on) out.push({ key: `registration:${r.id}:${i}`, type: "registration", form: "registrations", row: i, date: on, title: item, detail: [str(a.status), str(a.ref) && `Ref ${str(a.ref)}`].filter(Boolean).join(", "), chip: str(a.status) || "Recorded", tone: "green", upcoming: false });
      if (next) out.push({ key: `registration-next:${r.id}:${i}`, type: "registration", form: "registrations", row: i, date: next, title: `${item}: renewal or review due`, detail: "", ...dueTone(next, o.today), upcoming: true });
    });
  }

  for (const [form, type, noun, nextKey, dateKey] of [["mlro", "mlro", "MLRO annual report", "nextReport", "prepared"], ["independent", "independent", "Independent AML controls review", "followUp", ""]] as const) {
    const list = recs(form);
    for (const r of list) out.push({ key: `${form}:${r.id}`, type, form, rec: r.id, date: (dateKey && day(r.values[dateKey])) || r.created, title: noun, detail: str(r.values.period) || str(r.values.reviewer), chip: r.status === "Approved" ? "Approved" : "Draft", tone: r.status === "Approved" ? "green" : "amber", upcoming: false });
    const l = latest(list), next = l && l.status === "Approved" ? day(l.values[nextKey]) : "";
    if (l && next) out.push({ key: `${form}-next:${l.id}`, type, form, rec: l.id, date: next, title: `${noun} due`, detail: "", ...dueTone(next, o.today), upcoming: true });
  }

  // newest first; entries with no date at the end
  return out.sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
