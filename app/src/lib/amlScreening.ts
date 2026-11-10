// When a client was last screened for sanctions and PEPs, and when the next re-screen is due under the firm's policy. The last date is the
// latest of: Xama's AML check, a sanctions/PEP check recorded in an AML assessment, and an entry for the client in the screening register.
import { readAssessment } from "./amlAssessment";
import { ScreeningPolicy } from "./amlPolicy";
import { addMonths } from "./planning";
import { Row } from "./schema";
import { amlStampRead } from "./xamaActions";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export type Screened = { on: string; via: string; due: string; days: number | null; months: number; match: boolean };

export function lastScreened(client: Row, assessments: Row[], register: { values: Record<string, unknown> }[]): { on: string; via: string; match: boolean } {
  const found: { on: string; via: string; match: boolean }[] = [];
  const x = amlStampRead(client.XamaAmlCheck);
  if ((x.state === "done" || x.state === "check") && ISO.test(x.on)) found.push({ on: x.on, via: "Xama", match: x.state === "check" });
  for (const r of assessments) {
    if (r.ClientKey !== client.Key) continue;
    for (const c of readAssessment(r).checks) { const on = str(c.at).slice(0, 10); if (/sanction|pep/i.test(c.kind) && c.result !== "pending" && ISO.test(on) && !/^Xama/.test(c.note)) found.push({ on, via: "AML assessment", match: c.result === "fail" }); }
  }
  for (const r of register) {
    const on = str(r.values.on).slice(0, 10);
    if (str(r.values.client) === client.Key && ISO.test(on)) found.push({ on, via: "Screening register", match: /possible|confirmed|further/i.test(str(r.values.result)) });
  }
  return found.sort((a, b) => b.on.localeCompare(a.on))[0] || { on: "", via: "", match: false };
}

/** The next re-screen for a client: months by risk (medium if not rated yet). No date when the client has never been screened. */
export function screening(client: Row, risk: string, sp: ScreeningPolicy, assessments: Row[], register: { values: Record<string, unknown> }[], today: string): Screened {
  const last = lastScreened(client, assessments, register);
  const months = risk === "high" ? sp.high : risk === "low" ? sp.low : sp.medium;
  if (!last.on) return { ...last, due: "", days: null, months };
  const due = addMonths(last.on, months, false);
  return { ...last, due, months, days: Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) };
}

/** How a client's sanctions and PEP screening stands, for showing: green when it's within the policy period, amber in the last 30 days before it
 *  is due, red when it's overdue, has never been done, or found a possible match. `line` says when it was done and when the next is due. */
export type ScreenStatus = { tone: "green" | "amber" | "red"; label: string; line: string };
export function screeningStatus(s: Screened, fmt: (iso: string) => string): ScreenStatus {
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (s.match) return { tone: "red", label: "Possible match", line: s.on ? `Screened ${fmt(s.on)}: look at it and record the outcome in the Screening register.` : "Look at it and record the outcome in the Screening register." };
  if (!s.on || s.days === null) return { tone: "red", label: "Not screened", line: "No sanctions and PEP screening on record yet." };
  const done = `Screened ${fmt(s.on)}`;
  if (s.days < 0) return { tone: "red", label: `Overdue ${plural(-s.days)}`, line: `${done}. Re-screen was due ${fmt(s.due)}.` };
  if (s.days <= 30) return { tone: "amber", label: `Due in ${plural(s.days)}`, line: `${done}. Next due ${fmt(s.due)}.` };
  return { tone: "green", label: "Up to date", line: `${done}. Next due ${fmt(s.due)} (in ${plural(s.days)}).` };
}

type Reg = { values: Record<string, unknown> }[];
const regFor = (client: Row, register: Reg) => register.filter((r) => str(r.values.client) === client.Key);

/** Before approval (or completing a short review): the client has been screened for sanctions and PEPs within the policy period for its risk,
 *  and a company has had the company itself screened (Xama only checks a person). `draftChecks` are checks on the form not yet saved. */
export function screeningProblems(client: Row, risk: string, sp: ScreeningPolicy, assessments: Row[], register: Reg, today: string, opts: { company: boolean; draftChecks?: { kind: string; result: string; at: string; note: string }[] }): string[] {
  const out: string[] = [];
  const extra: Row[] = opts.draftChecks ? [{ ClientKey: client.Key, Checks: JSON.stringify(opts.draftChecks) }] : [];
  const s = screening(client, risk, sp, [...assessments, ...extra], register, today);
  if (!s.on) out.push("Screen the client for sanctions and PEPs first: a Xama AML check, a passed sanctions and PEP check, or an entry in the Screening register.");
  else if (s.days !== null && s.days < 0) out.push(`The last sanctions and PEP screening (${s.on}) is older than your policy allows for this risk level (every ${s.months} months). Re-screen first.`);
  if (opts.company) {
    const months = s.months;
    const since = addMonths(today, -months, false);
    const ent = (opts.draftChecks || []).some((c) => /company sanctions/i.test(c.kind) && c.result === "pass" && str(c.at).slice(0, 10) >= since)
      || assessments.some((r) => r.ClientKey === client.Key && readAssessment(r).checks.some((c) => /company sanctions/i.test(c.kind) && c.result === "pass" && str(c.at).slice(0, 10) >= since))
      || regFor(client, register).some((r) => /^client$|company|entity/i.test(str(r.values.role)) && str(r.values.on).slice(0, 10) >= since && /no match/i.test(str(r.values.result)));
    if (!ent) out.push("Screen the company itself against the UK Sanctions List (Xama only checks a person): add a passed \"Company sanctions screening\" check, or a Screening register entry with the role \"Client\".");
  }
  return out;
}

/** A possible or confirmed PEP/sanctions match stops approval until the Screening register records it was looked at and cleared. */
export function matchProblems(client: Row, register: Reg): string[] {
  const x = amlStampRead(client.XamaAmlCheck);
  const mine = regFor(client, register).sort((a, b) => str(b.values.on).localeCompare(str(a.values.on)));
  if (mine.some((r) => /confirmed/i.test(str(r.values.result)))) return ["The Screening register records a confirmed sanctions or PEP match. Don't proceed: the MLRO decides what happens, including any report."];
  if (x.state === "check") {
    const cleared = mine.some((r) => str(r.values.on).slice(0, 10) >= x.on && /no match/i.test(str(r.values.result)) && str(r.values.resolution).trim());
    if (!cleared) return [`Xama's AML check on ${x.on} found a possible PEP or sanctions match. Look at it in Xama, then record in the Screening register that it isn't a match and why, before approving.`];
  }
  const open = mine[0] && /possible|further review/i.test(str(mine[0].values.result));
  return open ? ["The latest Screening register entry for this client is a possible match still under review. Resolve it first."] : [];
}
