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
  "message.thread-started": "Conversation started", "message.sent": "Message sent", "request.created": "Information requested", "request.responded": "Information request answered", "request.staff-reply": "Reply to an information request", "request.completed": "Information request completed", "request.cancelled": "Information request cancelled", "reminder.sent": "Reminder emailed", "reminder.sweep": "Reminder run", "reminder.paused": "Reminder paused", "reminder.resumed": "Reminder resumed", "reminder.cancelled": "Reminder cancelled", "reminder.rescheduled": "Reminder rescheduled", "reminder.settings": "Reminder settings changed",
  "identity.requested": "Identity document requested", "identity.renewal-requested": "Renewal requested automatically", "identity.uploaded": "Identity document sent by the client", "identity.viewed": "Identity document opened by staff", "identity.accepted": "Identity document accepted", "identity.rejected": "Identity document rejected", "identity.cancelled": "Identity request cancelled", "identity.reminded": "Identity reminder emailed", "identity.edited": "Identity settings changed", "identity.refused": "Identity file refused by the security check",
  "signing.requested": "Signing requested", "signing.sent": "Signing invitation emailed", "signing.viewed": "Document opened by a signatory", "signing.signed": "Document signed", "signing.declined": "Signing declined", "signing.completed": "All signatures received", "signing.sealed": "Signed copy and certificate produced", "signing.cancelled": "Signing cancelled", "signing.reminded": "Signing reminder emailed", "document.generated": "Signed copy filed",
  "document.added": "Document added (draft)", "document.published": "Document published", "document.unpublished": "Document unpublished", "document.archived": "Document archived", "document.edited": "Document details edited", "document.version-added": "New version added by the practice", "document.version-uploaded": "New version uploaded by the client", "document.uploaded": "Document uploaded by the client", "document.downloaded": "Document downloaded", "document.approved": "Document approved by the client", "document.declined": "Document declined by the client", "document.refused": "File refused by the security check",
  "change.approved": "Change approved", "change.rejected": "Change rejected", "change.applied": "Approved changes saved to the record",
};
export const eventLabel = (t: string) => EVENT_LABEL[t] || t.replace(/[._-]/g, " ");

export type StaffDoc = { id: string; clientKey: string; title: string; category: string; status: string; published: boolean; publishedAt: string; createdAt: string; updatedAt: string; from: "practice" | "client"; needsApproval: boolean; approval: { status: string; at: string; by: string; note: string } | null; message: string; locked: boolean; internalNote: string; assignedTo: string[]; assignedNames: string[]; uploadedBy: string; scan: string; versions: { n: number; fileName: string; ext: string; size: number; at: string; by: string; byKind: string; sha256: string }[]; size: number; ext: string };
export type StaffFile = { fileName: string; mime: string; size: number; content: string };

export type StaffSigning = { id: string; ref: string; clientKey: string; docId: string; version: number; title: string; status: "out" | "completed" | "cancelled" | "declined" | "expired"; sequential: boolean; createdAt: string; createdByName: string; expiresAt: string; message: string; completedAt: string; sealedDocId: string; certDocId: string; remindedAt: string; declineReason: string; sha256: string; sealedSha256: string; signatories: { id: string; userId: string; name: string; email: string; order: number; status: "signed" | "declined" | "pending" | "waiting" | "closed"; signedAt: string; viewedAt: string }[] };

export type StaffIdentity = {
  id: string; userId: string; person: string; email: string; kind: string; title: string; status: "none" | "needed" | "received" | "rejected" | "accepted" | "expired" | "cancelled"; createdAt: string; createdByName: string;
  businesses: { clientKey: string; name: string }[]; renewal: { auto: boolean; reviewMonths: number }; nextRenewal: string; paused: boolean; cancelled: boolean;
  request: { requestedAt: string; requestedBy: string; reason: string; note: string; rejectedReason: string; remindersSent: number; upload: { fileName: string; size: number; receivedAt: string; declaredIssue: string; declaredExpiry: string; viewedBy: string[]; scan: string } | null } | null;
  current: { fileName: string; issueDate: string; expiryDate: string; receivedAt: string; verifiedBy: string; verifiedAt: string; note: string } | null;
  history: { n: number; fileName: string; receivedAt: string; issueDate: string; expiryDate: string; decision: string; decidedBy: string; decidedAt: string; note: string }[];
};

