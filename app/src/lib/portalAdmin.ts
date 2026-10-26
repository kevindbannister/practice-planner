// The staff side of the client portal: talks to the portal server (/api/portal/admin/...) with the
// staff member's Microsoft sign-in. Everything that changes who can see what happens on the server,
// which checks it and writes the audit trail; this file only asks.

export type PortalLevel = "administrator" | "standard" | "restricted" | "signatory";
export const LEVELS: { key: PortalLevel; label: string; blurb: string }[] = [
  { key: "administrator", label: "Administrator", blurb: "Sees all business details and can ask for changes. Can't sign unless named on a document." },
  { key: "standard", label: "Standard", blurb: "Sees published documents, uploads information and messages the practice." },
  { key: "restricted", label: "Restricted", blurb: "Sees only the documents, requests and messages assigned to them." },
  { key: "signatory", label: "Signatory", blurb: "Sees only the documents they have been named to sign." },
];
export const levelLabel = (k: string) => LEVELS.find((l) => l.key === k)?.label || k;

export type PortalBusiness = { clientKey: string; name: string; level: PortalLevel; levelLabel: string };
export type PortalPerson = {
  id: string; name: string; email: string; status: "invited" | "active" | "suspended" | "revoked"; mfa: boolean; personKey: string; personKind: string;
  selfRegistered: boolean; invitedAt: string; inviteExpires: string; activatedAt: string; lastLoginAt: string; pendingEmail: string; businesses: PortalBusiness[];
};
export type PortalCounts = { total: number; invited: number; active: number; suspended: number; revoked: number; mfa: number; awaitingMatch: number };
export type Attention = { kind: string; at: string; text: string; link: string; clientKey: string };
export type PortalOverview = { users: PortalPerson[]; counts: PortalCounts; attention: Attention[] };
export type ChangeItemStaff = { key: string; label: string; old: string; new: string; current: string; decision: string; note: string; statutory: string; noted: boolean };
export type ChangeRequestStaff = {
  id: string; clientKey: string; clientName: string; createdAt: string; status: "pending" | "clarification" | "decided"; outcome: string; decidedAt: string; requestedByName: string; requestedByEmail: string; note: string;
  items: ChangeItemStaff[]; thread: { at: string; from: "client" | "staff"; name: string; text: string }[];
};
export type DecideResult = { ok: boolean; outcome: string; applied: string[]; statutory: { field: string; body: string }[] };
export type PortalEvent = { id: string; at: string; type: string; source: string; userId: string; actor: string; clientKey: string; recordId: string; meta: Record<string, unknown>; verified: boolean };
export type PortalStatus = { configured: boolean; missing: string[]; optional: string[]; practiceId: string; policy: { adminsManageAccess: boolean } };
export type InviteResult = { user: PortalPerson; created: boolean; emailed: boolean; emailError?: string };

export class PortalAdminError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

export const STATUS_LABEL: Record<string, string> = { invited: "Invitation pending", active: "Active", suspended: "Suspended", revoked: "Access revoked", none: "Not invited" };

/** Plain words for the audit trail. */
export const EVENT_LABEL: Record<string, string> = {
  "invitation.issued": "Invitation issued", "invitation.resent": "Invitation resent", "account.activated": "Account activated", "account.registered": "Registered on their own",
  "account.linked": "Linked to a person", "account.suspended": "Account suspended", "account.revoked": "Access revoked", "account.reinstated": "Account reinstated",
  "account.email-change-requested": "Email change requested", "account.email-changed": "Email changed", "auth.login": "Signed in", "auth.sessions-ended": "Signed out everywhere",
  "access.granted": "Business access granted", "access.changed": "Permissions changed", "access.revoked": "Business access removed",
  "change.requested": "Business details change requested", "change.clarification-asked": "Question asked about a change", "change.client-replied": "Client answered a question", "change.withdrawn": "Change request withdrawn",
  "change.approved": "Change approved", "change.rejected": "Change rejected", "change.applied": "Approved changes saved to the record",
};
export const eventLabel = (t: string) => EVENT_LABEL[t] || t.replace(/[._-]/g, " ");

export class PortalAdminApi {
  constructor(private token: () => Promise<string>) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/portal/admin/${path}`, {
        method,
        headers: { "X-PP-Token": await this.token(), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new PortalAdminError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON: the portal isn't on the server yet */
    }
    if (res.ok && json) return json;
    if (!json) throw new PortalAdminError("no-server", "The client portal isn't on the server yet. It arrives with the next deployment.", res.status);
    throw new PortalAdminError(json.code || (res.status === 503 ? "not-set-up" : "error"), json.error || "That didn't work.", res.status);
  }

  status(): Promise<PortalStatus> {
    return this.call("GET", "status");
  }
  overview(): Promise<PortalOverview> {
    return this.call("GET", "overview");
  }
  async events(q: { clientKey?: string; userId?: string; limit?: number } = {}): Promise<PortalEvent[]> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
    return (await this.call("GET", `events${p.size ? `?${p}` : ""}`)).events;
  }
  invite(i: { email: string; name: string; personKey?: string; personKind?: string; businesses: { clientKey: string; level: PortalLevel }[] }): Promise<InviteResult> {
    return this.call("POST", "invite", i);
  }
  resend(userId: string) { return this.call("POST", "resend", { userId }); }
  setAccess(userId: string, clientKey: string, level: PortalLevel) { return this.call("POST", "access", { userId, clientKey, level }); }
  removeAccess(userId: string, clientKey: string) { return this.call("POST", "remove-access", { userId, clientKey }); }
  link(userId: string, personKey: string, personKind: string) { return this.call("POST", "link", { userId, personKey, personKind }); }
  suspend(userId: string, reason: string) { return this.call("POST", "suspend", { userId, reason }); }
  reinstate(userId: string) { return this.call("POST", "reinstate", { userId }); }
  revoke(userId: string) { return this.call("POST", "revoke", { userId }); }
  changeEmail(userId: string, email: string) { return this.call("POST", "change-email", { userId, email }); }
  endSessions(userId: string) { return this.call("POST", "end-sessions", { userId }); }
  async changes(status = ""): Promise<ChangeRequestStaff[]> { return (await this.call("GET", `changes${status ? `?status=${status}` : ""}`)).requests; }
  askChange(id: string, text: string) { return this.call("POST", "changes-ask", { id, text }); }
  decideChange(id: string, decisions: { key: string; decision: "approved" | "rejected"; note?: string }[]): Promise<DecideResult> { return this.call("POST", "changes-decide", { id, decisions }); }
}
