import test from "node:test";
import assert from "node:assert/strict";
import { Sources, buildTimeline, changeEvents, createdEvent, filterActivities, forAssistant, groupByDay, mailActivities, mailChoice, summarise, MailMsg } from "../src/lib/timeline";

const empty = (): Sources => ({ comms: [], documents: [], meetings: [], jobs: [], history: [], tasks: [], papers: [], paperLines: [], taxPayments: [], activities: [], serviceName: new Map([["ACCS_LTD", "Limited company accounts"]]) });
const C = "c1";
const now = new Date("2026-10-24T12:00:00Z");

test("builds one timeline from the app's own records, newest first", () => {
  const s = empty();
  s.comms = [
    { Key: "m1", ClientKey: C, Kind: "letter", Status: "word", Subject: "Engagement", Created: "2026-10-01T09:00:00.000Z", FileUrl: "https://f" },
    { Key: "m2", ClientKey: C, Kind: "email", Status: "outlook", Subject: "Records", Updated: "2026-10-05T10:00:00.000Z", ToEmail: "a@b.co" },
    { Key: "m3", ClientKey: "other", Kind: "letter", Subject: "Not mine", Created: "2026-10-02T09:00:00.000Z" },
  ];
  s.documents = [{ Key: "d1", ClientKey: C, Title: "Fee proposal", Created: "2026-10-10T08:00:00.000Z", SentOn: "2026-10-11T08:00:00.000Z", TemplateName: "Fee", TemplateVersion: 2, Pages: 2 }];
  s.meetings = [{ Key: "mt1", ClientKey: C, Kind: "call", When: "2026-10-12T14:00:00", Title: "Year end call", Summary: "Agreed dates" }];
  s.jobs = [{ Key: "j1", ClientKey: C, ServiceKey: "ACCS_LTD", Title: "Accounts", CompletedDate: "2026-10-20", ChaseLog: "3 October 2026: chased by email\n1 October 2026: chased by phone", RecordsReceived: "2026-10-04" }];
  s.tasks = [{ Key: "t1", ClientKey: C, Title: "Send reminder", Status: "Done", CompletedDate: "2026-10-15" }, { Key: "t2", ClientKey: C, Title: "Open task", Status: "Open" }];
  const t = buildTimeline(C, s, now);
  assert.deepEqual(t.map((a) => a.id), ["job:j1:completed", "task:t1:completed", "meeting:mt1", "doc:d1:sent", "doc:d1:created", "comm:m2:draft", "job:j1:records", "job:j1:chase:2026-10-03:email", "job:j1:chase:2026-10-01:phone", "comm:m1:letter"]);
  assert.ok(t.every((a) => a.clientKey === C));
  assert.ok(t.every((x, i) => i === 0 || t[i - 1].at >= x.at));
  assert.equal(t.find((a) => a.id === "meeting:mt1")?.type, "call");
  assert.equal(t.find((a) => a.id === "doc:d1:created")?.href, "#/comms/documents/history");
  assert.ok(!t.some((a) => a.sourceKey === "m3"));
  assert.equal(new Set(t.map((a) => a.id)).size, t.length);
});

test("building twice, or from duplicated rows, never repeats an event", () => {
  const s = empty();
  const row = { Key: "t1", ClientKey: C, Title: "x", Status: "Done", CompletedDate: "2026-10-15" };
  s.tasks = [row, { ...row }];
  assert.equal(buildTimeline(C, s, now).length, 1);
});

test("working papers: sign-offs, trial balance imports in one event per day, notes and resolution", () => {
  const s = empty();
  s.jobs = [{ Key: "j1", ClientKey: C, ServiceKey: "ACCS_LTD", PeriodEnd: "2026-09-30" }];
  s.papers = [{ ClientKey: C, PeriodEnd: "2026-09-30", ItemKey: "draft-accounts/main", PreparedOn: "2026-10-18", PreparedBy: "KB" }, { ClientKey: C, PeriodEnd: "2026-09-30", ItemKey: "review-accounts/main", ReviewedOn: "2026-10-19", ReviewedBy: "AB" }];
  s.paperLines = [
    ...Array.from({ length: 40 }, (_, i) => ({ Key: `l${i}`, ClientKey: C, PeriodEnd: "2026-09-30", SectionKey: "tb", SubKey: "main", Updated: "2026-10-17T10:00:00.000Z" })),
    { Key: "n1", ClientKey: C, PeriodEnd: "2026-09-30", SectionKey: "review-notes", Detail: "Check the loan", Done: true, Updated: "2026-10-19T09:00:00.000Z" },
    { Key: "n2", ClientKey: C, PeriodEnd: "2026-09-30", SectionKey: "queries", Detail: "What is this payment?", Done: false, Updated: "2026-10-18T09:00:00.000Z" },
  ];
  const t = buildTimeline(C, s, now);
  const types = t.map((a) => a.type);
  assert.equal(types.filter((x) => x === "paper-tb").length, 1);
  assert.match(t.find((a) => a.type === "paper-tb")!.title, /40 lines/);
  assert.ok(types.includes("paper-prepared") && types.includes("paper-reviewed") && types.includes("paper-note") && types.includes("paper-note-resolved") && types.includes("query"));
  assert.equal(t.find((a) => a.type === "paper-prepared")?.jobKey, "j1");
});

