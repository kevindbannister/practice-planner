// The planner's side of sending a filing to Companies House. The browser never talks to Companies House and never holds the
// presenter details: it asks the planner's server (api/cosec), which signs in to the Companies House XML Gateway with the practice's
// presenter ID and authentication code kept in Azure settings. See docs/co-sec-filing.md for the one-off set-up.
import { Row } from "./schema";

export type GatewayStatus = "pending" | "accepted" | "rejected";
export type SubmitResult = { gatewayRef: string; test: boolean };
export type StatusResult = { status: GatewayStatus; chRef?: string; reason?: string };

export class GatewayError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface CoSecGateway {
  /** Send an approved filing. Resolves with the gateway's own reference for it. */
  submit(tx: Row, company: { number: string; name: string; authCode: string }): Promise<SubmitResult>;
  status(gatewayRef: string, test: boolean): Promise<StatusResult>;
  /** Whether the server has the presenter details (and whether it is still in test mode). */
  info(): Promise<{ configured: boolean; test: boolean; missing: string[] }>;
}

export class HttpGateway implements CoSecGateway {
  constructor(private token: () => Promise<string>) {}
  private async call<T>(action: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/cosec/${action}`, { method: body === undefined ? "GET" : "POST", headers: { "X-PP-Token": await this.token(), "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new GatewayError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let out: any = null;
    try { out = await res.json(); } catch { /* not JSON: not deployed */ }
    if (res.ok && out) return out as T;
    if (!out || !out.error) throw new GatewayError("no-bridge", "Filing isn't on the server yet. It arrives with the next deployment.");
    throw new GatewayError(out.error, out.message || "Companies House filing failed.");
  }
  submit(tx: Row, company: { number: string; name: string; authCode: string }) {
    return this.call<SubmitResult>("submit", { txKey: String(tx.Key), form: String(tx.Form), payload: JSON.parse(String(tx.Payload || "{}")), company });
  }
  status(gatewayRef: string, test: boolean) { return this.call<StatusResult>("status", { gatewayRef, test }); }
  info() { return this.call<{ configured: boolean; test: boolean; missing: string[] }>("info"); }
}

/** A stand-in for the demo build and for tests: accepts everything after it is checked. */
export class FakeGateway implements CoSecGateway {
  private sent = new Map<string, number>();
  async submit(tx: Row) { const ref = `DEMO${String(this.sent.size + 1).padStart(6, "0")}`; this.sent.set(ref, 0); return { gatewayRef: ref, test: true }; }
  async status(ref: string, _test: boolean): Promise<StatusResult> { const n = (this.sent.get(ref) ?? 0) + 1; this.sent.set(ref, n); return n < 2 ? { status: "pending" } : { status: "accepted", chRef: `DEMO-${ref}` }; }
  async info() { return { configured: true, test: true, missing: [] }; }
}
