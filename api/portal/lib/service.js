// The portal's rules: who can sign in, who may see which business, and what staff can do about it.
// It works on a store already bound to one practice, so it cannot reach another practice's data.
//
// People and businesses are many-to-many. A person has ONE portal account (one record per email);
// each business they may see is a separate access record carrying their level there. Access is
// only ever granted by staff. Self-registering gives someone a login and nothing else.

const { LEVELS, LEVEL_LABEL, MATRIX, decide } = require("./rules.js");
const { newId, StoreError } = require("./store.js");

const INVITE_DAYS = 14;
const EMAIL_CHANGE_DAYS = 3;
const SESSION_TOUCH_MS = 10 * 60 * 1000;
const LOGIN_EVENT_GAP_MS = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

class ServiceError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const cleanEmail = (v) => {
  const e = String(v || "").trim().toLowerCase();
  if (!e || e.length > 254 || !EMAIL.test(e)) throw new ServiceError(400, "bad-email", "That doesn't look like an email address");
  return e;
};
const text = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const iso = (ms) => new Date(ms).toISOString();

/** The fields of a client record a portal user may ever be sent. Everything else stays internal. */
const PUBLIC_FIELDS = [
  ["name", "Title"], ["kind", "Kind"], ["companyNumber", "CompanyNumber"], ["incorporated", "Incorporated"], ["yearEnd", "YearEnd"],
  ["registeredOffice", "RegisteredOffice"], ["tradingAddress", "TradingAddress"], ["email", "Email"], ["phone", "Phone"], ["mobile", "Mobile"],
  ["website", "Website"], ["sic", "SIC"], ["vatNumber", "VATNumber"], ["payeRef", "PAYERef"],
];
const businessFields = (row) => Object.fromEntries(PUBLIC_FIELDS.map(([k, col]) => [k, row[col] == null ? "" : String(row[col])]));