function msg(o: Partial<MailMsg>): MailMsg {
  return { id: "x", subject: "S", preview: "p", at: "2026-10-20T09:00:00Z", folder: "inbox", fromName: "Al", fromAddress: "al@client.co", to: ["me@practice.co"], hasAttachments: false, ...o };
}
const clients = [
  { Key: "c1", Title: "One Ltd", Email: "al@one.co; shared@family.co" },
  { Key: "c2", Title: "Two Ltd", Email: "bo@two.co; shared@family.co" },
  { Key: "c3", Title: "Three", Email: "x@three.co" },
] as never[];

test("email linking: own address links, shared address and domain-only need confirming", () => {
  const ov: never[] = [];
  assert.equal(mailChoice(msg({ fromAddress: "al@one.co" }), "c1", clients, [], [], ov), "linked");
  assert.equal(mailChoice(msg({ fromAddress: "al@one.co" }), "c2", clients, [], [], ov), "none");
  assert.equal(mailChoice(msg({ fromAddress: "shared@family.co" }), "c1", clients, [], [], ov), "confirm");
  assert.equal(mailChoice(msg({ fromAddress: "shared@family.co" }), "c2", clients, [], [], ov), "confirm");
  assert.equal(mailChoice(msg({ fromAddress: "colleague@one.co" }), "c1", clients, [], [], ov), "confirm");
  assert.equal(mailChoice(msg({ fromAddress: "someone@gmail.com" }), "c1", clients, [], [], ov), "none");
  assert.equal(mailChoice(msg({ fromAddress: "Al Smith <nobody@nowhere.example>" }), "c1", clients, [], [], ov), "none");
});

test("email linking: a person's choice overrides, can move a message, and sent mail uses the recipient", () => {
  const m = msg({ id: "m9", fromAddress: "shared@family.co" });
  const link = (client: string, status: string, at = "1") => ({ Type: "email-link", SourceKey: "m9", ClientKey: client, Status: status, Created: at });
  assert.equal(mailChoice(m, "c1", clients, [], [], [link("c1", "linked")] as never), "linked");
  assert.equal(mailChoice(m, "c2", clients, [], [], [link("c1", "linked")] as never), "none");
  assert.equal(mailChoice(m, "c1", clients, [], [], [link("c1", "linked", "1"), link("c1", "unlinked", "2")] as never), "none");
  const wrong = msg({ id: "m8", fromAddress: "al@one.co" });
  assert.equal(mailChoice(wrong, "c1", clients, [], [], [{ Type: "email-link", SourceKey: "m8", ClientKey: "c1", Status: "unlinked", Created: "1" }] as never), "none");
  assert.equal(mailChoice(msg({ folder: "sent", to: ["al@one.co"] }), "c1", clients, [], [], []), "linked");
});

test("mail events: drafts are skipped, duplicates collapse, no bodies, confirm list returned", () => {
  const msgs = [msg({ id: "a", fromAddress: "al@one.co", subject: "Hello" }), msg({ id: "a", fromAddress: "al@one.co" }), msg({ id: "b", folder: "sent", to: ["al@one.co"], subject: "Re" }), msg({ id: "d", folder: "draft", to: ["al@one.co"] }), msg({ id: "c", fromAddress: "shared@family.co" })];
  const r = mailActivities("c1", msgs, clients, [], [], []);
  assert.deepEqual(r.events.map((e) => e.id).sort(), ["mail:a", "mail:b"]);
  assert.deepEqual(r.confirm.map((m) => m.id), ["c"]);
  assert.equal(r.events.find((e) => e.id === "mail:a")?.type, "email-in");
  assert.equal(r.events.find((e) => e.id === "mail:b")?.type, "email-out");
});

