// Tests for the client portal server: sign-in, access per business, staff controls, audit.
const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, token, other, pair, jwk, NOW, ISSUER, AUDIENCE, JWKS, CLIENTS } = require("./portalKit.js");
const { createVerifier, identityOf } = require("../portal/lib/jwt.js");
const { bind, createMemoryStore } = require("../portal/lib/store.js");
const { createAudit } = require("../portal/lib/audit.js");
const { decide, canSee } = require("../portal/lib/rules.js");

const ANN = { sub: "s-ann", email: "ann@example.com", name: "Ann Example" };
const BEN = { sub: "s-ben", email: "ben@example.com", name: "Ben Other" };

async function invite(h, who, businesses, extra = {}) {
  const r = await h.staff("POST", "invite", { email: who.email, name: who.name, personKey: extra.personKey || "", businesses });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

// ------------------------------------------------------------------ tokens

test("tokens: a good one is accepted; forged, wrong-audience, wrong-issuer, expired and alg-none are not", async () => {
  const v = createVerifier({ issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS, now: () => NOW, fetch: async () => ({ ok: true, json: async () => ({ keys: [jwk(pair, "k1")] }) }) });
  assert.equal((await v.verify(token())).ok, true);
  assert.equal((await v.verify(token({}, { key: other.privateKey }))).reason, "signature");
  assert.equal((await v.verify(token({ aud: "someone-else" }))).reason, "audience");
  assert.equal((await v.verify(token({ iss: "https://evil.example" }))).reason, "issuer");
  assert.equal((await v.verify(token({ exp: NOW / 1000 - 3600 }))).reason, "expired");
  assert.equal((await v.verify(token({}, { alg: "none" }))).reason, "algorithm");
  assert.equal((await v.verify(token({}, { kid: "unknown" }))).reason, "unknown-key");
  assert.equal((await v.verify("not.a.token")).ok, false);
  assert.equal((await v.verify("")).ok, false);
});

test("tokens: the person's email, name and MFA use are read from the right claims", () => {
  const i = identityOf({ sub: "x", emails: ["Zed@Example.com"], given_name: "Zed", family_name: "Z", amr: ["pwd", "mfa"], iat: 5 });
  assert.deepEqual([i.sub, i.email, i.name, i.mfa], ["x", "zed@example.com", "Zed Z", true]);
  assert.equal(identityOf({ sub: "x", email: "a@b.co" }).mfa, false);
});

test("no token, or a bad one, gets nothing", async () => {
  const h = setup();
  assert.equal((await h.call("default", "GET", "me")).status, 401);
  assert.equal((await h.call("default", "GET", "me", { headers: { "x-portal-token": "junk" } })).status, 401);
  assert.equal((await h.call("default", "GET", "me", { headers: { "x-portal-token": token({}, { key: other.privateKey }) } })).status, 401);
});

// ------------------------------------------------------------------ invitation and activation

test("invitation: staff invite, the person registers with that email, and the account activates", async () => {
  const h = setup();
  const out = await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }]);
  assert.equal(out.user.status, "invited");
  assert.equal(out.emailed, true);
  assert.match(h.mailer.sent[0].text, /register with ann@example.com/);
  assert.match(h.mailer.sent[0].text, /pp.example\/portal/);
  const me = await h.asUser(ANN);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.status, "active");
  assert.deepEqual(me.body.businesses.map((b) => b.clientKey), ["c-acme"]);
  assert.ok(me.body.user.activatedAt);
});

test("invitation: an expired invitation can't be used, and resending renews it", async () => {
  const h = setup();
  const { user } = await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  h.state.now = NOW + 15 * 86400000;
  const fresh = { ...ANN, iat: h.state.now / 1000 - 10, exp: h.state.now / 1000 + 3600 };
  const late = await h.asUser(fresh);
  assert.equal(late.status, 403);
  assert.equal(late.body.code, "invitation-expired");
  assert.equal((await h.staff("POST", "resend", { userId: user.id })).status, 200);
  assert.equal((await h.asUser(fresh)).status, 200);
});

