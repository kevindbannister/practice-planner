// The planner's side of sending an FPS or EPS: it asks the planner's server (api/rti), which holds the agent's Government Gateway
// sign-in and talks to HMRC. The browser never sees the sign-in.
export type RtiResult = { state: "accepted" | "rejected" | "pending"; correlationId?: string; pollUrl?: string; irmark?: string; receipt?: string; errors?: { number: string; text: string; location?: string }[]; live?: boolean; response?: string };
export class RtiError extends Error { constructor(public code: string, message: string) { super(message); } }

export interface RtiClient {
  info(): Promise<{ configured: boolean; live: boolean; missing: string[] }>;
  send(kind: "FPS" | "EPS", officeNo: string, payeRef: string, body: string): Promise<RtiResult>;
  poll(kind: "FPS" | "EPS", correlationId: string, pollUrl: string): Promise<RtiResult>;
}

export class HttpRti implements RtiClient {
  constructor(private token: () => Promise<string>) {}
  private async call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try { res = await fetch(`/api/rti/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "X-PP-Token": await this.token(), "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new RtiError("unreachable", "Couldn't reach the app's server. Check your internet connection."); }
    let out: any = null;
    try { out = await res.json(); } catch { /* not deployed */ }
    if (res.ok && out) return out as T;
    if (!out || !out.error) throw new RtiError("no-bridge", "HMRC filing isn't on the server yet. It arrives with the next deployment.");
    throw new RtiError(out.error, out.message || "Sending to HMRC failed.");
  }
  info() { return this.call<{ configured: boolean; live: boolean; missing: string[] }>("info"); }
  send(kind: "FPS" | "EPS", officeNo: string, payeRef: string, body: string) { return this.call<RtiResult>("send", { kind, officeNo, payeRef, body }); }
  poll(kind: "FPS" | "EPS", correlationId: string, pollUrl: string) { return this.call<RtiResult>("poll", { kind, correlationId, pollUrl }); }
}

/** The demo build: accepts everything, as HMRC's test service would for a valid submission. */
export class FakeRti implements RtiClient {
  private n = 0;
  async info() { return { configured: true, live: false, missing: [] }; }
  async send(): Promise<RtiResult> { this.n++; return { state: "accepted", correlationId: `DEMO${String(this.n).padStart(8, "0")}`, irmark: "demo", receipt: "Demo: HMRC's test service would answer here.", live: false }; }
  async poll(_k: string, correlationId: string): Promise<RtiResult> { return { state: "accepted", correlationId, live: false }; }
}
