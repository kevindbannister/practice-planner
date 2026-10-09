// A small Microsoft Graph client: authenticated requests, paging, $batch, and
// polite retries when SharePoint throttles (429/503/504 with Retry-After).
import { GRAPH } from "../config";

export class GraphError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export type BatchRequest = { method: "GET" | "POST" | "PATCH" | "DELETE"; url: string; body?: unknown };
export type BatchResponse = { status: number; body?: any };

export interface Graph {
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body: unknown): Promise<T>;
  patch<T = any>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  /** Upload a file's bytes (PUT), e.g. to OneDrive. */
  put<T = any>(path: string, data: Uint8Array, contentType: string): Promise<T>;
  getAll<T = any>(path: string): Promise<T[]>;
  batch(requests: BatchRequest[], onProgress?: (done: number) => void): Promise<BatchResponse[]>;
}

const RETRYABLE = new Set([429, 503, 504]);
const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 20;

export function retryDelay(retryAfter: string | null | undefined, attempt: number): number {
  const secs = Number(retryAfter);
  if (retryAfter && !Number.isNaN(secs)) return Math.min(secs, 120) * 1000;
  return Math.min(1000 * 2 ** attempt, 30000);
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class HttpGraph implements Graph {
  constructor(
    private token: () => Promise<string>,
    private fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async request(method: string, path: string, body?: unknown, attempt = 0, raw?: { data: Uint8Array; type: string }): Promise<any> {
    const url = path.startsWith("https://") ? path : GRAPH + path;
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}` };
    if (raw) headers["Content-Type"] = raw.type;
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: raw ? (raw.data as unknown as BodyInit) : body === undefined ? undefined : JSON.stringify(body),
    });
    if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
      await this.sleep(retryDelay(res.headers.get("Retry-After"), attempt));
      return this.request(method, path, body, attempt + 1, raw);
    }
    if (res.status === 204) return undefined;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new GraphError(res.status, json?.error?.message || res.statusText, json?.error?.code);
    return json;
  }

  get<T = any>(path: string): Promise<T> {
    return this.request("GET", path);
  }
  post<T = any>(path: string, body: unknown): Promise<T> {
    return this.request("POST", path, body);
  }
  patch<T = any>(path: string, body: unknown): Promise<T> {
    return this.request("PATCH", path, body);
  }
  async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }
  put<T = any>(path: string, data: Uint8Array, contentType: string): Promise<T> {
    return this.request("PUT", path, undefined, 0, { data, type: contentType });
  }

  async getAll<T = any>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: any = await this.get(next);
      out.push(...(page.value || []));
      next = page["@odata.nextLink"];
    }
    return out;
  }

  async batch(requests: BatchRequest[], onProgress?: (done: number) => void): Promise<BatchResponse[]> {
    const results: BatchResponse[] = new Array(requests.length);
    let pending = requests.map((r, i) => ({ ...r, id: String(i) }));
    let done = 0;
    for (let attempt = 0; pending.length; attempt++) {
      const retry: typeof pending = [];
      let wait = 0;
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const chunk = pending.slice(i, i + BATCH_SIZE);
        const res = await this.post<{ responses: { id: string; status: number; headers?: any; body?: any }[] }>(
          "/$batch",
          {
            requests: chunk.map((r) => ({
              id: r.id,
              method: r.method,
              url: r.url,
              ...(r.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: r.body } : {}),
            })),
          },
        );
        for (const r of res.responses) {
          if (RETRYABLE.has(r.status) && attempt < MAX_ATTEMPTS) {
            retry.push(pending.find((p) => p.id === r.id)!);
            wait = Math.max(wait, retryDelay(r.headers?.["Retry-After"], attempt));
          } else {
            results[Number(r.id)] = { status: r.status, body: r.body };
            done++;
          }
        }
        onProgress?.(done);
      }
      if (retry.length) await this.sleep(wait);
      pending = retry;
    }
    return results;
  }
}
