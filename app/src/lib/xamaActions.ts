// Doing things in Xama from a client's page: create the client there, ask them to verify their
// identity, run the AML check, and see how each is going. Xama calls a client an "account".
// These are the only writes the server allows (api/xama).
import { Client } from "./domain";
import { XamaApi, XamaConfig, XamaError } from "./xama";

export type NewAccount = {
  name: string; type: "COMPANY" | "INDIVIDUAL"; regNumber: string;
  firstName: string; lastName: string; email: string; phone: string; dob: string;
  street: string; postcode: string; city: string;
};

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

/** What we already know, laid out the way Xama wants it. The person fills in anything missing. */
export function draftAccount(c: Client): NewAccount {
  const individual = String(c.Kind || "").toLowerCase() === "individual";
  const parts = c.Title.trim().split(/\s+/);
  const lines = String(individual ? c.HomeAddress || "" : c.RegisteredOffice || c.TradingAddress || "").split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean);
  const pc = lines.map((l) => POSTCODE.exec(l)?.[1]).find(Boolean) || "";
  const rest = lines.filter((l) => !POSTCODE.test(l) || l.replace(POSTCODE, "").trim());
  const first = String(c.ContactPreferred || c.ContactFirst || "") || (individual ? parts[0] || "" : "");
  const last = String(c.ContactLast || "") || (individual && parts.length > 1 ? parts[parts.length - 1] : "");
  return {
    name: c.Title.trim(),
    type: individual ? "INDIVIDUAL" : "COMPANY",
    regNumber: individual ? "" : String(c.CompanyNumber || ""),
    firstName: String(c.ContactFirst || first),
    lastName: last,
    email: String(c.Email || ""),
    phone: String(c.Mobile || c.Phone || ""),
    dob: /^\d{4}-\d{2}-\d{2}/.test(String(c.DateOfBirth || "")) ? String(c.DateOfBirth).slice(0, 10) : "",
    street: rest[0] || "",
    city: rest.length > 1 ? rest[rest.length - 1] : "",
    postcode: pc.toUpperCase(),
  };
}

/** What Xama insists on before it will create a client. */
export function missingForCreate(a: NewAccount): string[] {
  const m: string[] = [];
  if (!a.name.trim()) m.push("name");
  if (!a.firstName.trim()) m.push("first name");
  if (!a.lastName.trim()) m.push("last name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) m.push("email");
  return m;
}

/** What Xama needs before an AML check can run (it will say so itself if not). */
export function missingForAml(a: NewAccount): string[] {
  const m: string[] = [];
  if (!a.dob) m.push("date of birth");
  if (!a.street.trim() || !a.postcode.trim()) m.push("address");
  return m;
}

export function accountBody(a: NewAccount, clientKey: string): Record<string, unknown> {
  const contact: Record<string, unknown> = { first_name: a.firstName.trim(), last_name: a.lastName.trim(), email: a.email.trim() };
  if (a.phone.trim()) contact.phone = a.phone.trim();
  if (a.dob) contact.date_of_birth = a.dob;
  if (a.street.trim() || a.postcode.trim()) contact.primary_address = { street: a.street.trim(), postcode: a.postcode.trim(), city: a.city.trim(), country_code: "GB", type: "PRIMARY" };
  const body: Record<string, unknown> = { name: a.name.trim(), type: a.type, metadata: { external_reference: clientKey }, primary_contact: contact };
  if (a.type === "COMPANY" && a.regNumber.trim()) body.reg_number = a.regNumber.trim();
  return body;
}

const base = (cfg: XamaConfig) => `clients/${encodeURIComponent(cfg.firmId.trim())}`;
const idOf = (r: any): string => String(r?.id ?? r?.account_id ?? r?.data?.id ?? "");

/** Creates the client in Xama and returns its Xama ID. */
export async function createAccount(api: XamaApi, cfg: XamaConfig, a: NewAccount, clientKey: string): Promise<string> {
  const missing = missingForCreate(a);
  if (missing.length) throw new XamaError("incomplete", `Xama needs the ${missing.join(", ")}.`);
  const id = idOf(await api.write("POST", `${base(cfg)}/accounts`, accountBody(a, clientKey)));
  if (!id) throw new XamaError("no-id", "Xama created the client but didn't say what its ID is. Press Read from Xama in Settings › Xama to link it.");
  return id;
}

/** The person Xama checks for this client: its primary contact. */
export async function contactOf(api: XamaApi, cfg: XamaConfig, accountId: string): Promise<string> {
  const r = await api.get(`${base(cfg)}/accounts/${encodeURIComponent(accountId)}/contacts`);
  const items: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  const c = items.find((x) => String(x.type || "").toUpperCase() === "PRIMARY") || items[0];
  const id = String(c?.id ?? c?.contact_id ?? "");
  if (!id) throw new XamaError("no-contact", "Xama has no contact on this client to check. Add one in Xama first.");
  return id;
}

export type IdOptions = { levels: { id: string; name: string; isDefault: boolean }[]; templates: { id: string; name: string; isDefault: boolean }[] };

/** The ID-check levels and email wordings this Xama account offers. */
export async function idOptions(api: XamaApi, cfg: XamaConfig): Promise<IdOptions> {
  const list = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : []);
  const [levels, templates] = await Promise.all([
    api.get(`${base(cfg)}/onboarding-levels`),
    api.get(`${base(cfg)}/mail-templates`, { "q:type": "ONBOARDING", "q:status": "ACTIVE" }).catch(() => []),
  ]);
  const map = (x: any) => ({ id: String(x.id), name: String(x.name || x.id), isDefault: !!x.is_default });
  return { levels: list(levels).map(map), templates: list(templates).map(map) };
}

