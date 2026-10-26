// The portal's calls to its server. Every call carries the person's sign-in token; the server decides
// what they may see. Nothing here talks to SharePoint or Microsoft Graph.
import { Config, getToken } from "./auth";

export type Can = Record<string, boolean>;
export type Biz = { clientKey: string; name: string; level: string; levelLabel: string; can: Can };
export type Me = { user: { id: string; name: string; email: string; status: string; mfa: boolean }; businesses: Biz[]; awaitingAccess: boolean };
export type Details = Record<string, string>;
export type Editable = { key: string; label: string; multiline: boolean; statutory: string; max: number; noted: boolean };
export type BusinessInfo = { clientKey: string; level: string; can: Can; details: Details; editable: Editable[] };
export type ChangeItem = { key: string; label: string; old: string; new: string; decision: string; note: string; statutory: string };
export type ChangeRequest = { id: string; clientKey: string; createdAt: string; status: "pending" | "clarification" | "decided"; outcome: string; decidedAt: string; requestedByName: string; note: string; items: ChangeItem[]; thread: { at: string; from: "client" | "staff"; name: string; text: string }[] };
export type Official = { name: string; number: string; status: string; type: string; incorporated: string; registeredOffice: string; sic: string[]; accountsDue: string; confirmationDue: string; accountingReferenceDate: string; officers: { name: string; role: string; appointed: string }[]; pscs: { name: string; kind: string; control: string[]; notified: string }[] };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class PortalClient {
  constructor(private cfg: Config, private onSignedOut: (why: string) => void) {}

  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await getToken(this.cfg);
    if (!token) {
      this.onSignedOut("");
      throw new ApiError(401, "sign-in", "Please sign in");
    }
    let res: Response;
    try {
      res = await fetch(`/api/portal/${path}`, { method, headers: { "X-Portal-Token": token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError(0, "unreachable", "Couldn't reach the portal. Check your internet connection and try again.");
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok && json) return json as T;
    if (res.status === 401) {
      this.onSignedOut(json?.code === "session-ended" ? "You were signed out. Please sign in again." : "Please sign in again.");
    }
    throw new ApiError(res.status, json?.code || "error", json?.error || "Something went wrong. Please try again.");
  }

  me = () => this.call<Me>("GET", "me");
  business = (key: string) => this.call<BusinessInfo>("GET", `business/${encodeURIComponent(key)}`);
  signOutEverywhere = () => this.call("POST", "sessions/end");
  changes = (key: string) => this.call<{ requests: ChangeRequest[]; editable: Editable[] }>("GET", `changes/${encodeURIComponent(key)}`);
  propose = (key: string, items: { key: string; value: string }[], note: string) => this.call<{ request: ChangeRequest }>("POST", `changes/${encodeURIComponent(key)}`, { items, note });
  reply = (key: string, id: string, text: string) => this.call<{ request: ChangeRequest }>("POST", `changes/${encodeURIComponent(key)}/${id}/reply`, { text });
  withdraw = (key: string, id: string) => this.call<{ request: ChangeRequest }>("POST", `changes/${encodeURIComponent(key)}/${id}/cancel`, {});
  official = (key: string) => this.call<{ official: Official | null; configured: boolean; unavailable?: boolean }>("GET", `official/${encodeURIComponent(key)}`);
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const res = await fetch("/api/portal/config", { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
