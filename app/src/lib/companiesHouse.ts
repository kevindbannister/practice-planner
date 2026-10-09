// Companies House checks: fetch each company's record (through the app's server-side
// bridge, which holds the API key), compare it with the planner, and turn differences into
// changes for you to review. Nothing here writes to SharePoint; the UI applies what you accept.
import { Client, Job, fmtDate } from "./domain";
import { Row } from "./schema";

// ------------------------------------------------------------------ talking to Companies House

export type ChErrorCode =
  | "not-configured" | "unauthorised" | "key-rejected" | "not-found" | "rate-limited" | "unreachable" | "no-bridge" | "upstream";

export class ChError extends Error {
  constructor(public code: ChErrorCode, message: string, public retryAfter = 0) {
    super(message);
  }
}

export interface ChApi {
  get(path: string): Promise<any>;
}

/** Calls /api/ch/<path> with the signed-in user's Microsoft token. */
export class HttpCh implements ChApi {
  constructor(private token: () => Promise<string>) {}

  async get(path: string): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/ch/${path}`, { headers: { "X-PP-Token": await this.token(), Accept: "application/json" } });
    } catch {
      throw new ChError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON: the bridge isn't deployed */
    }
    if (res.ok && body) return body;
    if (!body || !body.error) {
      throw new ChError("no-bridge", "The Companies House connection isn't on the server yet. It arrives with the next deployment.");
    }
    throw new ChError(body.error, body.message || "Companies House check failed.", Number(res.headers.get("Retry-After")) || 0);
  }
}

// The parts of Companies House's records the checks use.
export type ChProfile = {
  company_name?: string;
  company_number?: string;
  company_status?: string;
  company_status_detail?: string;
  registered_office_address?: Record<string, string | undefined>;
  accounts?: {
    next_due?: string;
    next_made_up_to?: string;
    overdue?: boolean;
    last_accounts?: { made_up_to?: string };
    next_accounts?: { due_on?: string; period_end_on?: string; overdue?: boolean };
  };
  confirmation_statement?: { next_due?: string; next_made_up_to?: string; last_made_up_to?: string; overdue?: boolean };
};
type ChPerson = { name?: string; officer_role?: string; kind?: string; resigned_on?: string; ceased_on?: string; ceased?: boolean };

/** Active officers or PSCs as "Name (role)", sorted, from a Companies House list. */
export function people(list: { items?: ChPerson[] } | null | undefined, kind: "officers" | "pscs"): string[] {
  const out = new Set<string>();
  for (const p of list?.items || []) {
    if (p.resigned_on || p.ceased_on || p.ceased) continue;
    const role = kind === "officers" ? p.officer_role || "officer" : pscKind(p.kind);
    out.add(`${personName(p.name || "")} (${role.replace(/-/g, " ")})`);
  }
  return [...out].sort();
}

function pscKind(kind?: string): string {
  if (!kind) return "PSC";
  if (kind.includes("individual")) return "PSC";
  if (kind.includes("corporate")) return "corporate PSC";
  if (kind.includes("legal-person")) return "legal person PSC";
  return "PSC";
}

/** "SMITH, Jane Anne" → "Jane Anne Smith". Company names are left as they are. */
export function personName(name: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(name.trim());
  if (!m) return name.trim();
  const surname = m[1].toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  return `${m[2].trim()} ${surname}`;
}

export function chAddress(a?: Record<string, string | undefined>): string {
  if (!a) return "";
  const first = [a.premises, a.address_line_1].filter(Boolean).join(" ");
  return [first, a.address_line_2, a.locality, a.region, a.postal_code, a.country].filter((x) => x && x.trim()).join(", ");
}

const COUNTRY_WORDS = new Set(["england", "wales", "scotland", "northern", "ireland", "united", "kingdom", "uk", "gb", "great", "britain"]);

/** Addresses are the same if they use the same words and numbers, ignoring order, commas and country. */
export function sameAddress(a: string, b: string): boolean {
  const words = (s: string) =>
    [...new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !COUNTRY_WORDS.has(w)))].sort().join(" ");
  return words(a) === words(b);
}

/** Company names are the same ignoring case, punctuation, "Limited" vs "Ltd" and "&" vs "and". */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/&/g, " and ").replace(/\blimited\b/g, "ltd").replace(/\bpublic limited company\b/g, "plc")
      .replace(/\blimited liability partnership\b/g, "llp").replace(/[^a-z0-9]+/g, "");
  return norm(a) === norm(b);
}

export function statusText(p: ChProfile): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
  const base = p.company_status ? cap(p.company_status) : "Unknown";
  return p.company_status_detail ? `${base}, ${p.company_status_detail.replace(/-/g, " ").replace(/^active /, "")}` : base;
}

// ------------------------------------------------------------------ comparing

export type FlagType =
  | "filed" | "dates" | "missing" | "not-filed" | "overdue" | "status" | "office" | "name" | "officers" | "pscs" | "not-found";

/** What Apply does, stored with the flag. Info-only flags have no action. */
export type FlagAction =
  | { do: "complete"; jobKey: string; next?: { PeriodEnd: string; Deadline: string } }
  | { do: "dates"; jobKey: string; PeriodEnd: string; Deadline: string }
  | { do: "create"; serviceKey: string; PeriodEnd: string; Deadline: string }
  | { do: "client"; patch: Record<string, string> }
  | { do: "none"; seen: string };

export type Proposal = {
  key: string;
  type: FlagType;
  clientKey: string;
  jobKey?: string;
  severity: "red" | "amber" | "info";
  title: string;
  detail: string;
  current: string;
  action: FlagAction;
};

/** Changes that are events (people appointed or leaving) stay until you've seen them. */
export const EVENT_TYPES: FlagType[] = ["officers", "pscs"];

const FILINGS = [
  { kind: "accounts" as const, label: "Accounts", services: ["ACCS_LTD", "ACCS_LLP"] },
  { kind: "cs01" as const, label: "Confirmation statement", services: ["CS01"] },
];

export const accountsServiceFor = (c: Client) => (c.Kind === "LLP" || /^(OC|SO|NC)/i.test(c.CompanyNumber || "") ? "ACCS_LLP" : "ACCS_LTD");

export type CompareInput = {
  client: Client;
  profile: ChProfile | null; // null: Companies House has no such company
  jobs: Job[]; // the client's open jobs
  officers?: string[] | null;
  pscs?: string[] | null;
  before?: { officers?: string[]; pscs?: string[] }; // what was seen last time, if anything
};

const d = (iso?: string) => (iso ? fmtDate(iso) : "not set");

export function compareCompany({ client, profile, jobs, officers, pscs, before }: CompareInput): Proposal[] {
  const ck = client.Key;
  const out: Proposal[] = [];
  if (!profile) {
    out.push({
      key: `${ck}|not-found`, type: "not-found", clientKey: ck, severity: "amber",
      title: "Company number not found",
      detail: `Companies House has no company ${client.CompanyNumber}. Check the number on the client's record.`,
      current: client.CompanyNumber || "", action: { do: "none", seen: client.CompanyNumber || "" },
    });
    return out;
  }

  const status = statusText(profile);
  const live = profile.company_status === "active" || !profile.company_status;
  if (!live || profile.company_status_detail) {
    out.push({
      key: `${ck}|status`, type: "status", clientKey: ck, severity: "red",
      title: `Status: ${status}`,
      detail: `Companies House shows this company as ${status.toLowerCase()}.`,
      current: (client.CHStatus as string) || "Active", action: { do: "none", seen: status },
    });
  }

  if (live) {
    for (const f of FILINGS) {
      const ch = f.kind === "accounts"
        ? {
          last: profile.accounts?.last_accounts?.made_up_to,
          nextPe: profile.accounts?.next_made_up_to || profile.accounts?.next_accounts?.period_end_on,
          nextDue: profile.accounts?.next_due || profile.accounts?.next_accounts?.due_on,
          overdue: !!(profile.accounts?.overdue || profile.accounts?.next_accounts?.overdue),
        }
        : {
          last: profile.confirmation_statement?.last_made_up_to,
          nextPe: profile.confirmation_statement?.next_made_up_to,
          nextDue: profile.confirmation_statement?.next_due,
          overdue: !!profile.confirmation_statement?.overdue,
        };
      out.push(...compareFiling(client, f, ch, jobs));
    }
  }

  const office = chAddress(profile.registered_office_address);
  const ours = (client.RegisteredOffice as string) || "";
  if (office && !sameAddress(office, ours)) {
    out.push({
      key: `${ck}|office`, type: "office", clientKey: ck, severity: "info",
      title: ours ? "Registered office has changed" : "Registered office missing",
      detail: `Companies House: ${office}`, current: ours || "Not recorded",
      action: { do: "client", patch: { RegisteredOffice: office } },
    });
  }

  if (profile.company_name && !sameName(profile.company_name, client.Title)) {
    const name = tidyName(profile.company_name);
    out.push({
      key: `${ck}|name`, type: "name", clientKey: ck, severity: "info",
      title: "Name differs from Companies House",
      detail: `Companies House: ${profile.company_name}. Apply renames the client to "${name}".`,
      current: client.Title, action: { do: "client", patch: { Title: name } },
    });
  }

  for (const [type, now, was, label] of [
    ["officers", officers, before?.officers, "Directors and officers"],
    ["pscs", pscs, before?.pscs, "People with significant control"],
  ] as const) {
    if (!now || !was) continue; // nothing to compare with the first time
    const joined = now.filter((p) => !was.includes(p));
    const left = was.filter((p) => !now.includes(p));
    if (!joined.length && !left.length) continue;
    const parts = [joined.length ? `Added: ${joined.join("; ")}` : "", left.length ? `No longer listed: ${left.join("; ")}` : ""];
    out.push({
      key: `${ck}|${type}`, type, clientKey: ck, severity: "info",
      title: `${label} changed`, detail: parts.filter(Boolean).join(". ") + ".",
      current: was.join("; ") || "None", action: { do: "none", seen: now.join("; ") },
    });
  }
  return out;
}

