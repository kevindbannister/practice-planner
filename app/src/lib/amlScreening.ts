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