function createService({ audit, mailer, now = () => Date.now(), portalUrl = "", practiceName = "Your accountant", policy = {} }) {
  const ev = (store, e) => audit.record(store, e);

  // ---------------------------------------------------------------- reading

  async function userById(store, id) {
    return id ? store.get("users", id) : null;
  }
  async function userByEmail(store, email) {
    return (await store.find("users", (u) => u.email === email))[0] || null;
  }
  async function accessOf(store, userId) {
    return store.find("access", (a) => a.userId === userId);
  }
  async function accessFor(store, userId, clientKey) {
    return (await store.find("access", (a) => a.userId === userId && a.clientKey === clientKey))[0] || null;
  }
  const activeAccess = (list) => list.filter((a) => a.status === "active");

  const publicUser = (u) => ({
    id: u.id, name: u.name || "", email: u.email, status: u.status, mfa: Boolean(u.mfa), personKey: u.personKey || "", personKind: u.personKind || "",
    selfRegistered: Boolean(u.selfRegistered), invitedAt: u.invitedAt || "", inviteExpires: u.inviteExpires || "", activatedAt: u.activatedAt || "",
    lastLoginAt: u.lastLoginAt || "", pendingEmail: u.pendingEmail || "",
  });

  // ---------------------------------------------------------------- signing in

  /**
   * Turns a verified identity into the portal account behind it, creating nothing more than a
   * bare account for someone who registered on their own. Returns { user } or throws.
   */
  async function signIn(store, identity) {
    if (!identity.email) throw new ServiceError(403, "no-email", "Your sign-in didn't include an email address");
    if (!identity.emailVerified) throw new ServiceError(403, "email-unverified", "Please verify your email address first");
    const t = now();
    let user = (await store.find("users", (u) => u.subjectId === identity.sub))[0];

    if (user) {
      if (user.status === "suspended" || user.status === "revoked") throw new ServiceError(403, "account-disabled", "This account can't be used right now. Please contact your accountant.");
      if (user.sessionsEndedAt && identity.issuedAt < Math.floor(Date.parse(user.sessionsEndedAt) / 1000)) throw new ServiceError(401, "session-ended", "You were signed out. Please sign in again.");
      const last = user.lastLoginAt ? Date.parse(user.lastLoginAt) : 0;
      const patch = {};
      if (t - last > SESSION_TOUCH_MS) patch.lastLoginAt = iso(t);
      if (Boolean(user.mfa) !== identity.mfa) patch.mfa = identity.mfa;
      if (identity.name && identity.name !== user.name && !user.personKey) patch.name = identity.name;
      if (Object.keys(patch).length) user = await store.update("users", user.id, patch);
      if (t - last > LOGIN_EVENT_GAP_MS) await ev(store, { type: "auth.login", source: "portal", userId: user.id, actor: user.email, meta: { mfa: identity.mfa } });
      return { user };
    }

    // A new sign-in method for an email change that staff started and the person is completing.
    const changing = (await store.find("users", (u) => u.pendingEmail === identity.email))[0];
    if (changing) {
      if (changing.status === "suspended" || changing.status === "revoked") throw new ServiceError(403, "account-disabled", "This account can't be used right now. Please contact your accountant.");
      if (changing.pendingEmailExpires && Date.parse(changing.pendingEmailExpires) < t) throw new ServiceError(403, "invitation-expired", "That link has expired. Ask your accountant to send it again.");
      user = await store.update("users", changing.id, { subjectId: identity.sub, email: identity.email, pendingEmail: "", pendingEmailExpires: "", lastLoginAt: iso(t), mfa: identity.mfa });
      await ev(store, { type: "account.email-changed", source: "portal", userId: user.id, actor: user.email, meta: { from: changing.email } });
      return { user };
    }

    const byEmail = await userByEmail(store, identity.email);
    if (byEmail && byEmail.subjectId) throw new ServiceError(409, "email-in-use", "This email address is already linked to another sign-in. Please contact your accountant.");

    if (byEmail) {
      // An invitation staff made for this email: the person has now proved they own the address.
      if (byEmail.status !== "invited") throw new ServiceError(403, "account-disabled", "This account can't be used right now. Please contact your accountant.");
      if (byEmail.inviteExpires && Date.parse(byEmail.inviteExpires) < t) throw new ServiceError(403, "invitation-expired", "Your invitation has expired. Ask your accountant to send a new one.");
      user = await store.update("users", byEmail.id, { subjectId: identity.sub, status: "active", activatedAt: iso(t), lastLoginAt: iso(t), mfa: identity.mfa, name: byEmail.name || identity.name });
      await ev(store, { type: "account.activated", source: "portal", userId: user.id, actor: user.email });
      return { user };
    }

    user = await store.insert("users", {
      id: newId("u-"), subjectId: identity.sub, email: identity.email, name: identity.name, personKey: "", personKind: "", status: "active", selfRegistered: true,
      createdAt: iso(t), activatedAt: iso(t), lastLoginAt: iso(t), mfa: identity.mfa,
    });
    await ev(store, { type: "account.registered", source: "portal", userId: user.id, actor: user.email });
    return { user };
  }

  /** Ends every session this person has: tokens issued before now stop working. */
  async function endSessions(store, user, byStaff) {
    await store.update("users", user.id, { sessionsEndedAt: iso(now()) });
    await ev(store, { type: "auth.sessions-ended", source: byStaff ? "staff" : "portal", userId: user.id, actor: byStaff || user.email });
  }

  // ---------------------------------------------------------------- what a person can see

  const permissionsFor = (access) => Object.fromEntries(Object.keys(MATRIX).map((a) => [a, decide(access, a, policy).ok]));

  async function me(store, reader, user) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    const list = [];
    for (const a of activeAccess(await accessOf(store, user.id))) {
      const c = clients.get(a.clientKey);
      if (!c) continue;
      list.push({ clientKey: a.clientKey, name: String(c.Title || a.clientKey), level: a.level, levelLabel: LEVEL_LABEL[a.level], can: permissionsFor(a) });
    }
    list.sort((x, y) => x.name.localeCompare(y.name));
    return { user: publicUser(user), businesses: list, awaitingAccess: list.length === 0 };
  }

  /** Throws unless this person may do this to this business. Returns their access record. */
  async function require_(store, user, clientKey, action) {
    const a = await accessFor(store, user.id, text(clientKey));
    const d = decide(a, action, policy);
    // The same answer whether the business doesn't exist or they just have no access to it.
    if (!d.ok) throw new ServiceError(404, "not-found", "Not found");
    if (a.practiceId !== store.practiceId) throw new ServiceError(404, "not-found", "Not found");
    return a;
  }

  async function business(store, reader, user, clientKey) {
    const a = await require_(store, user, clientKey, "business.summary");
    const row = (await reader.clients()).find((c) => c.Key === a.clientKey);
    if (!row) throw new ServiceError(404, "not-found", "Not found");
    const full = decide(a, "business.details", policy).ok;
    const fields = businessFields(row);
    return { clientKey: a.clientKey, level: a.level, can: permissionsFor(a), details: full ? fields : { name: fields.name, kind: fields.kind } };
  }

  // ---------------------------------------------------------------- staff: granting access

  async function checkBusinesses(reader, list) {
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    const out = [];
    for (const b of Array.isArray(list) ? list : []) {
      const clientKey = text(b.clientKey);
      if (!clients.has(clientKey)) throw new ServiceError(400, "unknown-business", "That business isn't one of your clients");
      if (!LEVELS.includes(b.level)) throw new ServiceError(400, "bad-level", "That isn't a permission level");
      if (!out.some((x) => x.clientKey === clientKey)) out.push({ clientKey, level: b.level });
    }
    return out;
  }

  async function grant(store, staff, user, clientKey, level) {
    const existing = await accessFor(store, user.id, clientKey);
    if (existing && existing.status === "active") {
      if (existing.level === level) return existing;
      const a = await store.update("access", existing.id, { level, changedBy: staff, changedAt: iso(now()) });
      await ev(store, { type: "access.changed", source: "staff", userId: user.id, actor: staff, clientKey, recordId: a.id, meta: { from: existing.level, to: level } });
      return a;
    }
    const t = iso(now());
    const a = existing
      ? await store.update("access", existing.id, { status: "active", level, grantedBy: staff, grantedAt: t, revokedAt: "", revokedBy: "" })
      : await store.insert("access", { id: newId("a-"), userId: user.id, clientKey, level, status: "active", grantedBy: staff, grantedAt: t });
    await ev(store, { type: "access.granted", source: "staff", userId: user.id, actor: staff, clientKey, recordId: a.id, meta: { level } });
    return a;
  }

  async function revokeOne(store, staff, user, clientKey) {
    const existing = await accessFor(store, user.id, clientKey);
    if (!existing || existing.status !== "active") return false;
    await store.update("access", existing.id, { status: "revoked", revokedAt: iso(now()), revokedBy: staff });
    await ev(store, { type: "access.revoked", source: "staff", userId: user.id, actor: staff, clientKey, recordId: existing.id });
    return true;
  }

  function inviteMail(to, name, kind) {
    const url = portalUrl || "";
    const hello = name ? `Hello ${name.split(" ")[0]},` : "Hello,";
    const body =
      kind === "email"
        ? `${practiceName} has asked to move your client portal sign-in to this email address.\n\nTo finish, open the link below and sign in or register with ${to}.`
        : `${practiceName} has set you up on its secure client portal, where you can see documents, sign them, answer requests and message us.\n\nTo get started, open the link below and register with ${to}. You'll be asked to confirm that address with a one-time code.`;
    return { to, subject: kind === "email" ? `${practiceName}: confirm your new portal email` : `${practiceName}: your invitation to the client portal`, text: `${hello}\n\n${body}\n\n${url}\n\nThe link works for ${kind === "email" ? EMAIL_CHANGE_DAYS : INVITE_DAYS} days. If you weren't expecting this, you can ignore it.\n\n${practiceName}` };
  }

  async function send(mail) {
    try {
      await mailer.send(mail);
      return { emailed: true };
    } catch (e) {
      return { emailed: false, emailError: String(e.message || e).slice(0, 200) };
    }
  }

  /** Invite a person (one account per email, however many businesses they get). */
  async function invite(store, reader, staff, input) {
    const email = cleanEmail(input.email);
    const businesses = await checkBusinesses(reader, input.businesses);
    const personKey = text(input.personKey, 100);
    const personKind = text(input.personKind, 20);
    const name = text(input.name, 150);
    const t = now();
    let user = await userByEmail(store, email);
    let fresh = false;
    if (user) {
      if (user.status === "revoked") throw new ServiceError(409, "revoked", "This person's access was revoked. Reinstate it first.");
      if (user.personKey && personKey && user.personKey !== personKey) throw new ServiceError(409, "email-in-use", "That email address already belongs to a different person's portal account");
      const patch = {};
      if (!user.personKey && personKey) Object.assign(patch, { personKey, personKind });
      if (user.status === "invited") Object.assign(patch, { invitedAt: iso(t), inviteExpires: iso(t + INVITE_DAYS * DAY) });
      if (Object.keys(patch).length) user = await store.update("users", user.id, patch);
    } else {
      fresh = true;
      user = await store.insert("users", { id: newId("u-"), subjectId: "", email, name, personKey, personKind, status: "invited", selfRegistered: false, createdAt: iso(t), invitedAt: iso(t), inviteExpires: iso(t + INVITE_DAYS * DAY), mfa: false });
    }
    for (const b of businesses) await grant(store, staff, user, b.clientKey, b.level);
    const mail = user.status === "invited" ? await send(inviteMail(email, user.name, "invite")) : { emailed: false };
    await ev(store, { type: fresh ? "invitation.issued" : "invitation.resent", source: "staff", userId: user.id, actor: staff, meta: { businesses: businesses.map((b) => b.clientKey), emailed: mail.emailed } });
    return { user: publicUser(user), created: fresh, ...mail };
  }

  async function resend(store, staff, userId) {
    let user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    if (user.status !== "invited") throw new ServiceError(409, "not-pending", "This person has already registered");
    const t = now();
    user = await store.update("users", user.id, { invitedAt: iso(t), inviteExpires: iso(t + INVITE_DAYS * DAY) });
    const mail = await send(inviteMail(user.email, user.name, "invite"));
    await ev(store, { type: "invitation.resent", source: "staff", userId: user.id, actor: staff, meta: { emailed: mail.emailed } });
    return { user: publicUser(user), ...mail };
  }

  async function setAccess(store, reader, staff, userId, clientKey, level) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    const [b] = await checkBusinesses(reader, [{ clientKey, level }]);
    if (user.status === "revoked") throw new ServiceError(409, "revoked", "This person's access was revoked");
    return grant(store, staff, user, b.clientKey, b.level);
  }

  async function removeAccess(store, staff, userId, clientKey) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    return { removed: await revokeOne(store, staff, user, text(clientKey)) };
  }

  /** Staff link a self-registered login to a person in the planner. */
  async function linkPerson(store, staff, userId, personKey, personKind) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    if (user.personKey && user.personKey !== personKey) throw new ServiceError(409, "already-linked", "This login is already linked to someone else");
    const other = (await store.find("users", (u) => u.personKey === personKey && u.id !== user.id))[0];
    if (other) throw new ServiceError(409, "person-has-account", "That person already has a portal login");
    const u = await store.update("users", user.id, { personKey: text(personKey, 100), personKind: text(personKind, 20) });
    await ev(store, { type: "account.linked", source: "staff", userId: user.id, actor: staff, meta: { personKey } });
    return publicUser(u);
  }

  async function suspend(store, staff, userId, reason) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    if (user.status === "revoked") throw new ServiceError(409, "revoked", "Already revoked");
    await store.update("users", user.id, { status: "suspended", suspendedAt: iso(now()), sessionsEndedAt: iso(now()) });
    await ev(store, { type: "account.suspended", source: "staff", userId: user.id, actor: staff, meta: { reason: text(reason, 300) } });
    return { ok: true };
  }

  async function reinstate(store, staff, userId) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    if (user.status !== "suspended" && user.status !== "revoked") throw new ServiceError(409, "not-disabled", "This account isn't suspended or revoked");
    const status = user.subjectId ? "active" : "invited";
    const t = now();
    await store.update("users", user.id, { status, inviteExpires: status === "invited" ? iso(t + INVITE_DAYS * DAY) : user.inviteExpires || "" });
    await ev(store, { type: "account.reinstated", source: "staff", userId: user.id, actor: staff, meta: { from: user.status } });
    return { ok: true };
  }

  /** Takes away the login and every business at once. */
  async function revoke(store, staff, userId) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    for (const a of activeAccess(await accessOf(store, user.id))) await revokeOne(store, staff, user, a.clientKey);
    await store.update("users", user.id, { status: "revoked", revokedAt: iso(now()), sessionsEndedAt: iso(now()) });
    await ev(store, { type: "account.revoked", source: "staff", userId: user.id, actor: staff });
    return { ok: true };
  }

  /** Move a login to a new email: the person must sign in with it (proving they own it) to finish. */
  async function changeEmail(store, staff, userId, newEmail) {
    const user = await userById(store, userId);
    if (!user) throw new ServiceError(404, "not-found", "Not found");
    if (user.status === "revoked") throw new ServiceError(409, "revoked", "This person's access was revoked");
    const email = cleanEmail(newEmail);
    if (email === user.email) throw new ServiceError(400, "same-email", "That is already their email address");
    const clash = (await store.find("users", (u) => u.id !== user.id && (u.email === email || u.pendingEmail === email)))[0];
    if (clash) throw new ServiceError(409, "email-in-use", "That email address already belongs to another portal account");
    if (user.status === "invited") {
      // Never signed in: nothing to verify, simply change where the invitation goes.
      const u = await store.update("users", user.id, { email });
      const mail = await send(inviteMail(email, u.name, "invite"));
      await ev(store, { type: "account.email-changed", source: "staff", userId: user.id, actor: staff, meta: { from: user.email, emailed: mail.emailed } });
      return { user: publicUser(u), ...mail };
    }
    const u = await store.update("users", user.id, { pendingEmail: email, pendingEmailExpires: iso(now() + EMAIL_CHANGE_DAYS * DAY) });
    const mail = await send(inviteMail(email, u.name, "email"));
    await send({ to: user.email, subject: `${practiceName}: a change to your portal sign-in`, text: `${practiceName} has asked to move your client portal sign-in to a new email address. Nothing changes until the new address is confirmed. If you didn't expect this, please contact us.\n\n${practiceName}` });
    await ev(store, { type: "account.email-change-requested", source: "staff", userId: user.id, actor: staff, meta: { emailed: mail.emailed } });
    return { user: publicUser(u), ...mail };
  }

  // ---------------------------------------------------------------- staff: looking

  async function people(store, reader) {
    const users = await store.list("users");
    const access = await store.list("access");
    const clients = new Map((await reader.clients()).map((c) => [c.Key, c]));
    return users.map((u) => ({
      ...publicUser(u),
      businesses: access.filter((a) => a.userId === u.id && a.status === "active" && clients.has(a.clientKey)).map((a) => ({ clientKey: a.clientKey, name: String(clients.get(a.clientKey).Title || a.clientKey), level: a.level, levelLabel: LEVEL_LABEL[a.level] })),
    }));
  }

  async function overview(store, reader) {
    const list = await people(store, reader);
    const active = list.filter((u) => u.status === "active");
    return {
      users: list,
      counts: {
        total: list.length, invited: list.filter((u) => u.status === "invited").length, active: active.length,
        suspended: list.filter((u) => u.status === "suspended").length, revoked: list.filter((u) => u.status === "revoked").length,
        mfa: active.filter((u) => u.mfa).length, awaitingMatch: active.filter((u) => u.selfRegistered && !u.personKey && u.businesses.length === 0).length,
      },
    };
  }

  async function events(store, { clientKey, userId, limit = 200 } = {}) {
    const all = await store.audit();
    return all.filter((e) => (!clientKey || e.clientKey === clientKey) && (!userId || e.userId === userId)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, Math.min(Number(limit) || 200, 1000))
      .map((e) => ({ id: e.id, at: e.at, type: e.type, source: e.source, userId: e.userId, actor: e.actor, clientKey: e.clientKey, recordId: e.recordId, meta: e.meta, verified: audit.verify(e) }));
  }

  return { signIn, endSessions, me, business, require: require_, invite, resend, setAccess, removeAccess, linkPerson, suspend, reinstate, revoke, changeEmail, people, overview, events, userById, accessFor, accessOf, publicUser, businessFields, permissionsFor, ServiceError, StoreError };
}

module.exports = { createService, ServiceError, businessFields, PUBLIC_FIELDS, INVITE_DAYS };