/** "ACME HOLDINGS LIMITED" → "Acme Holdings Limited"; mixed-case names are kept. */
export function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s(&/-])\p{L}/gu, (c) => c.toUpperCase()).replace(/\b(Llp|Plc|Cic|Uk)\b/g, (w) => w.toUpperCase());
}

type FilingDates = { last?: string; nextPe?: string; nextDue?: string; overdue: boolean };

function compareFiling(client: Client, f: (typeof FILINGS)[number], ch: FilingDates, jobs: Job[]): Proposal[] {
  const ck = client.Key;
  const out: Proposal[] = [];
  const open = jobs
    .filter((j) => f.services.includes(j.ServiceKey || ""))
    .sort((a, b) => (a.PeriodEnd || "9999").localeCompare(b.PeriodEnd || "9999"));
  const filed = ch.last ? open.filter((j) => j.PeriodEnd && j.PeriodEnd <= ch.last!) : [];
  const rest = open.filter((j) => !filed.includes(j));
  const what = f.kind === "accounts" ? "accounts" : "confirmation statement";

  filed.forEach((j, i) => {
    const last = i === filed.length - 1;
    const next = last && !rest.length && ch.nextPe && ch.nextDue ? { PeriodEnd: ch.nextPe, Deadline: ch.nextDue } : undefined;
    out.push({
      key: `${ck}|filed|${j.Key}`, type: "filed", clientKey: ck, jobKey: j.Key, severity: "amber",
      title: `${f.label} filed for ${f.kind === "accounts" ? "period to" : "made up to"} ${d(j.PeriodEnd)}`,
      detail: `Companies House has ${what} made up to ${d(ch.last)}, but the job is still open.` +
        (next ? ` Apply marks it complete and sets up the next one: ${f.kind === "accounts" ? "period to" : "made up to"} ${d(next.PeriodEnd)}, due ${d(next.Deadline)}.` : " Apply marks it complete."),
      current: `Open, at stage ${j.StageNo || 1}`, action: { do: "complete", jobKey: j.Key, next },
    });
  });

  const current = rest[0];
  if (!current) {
    if (!filed.length && ch.nextPe && ch.nextDue) {
      const serviceKey = f.kind === "accounts" ? accountsServiceFor(client) : "CS01";
      out.push({
        key: `${ck}|missing|${f.kind}`, type: "missing", clientKey: ck, severity: "amber",
        title: `No ${what} job in the planner`,
        detail: `Companies House expects ${what} ${f.kind === "accounts" ? "for the period to" : "made up to"} ${d(ch.nextPe)}, due ${d(ch.nextDue)}. Apply adds the job.`,
        current: "No open job", action: { do: "create", serviceKey, PeriodEnd: ch.nextPe, Deadline: ch.nextDue },
      });
    }
  } else if (ch.nextPe && ch.nextDue) {
    if (current.PeriodEnd && current.PeriodEnd > ch.nextPe) {
      out.push({
        key: `${ck}|not-filed|${f.kind}`, type: "not-filed", clientKey: ck, jobKey: current.Key, severity: "red",
        title: `${f.label} not filed yet at Companies House`,
        detail: `The planner has moved on to ${d(current.PeriodEnd)}, but Companies House is still waiting for ${what} ${f.kind === "accounts" ? "for the period to" : "made up to"} ${d(ch.nextPe)}, due ${d(ch.nextDue)}.`,
        current: `Next job: ${d(current.PeriodEnd)}`, action: { do: "none", seen: `${ch.nextPe}|${ch.nextDue}` },
      });
    } else if (current.PeriodEnd !== ch.nextPe || current.Deadline !== ch.nextDue) {
      const changes = [
        current.PeriodEnd !== ch.nextPe ? `${f.kind === "accounts" ? "period end" : "made-up date"} ${d(current.PeriodEnd)} → ${d(ch.nextPe)}` : "",
        current.Deadline !== ch.nextDue ? `deadline ${d(current.Deadline)} → ${d(ch.nextDue)}` : "",
      ].filter(Boolean);
      out.push({
        key: `${ck}|dates|${current.Key}`, type: "dates", clientKey: ck, jobKey: current.Key, severity: "amber",
        title: `${f.label} dates differ from Companies House`,
        detail: `Companies House: ${changes.join(", ")}.`,
        current: `Period ${d(current.PeriodEnd)}, due ${d(current.Deadline)}`,
        action: { do: "dates", jobKey: current.Key, PeriodEnd: ch.nextPe, Deadline: ch.nextDue },
      });
    }
  }

  if (ch.overdue) {
    out.push({
      key: `${ck}|overdue|${f.kind}`, type: "overdue", clientKey: ck, severity: "red",
      title: `${f.label} overdue at Companies House`,
      detail: `Companies House shows the ${what} as overdue${ch.nextDue ? ` (due ${d(ch.nextDue)})` : ""}.`,
      current: "", action: { do: "none", seen: ch.nextDue || "overdue" },
    });
  }
  return out;
}

