// Registering a client as a CIS contractor with HMRC: what HMRC asks for, taken from what the
// planner already holds, and what's still missing. HMRC's own guidance is that a contractor
// registers by setting up as a new employer (if they have no PAYE reference yet) and must be
// registered before paying a first subcontractor.
import { Client } from "./domain";

export const EMPLOYER_HELPLINE = "0300 200 3200";
export const CIS_HELPLINE = "0300 200 3210";

export type Firm = {
  firmName: string; contactName: string; address: string; phone: string; email: string;
  agentRef: string; // HMRC agent reference number
  authorisation: string; // how the firm is authorised to act (64-8 on file, agent services, date...)
  notes: string;
};
export const EMPTY_FIRM: Firm = { firmName: "", contactName: "", address: "", phone: "", email: "", agentRef: "", authorisation: "", notes: "" };

export type CisStatus = "registered" | "not-contractor" | "";
export const cisStatus = (c: Client): CisStatus => (c.CISStatus === "registered" || c.CISStatus === "not-contractor" ? c.CISStatus : "");

export type Need = { label: string; value: string; note?: string; fix?: string };

const oneLine = (s: unknown) => String(s || "").split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).join(", ");

/** What HMRC will ask for, from the client's record. An empty value means it's missing. */
export function needs(c: Client): Need[] {
  const company = c.Kind === "Ltd" || c.Kind === "LLP";
  const sole = !company;
  const out: Need[] = [
    { label: "Legal name", value: c.Title, note: c.TradingName && c.TradingName !== c.Title ? `Trading as ${c.TradingName}` : undefined },
    company
      ? { label: "Registered office", value: oneLine(c.RegisteredOffice), fix: "Add the registered office address" }
      : { label: "Business address", value: oneLine(c.TradingAddress || c.HomeAddress), fix: "Add the business or home address" },
  ];
  if (company && (c.TradingAddress || "")) out.push({ label: "Trading address", value: oneLine(c.TradingAddress) });
  out.push(company
    ? { label: "Corporation tax UTR", value: String(c.CTUTR || ""), fix: "Add it under References" }
    : { label: "Self Assessment UTR", value: String(c.UTR || ""), fix: "Add it under References" });
  out.push(company
    ? { label: "Company number", value: String(c.CompanyNumber || ""), fix: "Add it under References" }
    : { label: "National Insurance number", value: String(c.NINumber || ""), fix: "Add it under References" });
  out.push({ label: "Employer PAYE reference", value: String(c.PAYERef || ""), note: c.PAYERef ? undefined : "If they have none, HMRC sets up a PAYE scheme first (even with no employees); the letter can take up to two weeks.", fix: "Add it under References if they have one" });
  out.push({ label: "Accounts Office reference", value: String(c.AccountsOfficeRef || ""), note: c.AccountsOfficeRef ? undefined : "Comes with the PAYE reference.", fix: "Add it under References if they have one" });
  out.push({ label: "Contact telephone", value: String(c.Mobile || c.Phone || ""), fix: "Add a phone number" });
  out.push({ label: "Contact email", value: String(c.Email || ""), fix: "Add an email" });
  void sole;
  return out;
}

/** The firm's details as HMRC will want them when an agent registers for the client. */
export function agentNeeds(f: Firm): Need[] {
  return [
    { label: "Agent firm", value: f.firmName, fix: "Add it in Settings › Your firm" },
    { label: "Contact at the firm", value: f.contactName },
    { label: "Firm address", value: oneLine(f.address), fix: "Add it in Settings › Your firm" },
    { label: "Firm telephone", value: f.phone },
    { label: "Firm email", value: f.email },
    { label: "HMRC agent reference", value: f.agentRef, fix: "Add it in Settings › Your firm" },
    { label: "Authorisation to act", value: f.authorisation, fix: "Say how you're authorised (for example 64-8 on file)" },
  ];
}

/** Plain text of everything above, to paste into a note or an email. */
export function summary(c: Client, firm: Firm, firstPayment: string, fmt: (iso: string) => string): string {
  const lines = ["CIS contractor registration", ""];
  for (const n of needs(c)) lines.push(`${n.label}: ${n.value || "(missing)"}`);
  lines.push(`First payment to a subcontractor expected: ${firstPayment ? fmt(firstPayment) : "(not set)"}`, "", "Agent");
  for (const n of agentNeeds(firm)) if (n.value) lines.push(`${n.label}: ${n.value}`);
  return lines.join("\n");
}

export const isIsoDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
