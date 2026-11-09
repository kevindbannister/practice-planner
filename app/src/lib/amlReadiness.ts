// A checklist of what an ACCA-supervised firm is expected to have in place for AML, worked out from what is recorded in the planner.
// "Done" means the planner holds evidence of it; "Needs work" says what is missing. It cannot judge whether an answer is good, and some
// duties (such as screening staff) can only be checked by wording in the policy, not by evidence. The regulation numbers are the
// Money Laundering Regulations 2017; check them against ACCA's current guidance before relying on them.
export type Standing = "none" | "draft" | "overdue" | "soon" | "ok";
export type Builder = { confirmed: number; total: number; version: string; approved: boolean; date: string; steps: Record<string, boolean> };
export type Facts = {
  today: string; policy: Builder; fwra: Builder; mlro: string; deputy: string;
  standing: Record<"mlro" | "training" | "independent" | "annualreturn" | "reviews", { state: Standing; text: string }>;
  trainingNext: string; screeningLast: string;
  /** Clients with an assessment whose sanctions/PEP re-screen is overdue, or who have never been screened. Optional for older callers. */
  screening?: { overdue: number; never: number };
  clients: { total: number; none: number; overdue: number; soon: number; triggered: number };
  regs: { count: number; late: number; open: number }; actions: { open: number; late: number };
};
export type State = "done" | "work" | "start";
export type Item = { id: string; group: string; title: string; reg: string; state: State; detail: string; to: string };

const YEAR = 366;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function builderItem(f: Facts, b: Builder, id: string, group: string, title: string, reg: string, to: string, what: string): Item[] {
  const left = b.total - b.confirmed;
  const done = left === 0 && !!b.version;
  const items: Item[] = [{ id, group, title, reg, to, state: done ? "done" : b.confirmed === 0 && !b.version ? "start" : "work", detail: done ? `All ${b.total} areas confirmed, version ${b.version} saved${b.approved ? " and approved" : " but not marked approved"}.` : `${b.confirmed} of ${b.total} areas confirmed${left ? `: ${left} left to answer and confirm` : ""}${b.version ? "" : ", and no version saved yet"}.` }];
  if (done && !b.approved) items[0].state = "work";
  const age = b.date ? days(b.date, f.today) : null;
  items.push({ id: `${id}-fresh`, group, title: `${what} reviewed in the last 12 months`, reg, to: `${to}`, state: age === null ? "start" : age <= YEAR ? "done" : "work", detail: age === null ? "No saved version, so no review date." : age <= YEAR ? `Last saved ${fmt(b.date)}.` : `Last saved ${fmt(b.date)}, ${age} days ago. Review it and save a new version.` });
  return items;
}
const fromStanding = (s: { state: Standing; text: string }): { state: State; detail: string } => ({ state: s.state === "ok" || s.state === "soon" ? "done" : s.state === "none" ? "start" : "work", detail: s.state === "soon" ? `${s.text}.` : `${s.text}.` });