test("only meaningful job changes are recorded, once", () => {
  const o = { actor: "KB", now: "2026-10-24T10:00:00.000Z", newKey: (p: string) => p + "1" };
  const job = { Key: "j1", ClientKey: C, Title: "Accounts", Status: "Open", PlannedDate: "2026-10-30", Notes: "a" };
  assert.equal(changeEvents("Jobs", job, { Notes: "typing" }, o).length, 0);
  assert.equal(changeEvents("Jobs", job, { PlannedDate: "2026-10-30" }, o).length, 0);
  assert.equal(changeEvents("Tasks", job, { Status: "Done" }, o).length, 0);
  const ev = changeEvents("Jobs", job, { PlannedDate: "2026-11-02", Status: "Waiting" }, o);
  assert.deepEqual(ev.map((e) => e.Type).sort(), ["job-planned", "job-status"]);
  assert.match(String(ev.find((e) => e.Type === "job-planned")!.Title), /02\/11\/2026/);
  assert.equal(changeEvents("Jobs", job, { Status: "Complete" }, o).length, 0);
  const again = changeEvents("Jobs", job, { PlannedDate: "2026-11-02" }, o);
  assert.equal(again[0].EventKey, ev.find((e) => e.Type === "job-planned")!.EventKey);
  assert.equal(createdEvent("Tasks", { Key: "t9", ClientKey: C, Title: "New" }, o)?.EventKey, "created:Tasks:t9");
  assert.equal(createdEvent("Jobs", { Key: "j9" }, o), undefined);
});

test("stored entries show; email-link rows do not; activity events dedupe by event key", () => {
  const s = empty();
  s.activities = [
    { Key: "a1", ClientKey: C, Type: "call", Title: "Rang about VAT", At: "2026-10-22T10:00:00.000Z", Source: "manual", Actor: "KB", Visibility: "confidential", FollowUp: "2026-10-30" },
    { Key: "a2", ClientKey: C, Type: "email-link", SourceKey: "m1", Status: "linked", Created: "1" },
    { Key: "a3", ClientKey: C, Type: "job-planned", Title: "p", At: "2026-10-23T10:00:00.000Z", Source: "jobs", EventKey: "same" },
    { Key: "a4", ClientKey: C, Type: "job-planned", Title: "p", At: "2026-10-23T11:00:00.000Z", Source: "jobs", EventKey: "same" },
  ];
  const t = buildTimeline(C, s, now);
  assert.equal(t.length, 2);
  const call = t.find((a) => a.type === "call")!;
  assert.ok(call.manual && call.confidential && call.followUp === "2026-10-30" && call.rowKey === "a1");
});

test("filters: group, job, dates, text, confidential", () => {
  const s = empty();
  s.activities = [
    { Key: "a1", ClientKey: C, Type: "call", Title: "Rang about VAT", At: "2026-10-22T10:00:00.000Z", Source: "manual", JobKey: "j1" },
    { Key: "a2", ClientKey: C, Type: "note", Title: "Private", At: "2026-10-21T10:00:00.000Z", Source: "manual", Visibility: "confidential" },
    { Key: "a3", ClientKey: C, Type: "info-requested", Title: "Bank statements", At: "2026-09-01T10:00:00.000Z", Source: "manual", Status: "Open" },
  ];
  const t = buildTimeline(C, s, now);
  assert.equal(filterActivities(t, { group: "notes" }).length, 2);
  assert.equal(filterActivities(t, { group: "requests" }).length, 1);
  assert.equal(filterActivities(t, { jobKey: "j1" }).length, 1);
  assert.equal(filterActivities(t, { from: "2026-10-01", to: "2026-10-21" }).length, 1);
  assert.equal(filterActivities(t, { q: "bank" }).length, 1);
  assert.equal(filterActivities(t, { includeConfidential: false }).length, 2);
});