test("registering with a different email can't take over someone else's invitation", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  const intruder = await h.asUser({ sub: "s-evil", email: "evil@example.com" });
  assert.equal(intruder.status, 200);
  assert.deepEqual(intruder.body.businesses, []);
  const stillInvited = (await h.staff("GET", "overview")).body.users.find((u) => u.email === "ann@example.com");
  assert.equal(stillInvited.status, "invited");
});

test("an unverified email is refused", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  const r = await h.asUser({ ...ANN, email_verified: false });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "email-unverified");
});

// ------------------------------------------------------------------ self-registration

test("self-registration: a login with no access, and listing as a director grants nothing", async () => {
  const h = setup();
  const me = await h.asUser({ sub: "s-new", email: "newbie@example.com", name: "Newbie" });
  assert.equal(me.status, 200);
  assert.equal(me.body.awaitingAccess, true);
  assert.deepEqual(me.body.businesses, []);
  assert.equal((await h.asUser({ sub: "s-new", email: "newbie@example.com" }, "business/c-acme")).status, 404);
  const ov = (await h.staff("GET", "overview")).body;
  assert.equal(ov.counts.awaitingMatch, 1);
  assert.equal(ov.users[0].selfRegistered, true);
});

test("staff can link a self-registered login to a person and give access; it never creates a second account", async () => {
  const h = setup();
  await h.asUser({ sub: "s-new", email: "newbie@example.com" });
  const u = (await h.staff("GET", "overview")).body.users[0];
  assert.equal((await h.staff("POST", "link", { userId: u.id, personKey: "p-1", personKind: "contact" })).status, 200);
  assert.equal((await h.staff("POST", "access", { userId: u.id, clientKey: "c-acme", level: "standard" })).status, 200);
  const again = await invite(h, { email: "newbie@example.com", name: "Newbie" }, [{ clientKey: "c-bolt", level: "restricted" }], { personKey: "p-1" });
  assert.equal(again.created, false);
  const ov = (await h.staff("GET", "overview")).body;
  assert.equal(ov.users.length, 1);
  assert.equal(ov.users[0].businesses.length, 2);
});

// ------------------------------------------------------------------ many to many

test("one person, several businesses, different permissions in each; switching is just asking", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }, { clientKey: "c-bolt", level: "restricted" }, { clientKey: "c-cove", level: "signatory" }]);
  const me = (await h.asUser(ANN)).body;
  assert.deepEqual(me.businesses.map((b) => [b.clientKey, b.level]), [["c-acme", "administrator"], ["c-bolt", "restricted"], ["c-cove", "signatory"]]);
  const acme = (await h.asUser(ANN, "business/c-acme")).body;
  const bolt = (await h.asUser(ANN, "business/c-bolt")).body;
  assert.equal(acme.details.companyNumber, "01234567");
  assert.equal(bolt.details.companyNumber, undefined); // restricted: name only
  assert.equal(acme.can["business.requestChange"], true);
  assert.equal(bolt.can["business.requestChange"], false);
});

test("several people on one business with their own levels, and no duplicate accounts", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }]);
  await invite(h, BEN, [{ clientKey: "c-acme", level: "standard" }]);
  await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }, { clientKey: "c-bolt", level: "standard" }]); // same person again
  const ov = (await h.staff("GET", "overview")).body;
  assert.equal(ov.users.length, 2);
  assert.equal((await h.asUser(ANN, "business/c-acme")).body.level, "administrator");
  assert.equal((await h.asUser(BEN, "business/c-acme")).body.level, "standard");
  assert.equal((await h.asUser(BEN, "business/c-bolt")).status, 404);
});

test("the same email can't be given to two different people", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }], { personKey: "p-ann" });
  const r = await h.staff("POST", "invite", { email: ANN.email, personKey: "p-other", businesses: [] });
  assert.equal(r.status, 409);
});

test("staff can only grant access to real clients and real levels", async () => {
  const h = setup();
  assert.equal((await h.staff("POST", "invite", { email: "x@example.com", businesses: [{ clientKey: "c-nope", level: "standard" }] })).status, 400);
  assert.equal((await h.staff("POST", "invite", { email: "x@example.com", businesses: [{ clientKey: "c-acme", level: "god" }] })).status, 400);
  assert.equal((await h.staff("POST", "invite", { email: "not-an-email", businesses: [] })).status, 400);
});

// ------------------------------------------------------------------ revoking

