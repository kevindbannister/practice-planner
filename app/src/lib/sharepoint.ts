// Reads and writes the planner's SharePoint lists through Microsoft Graph, and creates
// the lists and any missing columns on first run.
import { SITE_HOST, SITE_PATH } from "../config";
import { Graph, GraphError } from "./graph";
import { LISTS, LIST_BY_KEY, ListDef, ListKey, Row, columnDefinition, fromFields, toFields } from "./schema";

export type SchemaStatus = { list: ListDef; exists: boolean; missingColumns: string[] };

export class SharePointStore {
  siteId = "";
  siteUrl = "";
  private listIds = new Map<ListKey, string>();

  constructor(private graph: Graph) {}

  async connect(): Promise<void> {
    const site = await this.graph.get(`/sites/${SITE_HOST}:${SITE_PATH}`);
    this.siteId = site.id;
    this.siteUrl = site.webUrl;
    await this.refreshListIds();
  }

  private async refreshListIds(): Promise<void> {
    const lists = await this.graph.getAll<{ id: string; displayName: string }>(
      `/sites/${this.siteId}/lists?$select=id,displayName`,
    );
    this.listIds.clear();
    for (const def of LISTS) {
      const found = lists.find((l) => l.displayName === def.displayName);
      if (found) this.listIds.set(def.key, found.id);
    }
  }

  private listPath(key: ListKey): string {
    const id = this.listIds.get(key);
    if (!id) throw new Error(`The ${LIST_BY_KEY[key].displayName} list doesn't exist yet. Run setup first.`);
    return `/sites/${this.siteId}/lists/${id}`;
  }

  /** Which lists and columns are missing. */
  async checkSchema(): Promise<SchemaStatus[]> {
    const out: SchemaStatus[] = [];
    for (const list of LISTS) {
      const id = this.listIds.get(list.key);
      if (!id) {
        out.push({ list, exists: false, missingColumns: list.columns.map((c) => c.name) });
        continue;
      }
      const cols = await this.graph.getAll<{ name: string }>(`/sites/${this.siteId}/lists/${id}/columns?$select=name`);
      const have = new Set(cols.map((c) => c.name));
      out.push({ list, exists: true, missingColumns: list.columns.filter((c) => !have.has(c.name)).map((c) => c.name) });
    }
    return out;
  }

  /** Create any missing lists and columns. Safe to run again. */
  async ensureSchema(onStep: (msg: string) => void = () => {}): Promise<void> {
    const status = await this.checkSchema();
    for (const s of status) {
      if (!s.exists) {
        onStep(`Creating ${s.list.displayName}`);
        const created = await this.graph.post(`/sites/${this.siteId}/lists`, {
          displayName: s.list.displayName,
          description: s.list.description,
          columns: s.list.columns.map(columnDefinition),
          list: { template: "genericList" },
        });
        this.listIds.set(s.list.key, created.id);
      } else if (s.missingColumns.length) {
        onStep(`Adding ${s.missingColumns.length} column(s) to ${s.list.displayName}`);
        for (const name of s.missingColumns) {
          const col = s.list.columns.find((c) => c.name === name)!;
          await this.graph.post(`${this.listPath(s.list.key)}/columns`, columnDefinition(col));
        }
      }
    }
    onStep("All lists ready");
  }

  async readAll(key: ListKey): Promise<Row[]> {
    const list = LIST_BY_KEY[key];
    const items = await this.graph.getAll<{ id: string; fields: Record<string, unknown> }>(
      `${this.listPath(key)}/items?$expand=fields&$top=200`,
    );
    return items.map((i) => fromFields(list, i.id, i.fields));
  }

  async create(key: ListKey, row: Row): Promise<Row> {
    const list = LIST_BY_KEY[key];
    const item = await this.graph.post(`${this.listPath(key)}/items`, { fields: toFields(list, row) });
    return fromFields(list, item.id, item.fields || {});
  }

  /** Save changed fields straight away. Empty strings clear a value. */
  async update(key: ListKey, itemId: string, patch: Row): Promise<void> {
    const list = LIST_BY_KEY[key];
    const fields: Record<string, unknown> = toFields(list, patch);
    for (const [k, v] of Object.entries(patch)) {
      if (v !== "" || k === "_id") continue;
      const col = list.columns.find((c) => c.name === k);
      if (k === "Title" || col) fields[k] = col?.type === "number" ? null : "";
    }
    await this.graph.patch(`${this.listPath(key)}/items/${itemId}/fields`, fields);
  }

  /** Create many rows in batches. Returns how many failed, with the first error. */
  async createMany(key: ListKey, rows: Row[], onProgress?: (done: number) => void): Promise<{ failed: number; error?: string }> {
    const list = LIST_BY_KEY[key];
    const path = this.listPath(key);
    const res = await this.graph.batch(
      rows.map((r) => ({ method: "POST" as const, url: `${path}/items`, body: { fields: toFields(list, r) } })),
      onProgress,
    );
    const bad = res.filter((r) => !r || r.status >= 300);
    return { failed: bad.length, error: bad[0]?.body?.error?.message };
  }

  hasList(key: ListKey): boolean {
    return this.listIds.has(key);
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.status === 401) return "Your sign-in has expired. Reload the page to sign in again.";
    if (e.status === 403) return "Microsoft 365 refused access. Check the app's permissions have admin consent.";
    if (e.status === 404) return "The Practice Planner SharePoint site couldn't be found.";
    return `SharePoint said: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