test("grouping by day and the summary strip", () => {
  const s = empty();
  s.activities = [
    { Key: "a1", ClientKey: C, Type: "call", Title: "Call", At: "2026-10-24T09:00:00.000Z", Source: "manual", FollowUp: "2026-10-28" },
    { Key: "a2", ClientKey: C, Type: "email-in", Title: "x", At: "2026-10-24T08:00:00.000Z", Source: "manual" },
    { Key: "a3", ClientKey: C, Type: "note", Title: "y", At: "2026-10-23T08:00:00.000Z", Source: "manual" },
    { Key: "a4", ClientKey: C, Type: "info-requested", Title: "Need bank statements", At: "2026-10-20T08:00:00.000Z", Source: "manual", Status: "Open" },
    { Key: "a5", ClientKey: C, Type: "query", Title: "Is this allowable?", At: "2026-10-19T08:00:00.000Z", Source: "manual", Status: "Open" },
  ];
  s.jobs = [{ Key: "j1", ClientKey: C, Title: "Accounts", Status: "Open", PlannedDate: "2026-10-26" }];
  s.tasks = [{ Key: "t1", ClientKey: C, Title: "Late", Status: "Open", DueDate: "2026-10-01" }, { Key: "t2", ClientKey: C, Title: "Fine", Status: "Open", DueDate: "2026-12-01" }];
  const t = buildTimeline(C, s, now);
  const g = groupByDay(t, "2026-10-24");
  assert.deepEqual(g.map((x) => x.items.length), [2, 1, 1, 1]);
  assert.match(g[0].label, /^Today/);
  assert.match(g[1].label, /^Yesterday/);
  const sum = summarise(C, t, s, "2026-10-24");
  assert.equal(sum.lastContact?.type, "call");
  assert.equal(sum.nextAction?.date, "2026-10-26");
  assert.equal(sum.openRequests.length, 1);
  assert.equal(sum.overdueTasks.length, 1);
  assert.equal(sum.activeJobs.length, 1);
  assert.equal(sum.openQueries.length, 1);
});

test("assistant view leaves out confidential entries and old ones, and carries no bodies", () => {
  const s = empty();
  s.activities = [
    { Key: "a1", ClientKey: C, Type: "call", Title: "Call", Summary: "short", At: "2026-10-22T10:00:00.000Z", Source: "manual" },
    { Key: "a2", ClientKey: C, Type: "note", Title: "Secret", At: "2026-10-21T10:00:00.000Z", Source: "manual", Visibility: "confidential" },
    { Key: "a3", ClientKey: C, Type: "note", Title: "Old", At: "2026-01-01T10:00:00.000Z", Source: "manual" },
  ];
  const out = forAssistant(buildTimeline(C, s, now), { days: 30, today: "2026-10-24" });
  assert.deepEqual(out.map((x) => x.title), ["Call"]);
  assert.ok(!("body" in out[0]));
  assert.equal(forAssistant(buildTimeline(C, s, now), { today: "2026-10-24", includeConfidential: true }).length, 3);
});

test("a large history stays quick and ordered", () => {
  const s = empty();
  s.comms = Array.from({ length: 6000 }, (_, i) => ({ Key: `k${i}`, ClientKey: C, Kind: "letter", Subject: `Letter ${i}`, Created: new Date(Date.UTC(2020, 0, 1) + i * 3600000).toISOString() }));
  const start = Date.now();
  const t = buildTimeline(C, s, now);
  assert.equal(t.length, 6000);
  assert.ok(Date.now() - start < 1500);
  assert.equal(filterActivities(t, { q: "letter 59" }).length, 111);
  assert.ok(t[0].at > t[5999].at);
});

import { fetchClientMail } from "../src/lib/timelineMail";
test("Outlook search results become light messages: no bodies, drafts flagged, duplicates merged", async () => {
  const raw = (id: string, o: object = {}) => ({ id, subject: "S", bodyPreview: "  a   preview ", receivedDateTime: "2026-10-01T09:00:00Z", from: { emailAddress: { name: "Al", address: "AL@one.co" } }, toRecipients: [{ emailAddress: { address: "me@p.co" } }], body: { content: "SECRET BODY" }, ...o });
  const calls: string[] = [];
  const graph = { get: async (p: string) => { calls.push(p); return { value: [raw("1"), raw("1"), raw("2", { isDraft: true, from: { emailAddress: { address: "me@p.co" } }, toRecipients: [{ emailAddress: { address: "al@one.co" } }] }), raw("3", { from: { emailAddress: { address: "me@p.co" } }, toRecipients: [{ emailAddress: { address: "al@one.co" } }] })] }; } } as never;
  const out = await fetchClientMail(graph, ["al@one.co"]);
  assert.deepEqual(out.map((m) => [m.id, m.folder]).sort(), [["1", "inbox"], ["2", "draft"], ["3", "sent"]]);
  assert.equal(out[0].preview, "a preview");
  assert.ok(!JSON.stringify(out).includes("SECRET"));
  assert.match(decodeURIComponent(calls[0]), /participants:al@one\.co/);
});
