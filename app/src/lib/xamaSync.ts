// Reading AML results from Xama into the clients. Xama calls a client an "account", and the
// current AML result is its latest COMPLETED risk assessment (an approved one). Pure logic here;
// the Settings › Xama page drives it.
import { Client } from "./domain";
import { XamaApi, XamaConfig } from "./xama";

export type Assessment = { id?: string; status?: string; risk_level?: string; completed_at?: string; created_at?: string; updated_at?: string };
export type Summary = { status: string; review: string }; // review: date the approved assessment was completed

const RISK: Record<string, string> = { LOW: "low risk", NORMAL: "normal risk", HIGH: "high risk", VERY_HIGH: "very high risk" };

/** The words shown on the client for what Xama holds. Wording matters: see amlLabel in domain.ts. */
export function summarise(items: Assessment[], today: string, staleMonths: number): Summary {
  const done = items
    .filter((a) => String(a.status || "").toUpperCase() === "COMPLETED")
    .sort((a, b) => String(b.completed_at || b.updated_at || "").localeCompare(String(a.completed_at || a.updated_at || "")));
  if (done.length) {
    const a = done[0];
    const level = RISK[String(a.risk_level || "").toUpperCase()] || "risk level not stated";
    const when = String(a.completed_at || a.updated_at || "").slice(0, 10);
    const stale = when && staleMonths > 0 && addMonths(when, staleMonths) <= today;
    return { status: stale ? `Review due: ${level}` : `Approved: ${level}`, review: when };
  }
  const states = items.map((a) => String(a.status || "").toUpperCase());
  if (states.includes("IN_REVIEW")) return { status: "In review", review: "" };
  if (states.includes("IN_PROGRESS")) return { status: "In progress", review: "" };
  return { status: "No assessment", review: "" };
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "9999-12-31";
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** A name with the usual differences removed, so "A & B Limited" matches "A and B Ltd". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bpartnership\b/g, "llp")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Candidate = { id: string; name: string; type?: string; status?: string };
export type Row = {
  client: Client;
  xamaId?: string; // the Xama account this client is linked to (now, or already)
  newlyLinked?: boolean;
  summary?: Summary;
  candidates?: Candidate[]; // when no single match was found
  error?: string;
  changed: boolean;
};

const SKIP = new Set(["ceased", "former", "archived", "inactive", "lost", "dormant"]);
export const isCurrent = (c: Client) => !SKIP.has(String(c.Status || "").toLowerCase());

/** Xama's address for an account, to open it there. */
export const xamaLink = (id: string) => `https://platform.xamatech.com/portal/hub/clients/${encodeURIComponent(id)}`;

async function assessments(api: XamaApi, firm: string, id: string): Promise<Assessment[]> {
  const out: Assessment[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await api.get(`clients/${encodeURIComponent(firm)}/accounts/${encodeURIComponent(id)}/risk-assessments`, page > 1 ? { page } : undefined);
    const items: Assessment[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
    out.push(...items);
    if (!r || Array.isArray(r) || !(Number(r.result_size) > out.length) || !items.length) break;
  }
  return out;
}

async function search(api: XamaApi, firm: string, name: string): Promise<Candidate[]> {
  const r = await api.get(`clients/${encodeURIComponent(firm)}/search`, { query: name, q: name });
  const items: any[] = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  return items
    .filter((x) => String(x.entity || "XAMA_HUB_ACCOUNT").toUpperCase() === "XAMA_HUB_ACCOUNT")
    .map((x) => ({ id: String(x.id ?? x.account_id ?? ""), name: String(x.name ?? x.account_name ?? ""), type: x.type ?? x.account_type, status: x.status ?? x.account_status }))
    .filter((x) => x.id);
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : "Xama didn't answer.";
}

/** Reads one client: uses the linked Xama account, or finds it by name when exactly one account matches. */
export async function readClient(api: XamaApi, cfg: XamaConfig, client: Client, today: string, chosen?: string): Promise<Row> {
  const current = { status: String(client.XamaStatus || ""), review: String(client.AMLReview || "") };
  const row: Row = { client, changed: false };
  try {
    let id = chosen || String(client.XamaId || "").trim();
    if (id) {
      row.newlyLinked = !!chosen && chosen !== String(client.XamaId || "");
    } else {
      const found = await search(api, cfg.firmId, client.Title);
      const same = found.filter((x) => normName(x.name) === normName(client.Title));
      if (same.length === 1) { id = same[0].id; row.newlyLinked = true; }
      else { row.candidates = (same.length ? same : found).slice(0, 8); }
    }
    if (!id) return row;
    row.xamaId = id;
    row.summary = summarise(await assessments(api, cfg.firmId, id), today, cfg.staleMonths);
    row.changed = row.newlyLinked === true || row.summary.status !== current.status || row.summary.review !== current.review;
  } catch (e) {
    row.error = describe(e);
  }
  return row;
}

/** Reads every current client, three at a time so Xama isn't hammered. */
export async function readAll(api: XamaApi, cfg: XamaConfig, clients: Client[], today: string, onRow?: (done: number, total: number) => void): Promise<Row[]> {
  const list = clients.filter(isCurrent);
  const rows: Row[] = new Array(list.length);
  let next = 0, done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      rows[i] = await readClient(api, cfg, list[i], today);
      onRow?.(++done, list.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return rows;
}

/** What to write onto a client row. */
export function patchFor(r: Row): Record<string, string> | null {
  if (!r.xamaId || !r.summary || !r.changed) return null;
  return { XamaId: r.xamaId, XamaStatus: r.summary.status, AMLReview: r.summary.review };
}