export type StaffRequest = { id: string; clientKey: string; title: string; details: string; dueDate: string; status: "open" | "responded" | "complete" | "cancelled"; createdAt: string; createdByName: string; assigned: boolean; assignedTo: string[]; assignedNames: string[]; thread: { at: string; from: "client" | "staff"; name: string; text: string; docs: { id: string; title: string }[] }[]; completedAt: string; lastReminderAt: string };
export type ReminderKind = { label: string; enabled: boolean; firstAfterDays: number; repeatEveryDays: number; max: number };
export type ReminderItem = { key: string; kind: string; kindLabel: string; title: string; clientKey: string; client: string; since: string; recipients: string[]; sentCount: number; lastSentAt: string; nextDue: string; paused: boolean; cancelled: boolean; exhausted: boolean };
export type RemindersOverview = { paused: boolean; quiet: boolean; kinds: Record<string, ReminderKind>; lastSweepAt: string; lastResult: { sent: number; items: number; people: number; skipped: string; identity: { requested: number; reminded: number } } | null; items: ReminderItem[]; identityNote: string };

export type StaffThread = { id: string; subject: string; createdAt: string; lastAt: string; lastFrom: "client" | "staff"; preview: string; started: "client" | "staff"; startedBy: string; count: number; unread: boolean; clientKey: string; assignedTo: string[]; assignedNames: string[] };
export type StaffMsg = { id: string; at: string; from: "client" | "staff"; name: string; text: string; docs: { id: string; title: string }[] };
type Files = { fileName: string; content: string }[];

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
  async documents(clientKey: string): Promise<{ documents: StaffDoc[]; categories: string[] }> { return this.call("GET", `documents?clientKey=${encodeURIComponent(clientKey)}`); }
  addDocument(b: { clientKey: string; title?: string; category?: string; fileName: string; content: string; publish: boolean; notify: boolean; assignedTo: string[]; requiresApproval: boolean; message?: string; internalNote?: string }): Promise<{ document: StaffDoc }> { return this.call("POST", "documents-add", b); }
  publishDocument(id: string, o: { notify: boolean; assignedTo?: string[]; requiresApproval?: boolean }): Promise<{ document: StaffDoc & { told: number } }> { return this.call("POST", "documents-publish", { id, ...o }); }
  unpublishDocument(id: string) { return this.call("POST", "documents-unpublish", { id }); }
  archiveDocument(id: string) { return this.call("POST", "documents-archive", { id }); }
  documentVersion(id: string, b: { fileName: string; content: string; notify: boolean }) { return this.call("POST", "documents-version", { id, ...b }); }
  editDocument(id: string, b: { title?: string; category?: string; assignedTo?: string[]; internalNote?: string }) { return this.call("POST", "documents-edit", { id, ...b }); }
  documentSeen(id: string) { return this.call("POST", "documents-seen", { id }); }
  downloadDocument(id: string, version?: number): Promise<StaffFile> { return this.call("POST", "documents-download", { id, version }); }
  async signing(clientKey: string): Promise<StaffSigning[]> { return (await this.call("GET", `signing?clientKey=${encodeURIComponent(clientKey)}`)).requests; }
  createSigning(b: { clientKey: string; docId: string; title?: string; signatoryIds: string[]; sequential: boolean; message?: string; expiresInDays?: number }): Promise<{ request: StaffSigning }> { return this.call("POST", "signing-create", b); }
  cancelSigning(id: string) { return this.call("POST", "signing-cancel", { id }); }
  remindSigning(id: string): Promise<{ request: StaffSigning & { reminded: number } }> { return this.call("POST", "signing-remind", { id }); }
  verifySigning(id: string): Promise<{ ok: boolean; checks: { what: string; ok: boolean }[] }> { return this.call("POST", "signing-verify", { id }); }
  async identity(userId?: string): Promise<{ items: StaffIdentity[]; kinds: Record<string, string> }> { return this.call("GET", `identity${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`); }
  requestIdentity(b: { userId: string; kind: string; label?: string; businesses: string[]; autoRenew: boolean; reviewMonths?: number; force?: boolean; note?: string }): Promise<{ item: StaffIdentity }> { return this.call("POST", "identity-request", b); }
  downloadIdentity(id: string, which: string | number = "upload"): Promise<StaffFile> { return this.call("POST", "identity-download", { id, which }); }
  acceptIdentity(id: string, b: { issueDate?: string; expiryDate?: string; noExpiry?: boolean; note?: string; confirmed: boolean }) { return this.call("POST", "identity-accept", { id, ...b }); }
  rejectIdentity(id: string, reason: string) { return this.call("POST", "identity-reject", { id, reason }); }
  editIdentity(id: string, b: { businesses?: string[]; autoRenew?: boolean; reviewMonths?: number; paused?: boolean }) { return this.call("POST", "identity-edit", { id, ...b }); }
  cancelIdentity(id: string) { return this.call("POST", "identity-cancel", { id }); }
  sweepIdentity(): Promise<{ requested: number; reminded: number }> { return this.call("POST", "identity-sweep", {}); }
  async threads(clientKey: string, q = "", unread = false): Promise<StaffThread[]> { return (await this.call("GET", `messages?clientKey=${encodeURIComponent(clientKey)}${q ? `&q=${encodeURIComponent(q)}` : ""}${unread ? "&unread=1" : ""}`)).threads; }
  openThread(id: string): Promise<{ thread: StaffThread; messages: StaffMsg[] }> { return this.call("GET", `messages?id=${encodeURIComponent(id)}`); }
  startThread(b: { clientKey: string; subject: string; text: string; assignedTo: string[]; notify: boolean; files: Files }): Promise<{ thread: StaffThread; messages: StaffMsg[]; told: number }> { return this.call("POST", "messages-start", b); }
  replyThread(id: string, b: { text: string; notify: boolean; files: Files }): Promise<{ thread: StaffThread; messages: StaffMsg[]; told: number }> { return this.call("POST", "messages-reply", { id, ...b }); }
  async requests(clientKey: string): Promise<StaffRequest[]> { return (await this.call("GET", `requests?clientKey=${encodeURIComponent(clientKey)}`)).requests; }
  createRequest(b: { clientKey: string; title: string; details?: string; dueDate?: string; assignedTo: string[]; notify: boolean }): Promise<{ request: StaffRequest & { told: number } }> { return this.call("POST", "requests-create", b); }
  replyRequest(id: string, text: string, reopen = true) { return this.call("POST", "requests-reply", { id, text, reopen }); }
  completeRequest(id: string) { return this.call("POST", "requests-complete", { id }); }
  cancelRequest(id: string) { return this.call("POST", "requests-cancel", { id }); }
  reminders(): Promise<RemindersOverview> { return this.call("GET", "reminders"); }
  reminderSettings(b: { paused?: boolean; quiet?: boolean; kinds?: Record<string, Partial<ReminderKind>> }) { return this.call("POST", "reminders-settings", b); }
  reminderItem(key: string, b: { paused?: boolean; cancelled?: boolean; nextAt?: string }) { return this.call("POST", "reminders-item", { key, ...b }); }
  runReminders(): Promise<{ sent: number; items: number; people: number; skipped: string; identity: { requested: number; reminded: number } }> { return this.call("POST", "reminders-run", {}); }
  askChange(id: string, text: string) { return this.call("POST", "changes-ask", { id, text }); }
  decideChange(id: string, decisions: { key: string; decision: "approved" | "rejected"; note?: string }[]): Promise<DecideResult> { return this.call("POST", "changes-decide", { id, decisions }); }
}