/**
 * Companies House's deadline for open jobs whose period matches its next filing, where the
 * job's CHDeadline doesn't already say so. Kept on the job for reference; changes nothing else.
 */
export function chDeadlines(profile: ChProfile | null, jobs: Job[]): { job: Job; CHDeadline: string }[] {
  if (!profile) return [];
  const out: { job: Job; CHDeadline: string }[] = [];
  const pairs: [string[], string | undefined, string | undefined][] = [
    [["ACCS_LTD", "ACCS_LLP"], profile.accounts?.next_made_up_to, profile.accounts?.next_due],
    [["CS01"], profile.confirmation_statement?.next_made_up_to, profile.confirmation_statement?.next_due],
  ];
  for (const [services, pe, due] of pairs) {
    if (!pe || !due) continue;
    for (const j of jobs) {
      if (services.includes(j.ServiceKey || "") && j.PeriodEnd === pe && j.CHDeadline !== due) out.push({ job: j, CHDeadline: due });
    }
  }
  return out;
}

// ------------------------------------------------------------------ keeping the change list

export type FlagWrites = { create: Row[]; update: { row: Row; patch: Row }[] };

const signature = (p: Proposal) => JSON.stringify(p.action);

/**
 * Turn this run's findings into list changes. New findings are added; ones you ignored or
 * applied stay that way unless Companies House's values change; open ones that no longer
 * apply are marked Resolved. Only companies checked in this run are touched.
 */