/** Asks the client to verify their identity: Xama emails them the link. */
export async function askForIdCheck(api: XamaApi, cfg: XamaConfig, accountId: string, opt: { level: string; template?: string }): Promise<void> {
  if (!opt.level) throw new XamaError("no-level", "Choose which ID check to ask for.");
  const contact = await contactOf(api, cfg, accountId);
  const parameters: Record<string, string> = { level: opt.level, suppress_invitation_mail: "false" };
  if (opt.template) parameters.mail_template_id = opt.template;
  await api.write("PUT", `${base(cfg)}/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contact)}/reports/onboarding`, { config: { parameters, ttl_in_days: 365, is_reminder_enabled: true } });
}

/** Runs the AML check (identity, PEP and sanctions) on the client's primary contact. */
export async function runAmlCheck(api: XamaApi, cfg: XamaConfig, accountId: string): Promise<void> {
  const contact = await contactOf(api, cfg, accountId);
  await api.write("PUT", `${base(cfg)}/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contact)}/reports/aml`, { config: { ttl_in_days: 365, is_automatic_refresh_enabled: false } });
}

export type Progress = {
  id: { status: string; document?: string; face?: string } | null; // the ID verification request
  aml: { status: string; decision?: string; pep?: number; sanctions?: number } | null;
};

async function report(api: XamaApi, path: string): Promise<any | null> {
  try {
    return await api.get(path);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 404 || /HTTP 404|couldn't find|doesn't have that path/i.test(err.message || "")) return null;
    throw e;
  }
}

/** How the ID verification and the AML check are going for this client. */
export async function progress(api: XamaApi, cfg: XamaConfig, accountId: string): Promise<Progress> {
  const contact = await contactOf(api, cfg, accountId);
  const root = `${base(cfg)}/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contact)}/reports`;
  const [o, a] = await Promise.all([report(api, `${root}/onboarding`), report(api, `${root}/aml`)]);
  const arr = (x: unknown) => (Array.isArray(x) ? x.length : typeof x === "number" ? x : 0);
  return {
    id: o ? { status: String(o.status || ""), document: o.data?.idscan?.document_decision, face: o.data?.idscan?.face_match_decision } : null,
    aml: a ? { status: String(a.status || ""), decision: a.data?.decision, pep: arr(a.data?.pep_matches), sanctions: arr(a.data?.sanctions_matches) } : null,
  };
}

/** Plain words for Progress. */
export function progressText(p: Progress): { id: string; aml: string } {
  const id = !p.id ? "No ID check requested yet."
    : p.id.status === "INITIATED" ? "Asked: waiting for the client to complete it."
    : p.id.status === "READY" ? `Completed${p.id.document ? `: document ${p.id.document.toLowerCase()}` : ""}${p.id.face ? `, face match ${p.id.face.toLowerCase()}` : ""}.`
    : p.id.status === "CREDIT_BALANCE_EXCEEDED" ? "Not sent: your Xama credit has run out."
    : `Status: ${p.id.status.toLowerCase() || "unknown"}.`;
  const aml = !p.aml ? "No AML check run yet."
    : p.aml.status === "READY" ? `Completed: identity ${String(p.aml.decision || "not stated").toLowerCase()}; ${p.aml.pep ? `${p.aml.pep} possible PEP match${p.aml.pep === 1 ? "" : "es"}` : "no PEP matches"}; ${p.aml.sanctions ? `${p.aml.sanctions} possible sanctions match${p.aml.sanctions === 1 ? "" : "es"}` : "no sanctions matches"}.`
    : p.aml.status === "CREDIT_BALANCE_EXCEEDED" ? "Not run: your Xama credit has run out."
    : p.aml.status === "ERROR" ? "Xama couldn't complete it. Check the details in Xama."
    : "Running: this takes a few seconds.";
  return { id, aml };
}
