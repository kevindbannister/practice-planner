// The portal's calls to its server. Every call carries the person's sign-in token; the server decides
// what they may see. Nothing here talks to SharePoint or Microsoft Graph.
import { Config, getToken } from "./auth";

export type Can = Record<string, boolean>;
export type Biz = { clientKey: string; name: string; level: string; levelLabel: string; can: Can };
export type Me = { user: { id: string; name: string; email: string; status: string; mfa: boolean }; businesses: Biz[]; awaitingAccess: boolean; identity?: { any: boolean; open: number } };
export type Details = Record<string, string>;
export type Editable = { key: string; label: string; multiline: boolean; statutory: string; max: number; noted: boolean };
export type BusinessInfo = { clientKey: string; level: string; can: Can; details: Details; editable: Editable[] };
export type ChangeItem = { key: string; label: string; old: string; new: string; decision: string; note: string; statutory: string };
export type ChangeRequest = { id: string; clientKey: string; createdAt: string; status: "pending" | "clarification" | "decided"; outcome: string; decidedAt: string; requestedByName: string; note: string; items: ChangeItem[]; thread: { at: string; from: "client" | "staff"; name: string; text: string }[] };
export type Official = { name: string; number: string; status: string; type: string; incorporated: string; registeredOffice: string; sic: string[]; accountsDue: string; confirmationDue: string; accountingReferenceDate: string; officers: { name: string; role: string; appointed: string }[]; pscs: { name: string; kind: string; control: string[]; notified: string }[] };

export type DocVersion = { n: number; fileName: string; ext: string; size: number; at: string; by: string; byKind: "staff" | "client"; sha256: string };
export type PortalDoc = { id: string; title: string; category: string; status: string; createdAt: string; updatedAt: string; from: "practice" | "client"; needsApproval: boolean; approval: { status: string; at: string; by: string; note: string } | null; message: string; assigned: boolean; previewable: boolean; versions: DocVersion[]; size: number; ext: string };
export type DocList = { documents: PortalDoc[]; categories: string[]; canUpload: boolean; canApprove: boolean };
export type FileOut = { fileName: string; mime: string; size: number; content: string };

export type SignRequest = { id: string; title: string; status: "out" | "completed" | "cancelled" | "declined" | "expired"; message: string; createdAt: string; expiresAt: string; requestedBy: string; completedAt: string; sequential: boolean; you: { status: "signed" | "declined" | "pending" | "waiting" | "closed"; signedAt: string; declined: boolean }; others: { name: string; order: number; status: string }[]; sealedDocId: string; certDocId: string; consent: string };

export type IdItem = { id: string; kind: string; title: string; status: "none" | "needed" | "received" | "rejected" | "accepted" | "expired" | "cancelled"; businesses: string[]; request: { requestedAt: string; reason: string; note: string; rejectedReason: string; uploaded: boolean; uploadedAt: string } | null; current: { expiryDate: string; acceptedAt: string } | null; nextRenewal: string; canUpload: boolean };

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
  documents = (key: string, q: { q?: string; category?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return this.call<DocList>("GET", `documents/${encodeURIComponent(key)}${qs ? `?${qs}` : ""}`);
  };
  uploadDocument = (key: string, b: { title?: string; category?: string; fileName: string; content: string; message?: string; replaces?: string }) => this.call<{ document: PortalDoc }>("POST", `documents/${encodeURIComponent(key)}`, b);
  downloadDocument = (key: string, id: string, version?: number) => this.call<FileOut>("POST", `documents/${encodeURIComponent(key)}/${id}/download`, { version });
  approveDocument = (key: string, id: string, decision: "approved" | "declined", note: string) => this.call<{ document: PortalDoc }>("POST", `documents/${encodeURIComponent(key)}/${id}/approve`, { decision, note });
  signing = (key: string) => this.call<{ requests: SignRequest[] }>("GET", `signing/${encodeURIComponent(key)}`);
  signingDocument = (key: string, id: string) => this.call<FileOut>("POST", `signing/${encodeURIComponent(key)}/${id}/document`, {});
  sign = (key: string, id: string, b: { mode: "typed" | "drawn"; typedName?: string; image?: string; consent: boolean }) => this.call<{ request: SignRequest }>("POST", `signing/${encodeURIComponent(key)}/${id}/sign`, b);
  declineSigning = (key: string, id: string, reason: string) => this.call<{ request: SignRequest }>("POST", `signing/${encodeURIComponent(key)}/${id}/decline`, { reason });
  identity = () => this.call<{ items: IdItem[] }>("GET", "identity");
  uploadIdentity = (id: string, b: { fileName: string; content: string; issueDate?: string; expiryDate?: string }) => this.call<{ item: IdItem }>("POST", `identity/${id}/upload`, b);
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