export function reconcile(found: Proposal[], flags: Row[], checkedClients: Set<string>, today: string): FlagWrites {
  const writes: FlagWrites = { create: [], update: [] };
  const byKey = new Map(flags.map((f) => [f.Key as string, f]));
  const seen = new Set<string>();
  for (const p of found) {
    seen.add(p.key);
    const fields: Row = {
      Title: p.title, ClientKey: p.clientKey, JobKey: p.jobKey || "", Type: p.type, Severity: p.severity,
      Detail: p.detail, Current: p.current, Proposed: signature(p),
    };
    const existing = byKey.get(p.key);
    if (!existing) {
      writes.create.push({ Key: p.key, ...fields, Status: "Open", Found: today });
      continue;
    }
    const same = existing.Proposed === fields.Proposed;
    if (existing.Status === "Open") {
      if (!same || existing.Detail !== fields.Detail || existing.Title !== fields.Title) writes.update.push({ row: existing, patch: fields });
    } else if (!same || existing.Status === "Resolved") {
      writes.update.push({ row: existing, patch: { ...fields, Status: "Open", Found: today, Resolved: "" } });
    }
  }
  for (const f of flags) {
    if (f.Status !== "Open" || seen.has(f.Key as string) || !checkedClients.has(f.ClientKey as string)) continue;
    if (EVENT_TYPES.includes(f.Type as FlagType)) continue;
    writes.update.push({ row: f, patch: { Status: "Resolved", Resolved: today } });
  }
  return writes;
}

export function flagAction(f: Row): FlagAction {
  try {
    return JSON.parse(String(f.Proposed || "")) as FlagAction;
  } catch {
    return { do: "none", seen: "" };
  }
}

/** The company number as Companies House writes it: 8 characters, leading zeros kept. */
export function chNumber(c: Client): string {
  const n = String(c.CompanyNumber || "").replace(/\s+/g, "").toUpperCase();
  return /^\d{1,7}$/.test(n) ? n.padStart(8, "0") : n;
}

export const isCompany = (c: Client) => /^[A-Z0-9]{8}$/.test(chNumber(c)) && !/archiv|former|ceased/i.test(String(c.Status || ""));
