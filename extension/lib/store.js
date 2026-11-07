// Reads and writes the planner's SharePoint lists through Microsoft Graph, the same lists and columns the web app uses.
import { GRAPH, LISTS, SITE_HOST, SITE_PATH } from "../config.js";

export class GraphError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const RETRY = new Set([429, 503, 504]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Store {
  constructor(getToken, fetchImpl = (u, i) => fetch(u, i)) {
    this.getToken = getToken;
    this.fetch = fetchImpl;
    this.site = "";
    this.ids = {};
  }

  async request(method, path, body, attempt = 0) {
    const url = path.startsWith("https://") ? path : GRAPH + path;
    const res = await this.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await this.getToken()}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (RETRY.has(res.status) && attempt < 5) {
      const secs = Number(res.headers.get("Retry-After"));
      await wait(Number.isFinite(secs) && secs > 0 ? Math.min(secs, 60) * 1000 : Math.min(1000 * 2 ** attempt, 15000));
      return this.request(method, path, body, attempt + 1);
    }
    if (res.status === 204) return undefined;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new GraphError(res.status, json?.error?.message || `Microsoft 365 said ${res.status}`);
    return json;
  }

  async getAll(path) {
    const out = [];
    for (let next = path; next; ) {
      const page = await this.request("GET", next);
      out.push(...(page.value || []));
      next = page["@odata.nextLink"];
    }
    return out;
  }

  /** Find the site and the planner's lists. */
  async connect() {
    this.site = (await this.request("GET", `/sites/${SITE_HOST}:${SITE_PATH}`)).id;
    const lists = await this.getAll(`/sites/${this.site}/lists?$select=id,displayName`);
    for (const [key, name] of Object.entries(LISTS)) {
      const found = lists.find((l) => l.displayName === name);
      if (found) this.ids[key] = found.id;
    }
    return this;
  }

  has(key) { return !!this.ids[key]; }
  path(key) {
    if (!this.ids[key]) throw new GraphError(404, `The ${LISTS[key]} list isn't there. Open the planner and run its setup first.`);
    return `/sites/${this.site}/lists/${this.ids[key]}`;
  }

  /** Every row of a list, with just the columns asked for. */
  async readAll(key, fields) {
    const items = await this.getAll(`${this.path(key)}/items?$expand=fields($select=${["Title", ...fields].join(",")})&$top=200`);
    return items.map((i) => ({ _id: i.id, ...clean(i.fields || {}) }));
  }
  async readItem(key, id, fields) {
    const i = await this.request("GET", `${this.path(key)}/items/${id}?$expand=fields($select=${["Title", ...fields].join(",")})`);
    return { _id: i.id, ...clean(i.fields || {}) };
  }
  async create(key, row) {
    const fields = {};
    for (const [k, v] of Object.entries(row)) if (v !== "" && v !== undefined && v !== null && k !== "_id") fields[k] = v;
    const i = await this.request("POST", `${this.path(key)}/items`, { fields });
    return { _id: i.id, ...row };
  }
  /** Save changed fields. Empty text clears a value. */
  async update(key, id, patch) {
    const fields = {};
    for (const [k, v] of Object.entries(patch)) if (k !== "_id" && v !== undefined) fields[k] = v;
    await this.request("PATCH", `${this.path(key)}/items/${id}/fields`, fields);
  }
}

function clean(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (!k.startsWith("@") && !k.startsWith("odata") && v !== null && v !== undefined && v !== "") out[k] = v;
  return out;
}

export const FIELDS = {
  clients: ["Key", "TradingName", "Kind", "Status", "CompanyNumber", "Notes"],
  jobs: ["Key", "ClientKey", "ClientName", "ServiceKey", "PeriodEnd", "StageNo", "StageName", "Deadline", "InternalDeadline", "Status", "Priority", "Notes", "HoldReason", "HoldUntil", "HeldOn", "HoldKind", "RecordsExpected", "RecordsReceived", "EstimateHours", "PlannedDate"],
  services: ["Key"],
  time: ["Key", "JobKey", "ClientKey", "StageNo", "StageName", "Started", "Ended", "Hours", "Kind", "Note", "CreatedBy", "Created"],
};
