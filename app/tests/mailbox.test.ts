import test from "node:test";
import assert from "node:assert/strict";
import { FakeGraph } from "../src/lib/fakeGraph";
import { MailItem, applyFilter, bodyDoc, fetchBody, fetchFolders, fetchPage, flagMany, isOutgoing, originOf, setFlag, setRead, toMailItem } from "../src/lib/mailbox";

const clients: any[] = [
  { Key: "C1", Title: "Bright Bakes", Email: "jo@brightbakes.example" },
  { Key: "C2", Title: "Lee Plumbing", Email: "sam@leeplumbing.example" },
  { Key: "C3", Title: "Gmail Gary", Email: "gary@gmail.com" },
];
const contacts: any[] = [{ Key: "P1", Email: "priya@orchardphysio.example" }];
const links: any[] = [{ MemberKey: "P1", ClientKey: "C1" }];
const item = (o: Partial<MailItem> = {}): MailItem => ({
  id: "m", subject: "Hello", from: "Someone", address: "x@y.example", received: "2026-10-22T09:00:00Z", preview: "", isRead: true, flagged: false,
  to: [], toNames: [], hasAttachments: false, folderId: "inbox", ...o,
});

test("folders: Outlook's own first in the usual order, sub-folders under their parent", async () => {
  const f = await fetchFolders(new FakeGraph());
  assert.deepEqual(f.filter((x) => x.depth === 0).map((x) => x.name), ["Inbox", "Drafts", "Sent Items", "Archive", "Deleted Items", "Junk Email", "Receipts"]);
  const i = f.findIndex((x) => x.name === "Archive");
  assert.equal(f[i + 1].name, "Clients 2025");
  assert.equal(f[i + 1].depth, 1);
  assert.equal(f[i + 1].parentId, f[i].id);
  assert.ok(f.find((x) => x.name === "Inbox")!.unread > 0);
});

test("a folder's messages page through, newest first", async () => {
  const g = new FakeGraph();
  const inbox = (await fetchFolders(g)).find((x) => x.name === "Inbox")!;
  const p1 = await fetchPage(g, inbox.id);
  assert.equal(p1.items.length, inbox.total);
  assert.equal(p1.next, undefined);
  const sorted = [...p1.items].sort((a, b) => b.received.localeCompare(a.received));
  assert.deepEqual(p1.items.map((x) => x.id), sorted.map((x) => x.id));
});

test("who a message is from or to is matched to a client, never by name", () => {
  const o = (m: Partial<MailItem>, out = false) => originOf(item(m), out, clients, contacts, links);
  assert.deepEqual(o({ address: "jo@brightbakes.example" }), { clientKey: "C1", by: "address" });
  assert.deepEqual(o({ address: "priya@orchardphysio.example" }), { clientKey: "C1", by: "contact" });
  assert.deepEqual(o({ address: "dan@leeplumbing.example" }), { clientKey: "C2", by: "domain" });
  assert.deepEqual(o({ address: "someone@gmail.com", from: "Gmail Gary" }), {});
  assert.deepEqual(o({ address: "pal@mail.example", from: "Bright Bakes" }), {});
  // in Sent Items it is who it went to
  assert.deepEqual(o({ address: "demo@example.com", to: ["pal@mail.example", "sam@leeplumbing.example"] }, true), { clientKey: "C2", by: "address" });
});

test("filters: clients, unread, flagged and text", () => {
  const list = [
    item({ id: "a", address: "jo@brightbakes.example", isRead: false }),
    item({ id: "b", address: "pal@mail.example", flagged: true, subject: "Lunch" }),
    item({ id: "c", address: "sam@leeplumbing.example", flagged: true }),
  ];
  const origins = new Map(list.map((m) => [m.id, originOf(m, false, clients, contacts, links)]));
  const ids = (f: any, t = "") => applyFilter(list, origins, f, t).map((m) => m.id);
  assert.deepEqual(ids("all"), ["a", "b", "c"]);
  assert.deepEqual(ids("clients"), ["a", "c"]);
  assert.deepEqual(ids("unread"), ["a"]);
  assert.deepEqual(ids("flagged"), ["b", "c"]);
  assert.deepEqual(ids("all", "LUNCH"), ["b"]);
});

test("Sent Items and Drafts are the folders that show who it went to", () => {
  assert.ok(isOutgoing("Sent Items") && isOutgoing("drafts") && isOutgoing("Outbox"));
  assert.ok(!isOutgoing("Inbox") && !isOutgoing("Sent clients"));
});

test("flagging and reading change the message in Outlook", async () => {
  const g = new FakeGraph();
  await setFlag(g, "in-1", true);
  await setRead(g, "in-1", true);
  const me = (await fetchPage(g, "fld-inbox")).items.find((x) => x.id === "in-1")!;
  assert.equal(me.flagged, true);
  assert.equal(me.isRead, true);
  await setFlag(g, "in-1", false);
  assert.equal((await fetchPage(g, "fld-inbox")).items.find((x) => x.id === "in-1")!.flagged, false);
});

test("flag many reports the ones that failed", async () => {
  const g = new FakeGraph();
  const failed = await flagMany(g, ["in-1", "in-6", "nope"]);
  assert.deepEqual(failed, ["nope"]);
  const items = (await fetchPage(g, "fld-inbox")).items;
  assert.ok(items.find((x) => x.id === "in-6")!.flagged);
  assert.deepEqual(await flagMany(g, []), []);
});

test("a message body is shown in a locked-down page with nothing fetched from the internet", async () => {
  const body = await fetchBody(new FakeGraph(), "in-6");
  assert.equal(body.html, true);
  const doc = bodyDoc({ html: true, content: `<p>Hi</p><img src="https://track.example/p.gif"><script>alert(1)</script>`, cc: [] });
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /img-src data:/);
  assert.match(doc, /<base target="_blank">/);
  const text = bodyDoc({ html: false, content: "a < b & c", cc: [] });
  assert.match(text, /a &lt; b &amp; c/);
});

test("raw Graph messages are read safely", () => {
  const x = toMailItem({ id: "z", subject: null, from: { emailAddress: { address: "A@B.example" } }, toRecipients: [{ emailAddress: { name: "Me", address: "ME@X.example" } }], bodyPreview: "  a\n b ", flag: { flagStatus: "flagged" } }, "f");
  assert.equal(x.subject, "(no subject)");
  assert.equal(x.address, "a@b.example");
  assert.deepEqual(x.to, ["me@x.example"]);
  assert.equal(x.preview, "a b");
  assert.equal(x.flagged, true);
});