test("removing a business takes effect at once and leaves the others; changing the level takes effect at once", async () => {
  const h = setup();
  const { user } = await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }, { clientKey: "c-bolt", level: "standard" }]);
  await h.asUser(ANN);
  await h.staff("POST", "access", { userId: user.id, clientKey: "c-acme", level: "standard" });
  assert.equal((await h.asUser(ANN, "business/c-acme")).body.can["business.requestChange"], false);
  await h.staff("POST", "remove-access", { userId: user.id, clientKey: "c-acme" });
  assert.equal((await h.asUser(ANN, "business/c-acme")).status, 404);
  assert.equal((await h.asUser(ANN, "business/c-bolt")).status, 200);
  await h.staff("POST", "access", { userId: user.id, clientKey: "c-acme", level: "restricted" }); // can be given back
  assert.equal((await h.asUser(ANN, "business/c-acme")).body.level, "restricted");
});

test("suspending or revoking a person locks the login out and ends their sessions", async () => {
  const h = setup();
  const { user } = await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  await h.asUser(ANN);
  await h.staff("POST", "suspend", { userId: user.id, reason: "left the company" });
  const r = await h.asUser(ANN);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "account-disabled");
  await h.staff("POST", "reinstate", { userId: user.id });
  assert.equal((await h.asUser({ ...ANN, iat: NOW / 1000 + 5 })).status, 200); // a new sign-in works
  await h.staff("POST", "revoke", { userId: user.id });
  assert.equal((await h.asUser(ANN)).status, 403);
  assert.equal((await h.staff("GET", "overview")).body.users[0].businesses.length, 0);
});

test("signing out everywhere rejects tokens issued earlier but not new sign-ins", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  await h.asUser(ANN);
  h.state.now = NOW + 60000;
  assert.equal((await h.asUser(ANN, "sessions/end", "default", { method: "POST" })).status, 200);
  const old = await h.asUser({ ...ANN, iat: NOW / 1000 - 30 });
  assert.equal(old.status, 401);
  assert.equal(old.body.code, "session-ended");
  assert.equal((await h.asUser({ ...ANN, iat: NOW / 1000 + 120 })).status, 200);
});

// ------------------------------------------------------------------ email change

test("changing a login email needs the new address to be verified by signing in with it", async () => {
  const h = setup();
  const { user } = await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  await h.asUser(ANN);
  const r = await h.staff("POST", "change-email", { userId: user.id, email: "ann.new@example.com" });
  assert.equal(r.status, 200);
  assert.equal(h.mailer.sent.at(-1).to, "ann@example.com"); // the old address is told
  assert.ok(h.mailer.sent.some((m) => m.to === "ann.new@example.com"));
  assert.equal((await h.asUser(ANN)).body.user.email, "ann@example.com"); // nothing changed yet
  const moved = await h.asUser({ sub: "s-ann-2", email: "ann.new@example.com" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.user.email, "ann.new@example.com");
  assert.deepEqual(moved.body.businesses.map((b) => b.clientKey), ["c-acme"]);
  assert.equal((await h.staff("GET", "overview")).body.users.length, 1);
  const old = await h.asUser(ANN); // the old sign-in is just a stranger now
  assert.deepEqual(old.body.businesses, []);
});

test("an email already used by another account can't be moved to", async () => {
  const h = setup();
  const a = (await invite(h, ANN, [])).user;
  await invite(h, BEN, []);
  assert.equal((await h.staff("POST", "change-email", { userId: a.id, email: BEN.email })).status, 409);
});

// ------------------------------------------------------------------ isolation

test("practices are isolated: the same person, a different practice, sees nothing", async () => {
  const h = setup({ practices: ["practice-a", "practice-b"] });
  await h.staff("POST", "invite", { email: ANN.email, name: "Ann", businesses: [{ clientKey: "c-acme", level: "administrator" }] }, "practice-a");
  assert.equal((await h.asUser(ANN, "me", "practice-a")).body.businesses.length, 1);
  const b = await h.asUser(ANN, "me", "practice-b");
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.businesses, []); // a bare self-registered account in practice B
  assert.equal((await h.asUser(ANN, "business/c-acme", "practice-b")).status, 404);
  assert.equal((await h.staff("GET", "overview", undefined, "practice-b")).body.users.length, 1);
  assert.equal((await h.staff("GET", "events", undefined, "practice-b")).body.events.every((e) => e.type === "account.registered"), true);
});