export function readiness(f: Facts): Item[] {
  const out: Item[] = [];
  out.push(...builderItem(f, f.fwra, "fwra", "Risk assessment and policy", "Firm-wide risk assessment", "Reg 18", "fwra", "Risk assessment"));
  out.push(...builderItem(f, f.policy, "policy", "Risk assessment and policy", "Written AML policies, controls and procedures", "Reg 19", "policies", "Policy"));
  const step = (id: string) => f.policy.steps[id] === true;
  out.push({ id: "mlro-named", group: "People", title: "MLRO appointed and named", reg: "Reg 21", to: "policies", state: f.mlro ? "done" : "work", detail: f.mlro ? `${f.mlro}${f.deputy ? `, with ${f.deputy} as alternate` : ", with no alternate named"}.` : "Name the MLRO in the policy." });
  const mlro = fromStanding(f.standing.mlro);
  out.push({ id: "mlro-report", group: "People", title: "MLRO annual report approved and in date", reg: "Reg 21", to: "mlro", ...mlro });
  const tr = fromStanding(f.standing.training);
  const trLate = f.trainingNext && f.trainingNext < f.today;
  out.push({ id: "training", group: "People", title: "Staff training recorded and in date", reg: "Reg 24", to: "training", state: f.standing.training.state === "none" ? "start" : trLate ? "work" : "done", detail: f.standing.training.state === "none" ? "Not started." : trLate ? `Refresher was due ${fmt(f.trainingNext)}.` : f.trainingNext ? `Next refresher ${fmt(f.trainingNext)}.` : tr.detail });
  out.push({ id: "staff", group: "People", title: "Staff screening and responsibilities written down", reg: "Reg 21", to: "policies", state: step("staff") ? "done" : "work", detail: step("staff") ? "Confirmed in the policy." : "The staff section of the policy isn't confirmed. The planner can't track the checks themselves." });
  const total = f.clients.total, bad = f.clients.none + f.clients.overdue;
  out.push({ id: "cdd", group: "Clients", title: "Every active client has a current AML assessment", reg: "Regs 27 and 28", to: "clients", state: total === 0 ? "start" : bad === 0 ? "done" : "work", detail: total === 0 ? "No active clients found." : bad === 0 ? `All ${total} clients are assessed and in date${f.clients.soon ? `; ${f.clients.soon} due soon` : ""}.` : `${f.clients.none} with no assessment and ${f.clients.overdue} overdue, of ${total} clients.` });
  out.push({ id: "triggers", group: "Clients", title: "No triggered reviews waiting", reg: "Reg 28(11)", to: "clients", state: f.clients.triggered === 0 ? "done" : "work", detail: f.clients.triggered === 0 ? "None waiting." : `${f.clients.triggered} client${f.clients.triggered === 1 ? "" : "s"} with a change that should prompt a review.` });
  out.push({ id: "monitoring", group: "Clients", title: "Review frequencies and triggers set in the policy", reg: "Reg 28(11)", to: "policies", state: step("monitor") ? "done" : "work", detail: step("monitor") ? "Confirmed in the policy." : "The monitoring section of the policy isn't confirmed." });
  out.push({ id: "edd", group: "Clients", title: "Enhanced checks and politically exposed persons covered", reg: "Regs 33 to 35", to: "policies", state: step("dd") && step("clientrisk") ? "done" : "work", detail: step("dd") && step("clientrisk") ? "Client risk and due diligence sections confirmed." : "Confirm the client risk rating and due diligence sections of the policy." });
  const sc = f.screeningLast ? days(f.screeningLast, f.today) : null;
  const late = (f.screening?.overdue || 0) + (f.screening?.never || 0);
  const scDetail = f.screening ? (late ? `${f.screening.never ? `${f.screening.never} assessed client${f.screening.never === 1 ? "" : "s"} never screened` : ""}${f.screening.never && f.screening.overdue ? "; " : ""}${f.screening.overdue ? `${f.screening.overdue} overdue a re-screen` : ""}. See the Client tracker's "Screening due" filter.` : `Every assessed client is screened within your policy's periods${f.screeningLast ? `; last logged ${fmt(f.screeningLast)}` : ""}.`) : "";
  out.push({ id: "sanctions", group: "Clients", title: "Sanctions and PEP screening procedure, with checks logged", reg: "Sanctions and Anti-Money Laundering Act 2018", to: f.screening && late ? "clients" : "screening", state: !step("sanctions") ? "work" : f.screening ? (late ? "work" : "done") : sc === null ? "work" : sc <= YEAR ? "done" : "work", detail: !step("sanctions") ? "The sanctions section of the policy isn't confirmed." : f.screening ? scDetail : sc === null ? "No screening check is logged." : sc <= YEAR ? `Last logged ${fmt(f.screeningLast)}.` : `Last logged ${fmt(f.screeningLast)}. Log a recent check.` });
  out.push({ id: "sar", group: "Reporting and records", title: "Suspicious activity reporting procedure written down", reg: "POCA 2002 and Terrorism Act 2000", to: "policies", state: step("sar") ? "done" : "work", detail: step("sar") ? "Confirmed in the policy. Reports themselves are kept outside the planner." : "The reporting section of the policy isn't confirmed." });
  out.push({ id: "records", group: "Reporting and records", title: "Record keeping and data protection covered", reg: "Reg 40", to: "policies", state: step("records") && step("dp") ? "done" : "work", detail: step("records") && step("dp") ? "Both sections confirmed in the policy." : "Confirm the records and data protection sections of the policy." });
  out.push({ id: "ch", group: "Supervision and registration", title: "Companies House and company-service duties covered", reg: "Companies Act 2006", to: "policies", state: step("ch") && step("tcsp") ? "done" : "work", detail: step("ch") && step("tcsp") ? "Both sections confirmed in the policy." : "Confirm the Companies House and company-services sections of the policy." });
  const rg = f.regs;
  out.push({ id: "registrations", group: "Supervision and registration", title: "Registrations and approvals listed and in date", reg: "ACCA rules", to: "registrations", state: rg.count === 0 ? "start" : rg.late ? "work" : rg.open ? "work" : "done", detail: rg.count === 0 ? "Not started." : rg.late ? `${rg.late} past their next-due date.` : rg.open ? `${rg.open} still to do.` : `All ${rg.count} items done and in date.` });
  const ar = fromStanding(f.standing.annualreturn);
  out.push({ id: "annual", group: "Supervision and registration", title: "ACCA annual AML return completed and approved", reg: "ACCA supervision", to: "annualreturn", ...ar });
  const ind = fromStanding(f.standing.independent);
  out.push({ id: "independent", group: "Supervision and registration", title: "Independent review of AML controls", reg: "Reg 21", to: "independent", ...ind });
  out.push({ id: "actions", group: "Supervision and registration", title: "AML actions up to date", reg: "", to: "actions", state: f.actions.late ? "work" : "done", detail: f.actions.late ? `${f.actions.late} overdue, ${f.actions.open} open.` : f.actions.open ? `${f.actions.open} open, none overdue.` : "No open actions." });
  return out;
}
