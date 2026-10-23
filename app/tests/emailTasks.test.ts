import test from "node:test";
import assert from "node:assert/strict";
import { Mail, applyVerdicts, aiPayload, clientOf, pruneHandled, scoreMail, suggest, taskFromSuggestion } from "../src/lib/emailTasks";

const clients: any[] = [{ Key: "C1", Title: "Acme Ltd", Email: "bob@acme.example" }];
const contacts: any[] = [{ Key: "P1", Email: "sue@acme.example" }];
const links: any[] = [{ MemberKey: "P1", ClientKey: "C1" }];
const m = (o: Partial<Mail> = {}): Mail => ({ id: "m1", subject: "Hello", from: "Someone", address: "x@y.example", received: "2026-10-22T09:00:00Z", preview: "", isRead: true, flagged: false, ...o });

test("sender matched to a client by email, never by name", () => {
  assert.equal(clientOf("BOB@acme.example", clients, contacts, links), "C1");
  assert.equal(clientOf("sue@acme.example", clients, contacts, links), "C1");
  assert.equal(clientOf("bob@other.example", clients, contacts, links), undefined);
});
test("automatic mail is never suggested", () => {
  assert.ok(scoreMail(m({ address: "noreply@shop.example", preview: "please confirm" })).score < 0);
  assert.ok(scoreMail(m({ subject: "Our newsletter" }), "C1").score < 0);
});
test("clients asking for something are suggested; chatter isn't", () => {
  const list = suggest([
    m({ id: "a", address: "bob@acme.example", subject: "VAT query", preview: "Can you let me know by Friday" }),
    m({ id: "b", subject: "Lunch?", preview: "fancy a bite" }),
    m({ id: "c", flagged: true, subject: "Quote" }),
    m({ id: "d", address: "bob@acme.example", subject: "Thanks" }),
  ], clients, contacts, {}, links);
  assert.deepEqual(list.map((s) => s.mail.id), ["a", "c"]);
  assert.match(list[0].title, /Acme Ltd: VAT query/);
});
test("handled mail doesn't come back", () => assert.equal(suggest([m({ id: "a", flagged: true })], clients, contacts, { a: { how: "dismissed", on: "2026-10-22" } }).length, 0));
test("AI verdicts can drop or refine", () => {
  const l = suggest([m({ id: "a", flagged: true }), m({ id: "b", flagged: true })], clients, contacts, {});
  const out = applyVerdicts(l, [{ id: "a", needsAction: false }, { id: "b", needsAction: true, title: "Send bank statements", due: "2026-10-30", hours: 1 }]);
  assert.equal(out.length, 1); assert.equal(out[0].title, "Send bank statements"); assert.equal(out[0].hours, 1);
});
test("AI gets sender names only when allowed, and only short previews", () => {
  const l = suggest([m({ id: "a", address: "bob@acme.example", from: "Bob", preview: "x".repeat(900), subject: "q?" , flagged: true })], clients, contacts, {});
  const off: any = aiPayload(l, clients, false)[0], on: any = aiPayload(l, clients, true)[0];
  assert.equal(off.from, undefined); assert.equal(off.client, "C1"); assert.equal(on.client, "Acme Ltd"); assert.ok(on.preview.length <= 240);
});
test("task from a suggestion, and pruning", () => {
  const [s] = suggest([m({ id: "a", address: "bob@acme.example", flagged: true, subject: "Hi", link: "https://o/1" })], clients, contacts, {});
  const t = taskFromSuggestion(s, clients, "2026-10-26", "T1");
  assert.equal(t.ClientName, "Acme Ltd"); assert.equal(t.PlannedDate, "2026-10-26"); assert.match(String(t.Notes), /https:\/\/o\/1/);
  assert.deepEqual(Object.keys(pruneHandled({ a: { how: "added", on: "2026-01-01" }, b: { how: "added", on: "2026-10-20" } }, "2026-10-23")), ["b"]);
});

test("a colleague at the client's company counts; gmail and shared domains don't", async () => {
  const { matchClient } = await import("../src/lib/emailTasks");
  const cs: any[] = [{ Key: "C1", Title: "Acme Ltd", Email: "bob@acme.example" }, { Key: "C2", Title: "Jo", Email: "jo@gmail.com" }, { Key: "C3", Title: "Shared A", Email: "a@shared.example" }, { Key: "C4", Title: "Shared B", Email: "b@shared.example" }];
  assert.deepEqual(matchClient("finance@acme.example", cs), { key: "C1", by: "domain" });
  assert.equal(matchClient("someone@gmail.com", cs), undefined);
  assert.equal(matchClient("x@shared.example", cs), undefined);
  assert.deepEqual(matchClient("jo@gmail.com", cs), { key: "C2", by: "address" });
});