test("a bound store can't read, change or delete another practice's records", async () => {
  const raw = createMemoryStore();
  const a = bind(raw, "a");
  const b = bind(raw, "b");
  const doc = await a.insert("users", { id: "u1", email: "x" });
  assert.equal(await b.get("users", "u1"), null);
  assert.deepEqual(await b.list("users"), []);
  await assert.rejects(() => b.update("users", "u1", { email: "hacked" }), { code: "missing" });
  await b.remove("users", "u1");
  assert.equal((await a.get("users", "u1")).email, "x");
  assert.equal(doc.practiceId, "a");
  const stamped = await b.insert("users", { id: "u2", practiceId: "a" }); // can't smuggle a record into another practice
  assert.equal(stamped.practiceId, "b");
});

// ------------------------------------------------------------------ no internal information

test("a business answer never carries internal fields, for any level", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }]);
  await invite(h, BEN, [{ clientKey: "c-acme", level: "restricted" }]);
  for (const who of [ANN, BEN]) {
    const raw = JSON.stringify((await h.asUser(who, "business/c-acme")).body) + JSON.stringify((await h.asUser(who)).body);
    for (const secret of ["1234567890", "0987654321", "QQ123456C", "AUTH99", "Slow payer", "4800", "Kevin", "Sam", "Red", "9 Secret Lane", "1970-01-01", "Importance", "Partner", "Manager"]) {
      assert.equal(raw.includes(secret), false, `${secret} leaked`);
    }
  }
});

// ------------------------------------------------------------------ staff and portal tokens don't mix

test("the admin side needs a staff sign-in; a client's token doesn't open it", async () => {
  const h = setup();
  assert.equal((await h.call("default", "GET", "admin/overview")).status, 401);
  assert.equal((await h.call("default", "GET", "admin/overview", { headers: { "x-portal-token": token() } })).status, 401);
  assert.equal((await h.call("default", "POST", "admin/invite", { body: { email: "a@b.co", businesses: [] } })).status, 401);
});

// ------------------------------------------------------------------ MFA

test("MFA use is recorded from the sign-in, and staff can see adoption but not change it", async () => {
  const h = setup();
  await invite(h, ANN, [{ clientKey: "c-acme", level: "standard" }]);
  await invite(h, BEN, [{ clientKey: "c-acme", level: "standard" }]);
  await h.asUser({ ...ANN, amr: ["pwd", "mfa"] });
  await h.asUser(BEN);
  const ov = (await h.staff("GET", "overview")).body;
  assert.equal(ov.counts.active, 2);
  assert.equal(ov.counts.mfa, 1);
  assert.equal(ov.users.find((u) => u.email === ANN.email).mfa, true);
  assert.equal(JSON.stringify(ov).match(/password|secret|passcode/i), null);
});

// ------------------------------------------------------------------ audit

test("the audit trail records who did what, and keeps credentials out", async () => {
  const h = setup();
  const { user } = await invite(h, ANN, [{ clientKey: "c-acme", level: "administrator" }]);
  await h.asUser({ ...ANN, amr: ["mfa"] });
  await h.staff("POST", "access", { userId: user.id, clientKey: "c-acme", level: "standard" });
  await h.staff("POST", "remove-access", { userId: user.id, clientKey: "c-acme" });
  await h.staff("POST", "suspend", { userId: user.id, reason: "test" });
  const ev = (await h.staff("GET", "events")).body.events;
  const types = ev.map((e) => e.type);
  for (const t of ["invitation.issued", "access.granted", "account.activated", "access.changed", "access.revoked", "account.suspended"]) assert.ok(types.includes(t), `missing ${t}`);
  const granted = ev.find((e) => e.type === "access.granted");
  assert.equal(granted.actor, "Kevin");
  assert.equal(granted.source, "staff");
  assert.equal(granted.clientKey, "c-acme");
  assert.equal(granted.userId, user.id);
  assert.ok(granted.id && granted.at && granted.recordId);
  assert.equal(ev.every((e) => e.verified), true);
  assert.equal(JSON.stringify(ev).includes("eyJ"), false); // no token ever lands in the trail
  const filtered = (await h.staff("GET", "events")).body.events.filter((e) => e.clientKey === "c-acme");
  assert.ok(filtered.length >= 3);
});

test("audit events can only be added: bound stores refuse changes and deletes, and a doctored event fails its signature", async () => {
  const raw = createMemoryStore();
  const store = bind(raw, "p");
  const audit = createAudit({ key: "k", now: () => NOW });
  const e = await audit.record(store, { type: "x.y", source: "staff", actor: "me", meta: { password: "hunter2", token: "t", note: "ok", code: "123456" } });
  assert.deepEqual(e.meta, { note: "ok" });
  await assert.rejects(() => store.update("audit", e.id, { type: "other" }), { code: "audit" });
  await assert.rejects(() => store.remove("audit", e.id), { code: "audit" });
  await assert.rejects(() => store.insert("audit", { id: "z" }), { code: "audit" });
  assert.equal((await audit.tampered(store)).length, 0);
  await raw.update("p", "audit", e.id, { actor: "someone else" }); // edited behind the portal's back
  assert.equal((await audit.tampered(store)).length, 1);
  const forged = createAudit({ key: "wrong", now: () => NOW });
  assert.equal(forged.verify(await raw.get("p", "audit", e.id)), false);
});

// ------------------------------------------------------------------ rules

test("signing is never implied by a level; restricted and signatory only see what is assigned to them", () => {
  const acc = (level) => ({ status: "active", level });
  assert.equal(decide(acc("administrator"), "access.manage").ok, false); // practice policy off by default
  assert.equal(decide(acc("administrator"), "access.manage", { adminsManageAccess: true }).ok, true);
  assert.equal(decide(acc("standard"), "access.manage", { adminsManageAccess: true }).ok, false);
  assert.equal(decide(acc("administrator"), "signing.sign").scope, "assigned"); // admin still needs to be named
  assert.equal(canSee(acc("administrator"), "signing.sign", "u1", { assignedTo: [] }), false);
  assert.equal(canSee(acc("signatory"), "signing.sign", "u1", { assignedTo: ["u1"] }), true);
  assert.equal(canSee(acc("restricted"), "documents.view", "u1", { assignedTo: ["u2"] }), false);
  assert.equal(canSee(acc("restricted"), "documents.view", "u1", { assignedTo: ["u1"] }), true);
  assert.equal(canSee(acc("standard"), "documents.view", "u1", {}), true);
  assert.equal(decide({ status: "revoked", level: "administrator" }, "business.summary").ok, false);
  assert.equal(decide(null, "business.summary").ok, false);
  assert.equal(decide(acc("signatory"), "documents.upload").ok, false);
});

// ------------------------------------------------------------------ rate limiting and setup

test("too many failed sign-ins from one address are slowed down", async () => {
  const h = setup();
  let last;
  for (let i = 0; i < 25; i++) last = await h.call("default", "GET", "me", { headers: { "x-portal-token": "junk" } });
  assert.equal(last.status, 429);
});

test("when the portal isn't set up, staff are told what's missing and clients get a plain message", async () => {
  const { createHandler } = require("../portal/index.js");
  const handler = createHandler({ env: {}, staffAuth: async () => ({ name: "Kevin" }) });
  const run = async (path) => {
    const r = await handler({ bindingData: { path } }, { method: "GET", headers: {}, query: {} });
    return { status: r.status, body: JSON.parse(r.body) };
  };
  const status = await run("admin/status");
  assert.equal(status.body.configured, false);
  assert.ok(status.body.missing.includes("PORTAL_IDP_ISSUER"));
  assert.equal((await run("admin/overview")).status, 503);
  assert.equal((await run("me")).status, 503);
});

test("the public config tells the browser app how to sign in, and nothing secret", async () => {
  const h = setup();
  const r = await h.call("default", "GET", "config");
  assert.equal(r.status, 200);
  assert.equal(r.body.clientId, AUDIENCE);
  assert.equal(r.body.authority, "https://idp.example/tenant/oauth2/v2.0");
  assert.equal(r.body.practiceName, "Bannister & Co");
  assert.equal(JSON.stringify(r.body).includes("audit-secret"), false);
  assert.equal(r.body.dev, undefined);
});
