import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeGraph } from "../src/lib/fakeGraph";
import { HttpGraph, retryDelay } from "../src/lib/graph";
import { parseBundle, runImport } from "../src/lib/importer";
import { LISTS, toFields, LIST_BY_KEY } from "../src/lib/schema";
import { SharePointStore } from "../src/lib/sharepoint";
import { daysBetween, fmtDate, initials, jobState, recordGaps } from "../src/lib/domain";

async function freshStore() {
  const g = new FakeGraph();
  const s = new SharePointStore(g);
  await s.connect();
  return { g, s };
}

test("setup creates every list once and is safe to run again", async () => {
  const { g, s } = await freshStore();
  await s.ensureSchema();
  assert.equal(g.state.lists.length, LISTS.length);
  const posts = g.calls.filter((c) => c.method === "POST").length;
  await s.ensureSchema();
  assert.equal(g.state.lists.length, LISTS.length);
  assert.equal(g.calls.filter((c) => c.method === "POST").length, posts, "second run created nothing");
});

test("setup adds columns missing from an existing list", async () => {
  const { g, s } = await freshStore();
  await s.ensureSchema();
  const clients = g.state.lists.find((l) => l.displayName === "PP Clients")!;
  clients.columns = clients.columns.filter((c) => c.name !== "LogoUrl");
  const status = await s.checkSchema();
  assert.deepEqual(status.find((x) => x.list.key === "Clients")!.missingColumns, ["LogoUrl"]);
  await s.ensureSchema();
  assert.ok(clients.columns.some((c) => c.name === "LogoUrl"));
});

test("rows round-trip with types, and reads page through large lists", async () => {
  const { s } = await freshStore();
  await s.ensureSchema();
  const rows = Array.from({ length: 1234 }, (_, i) => ({
    Key: `H${i}`, Title: `Job ${i}`, ClientKey: "C1", BudgetHours: i % 3 ? 1.5 : undefined, Completed: "2026-01-31",
  }));
  const res = await s.createMany("JobHistory", rows);
  assert.equal(res.failed, 0);
  const back = await s.readAll("JobHistory");
  assert.equal(back.length, 1234);
  const one = back.find((r) => r.Key === "H1")!;
  assert.equal(one.BudgetHours, 1.5);
  assert.equal(one.Completed, "2026-01-31");
  assert.equal(back.find((r) => r.Key === "H0")!.BudgetHours, undefined);
});

test("update saves changes and clears emptied fields", async () => {
  const { s } = await freshStore();
  await s.ensureSchema();
  const c = await s.create("Clients", { Key: "C1", Title: "Acme Ltd", Email: "a@b.com", AnnualFees: 100 });
  await s.update("Clients", c._id!, { Email: "", Mobile: "07000 000000", AnnualFees: "" as any });
  const [back] = await s.readAll("Clients");
  assert.equal(back.Email, undefined);
  assert.equal(back.Mobile, "07000 000000");
  assert.equal(back.AnnualFees, undefined);
});

test("toFields drops unknown and empty values and coerces types", () => {
  const f = toFields(LIST_BY_KEY.Clients, { Key: "C1", Title: "X", Nope: "y", Email: "", AnnualFees: "12.5", CHChecked: "True" } as any);
  assert.deepEqual(f, { Title: "X", Key: "C1", AnnualFees: 12.5, CHChecked: true });
});

test("import loads a bundle in order and skips rows already there", async () => {
  const { s } = await freshStore();
  await s.ensureSchema();
  const bundle = parseBundle(JSON.stringify({
    format: "practice-planner-import", version: 1, created: "2026-10-08",
    lists: {
      Clients: [{ Key: "C1", Title: "Acme Ltd" }, { Key: "C2", Title: "Jane Smith" }],
      Jobs: [{ Key: "J1", Title: "VAT return", ClientKey: "C1", Deadline: "2026-11-07" }],
    },
  }));
  const first = await runImport(s, bundle, () => {});
  assert.deepEqual(first.map((x) => [x.list, x.created, x.skipped]), [["Clients", 2, 0], ["Jobs", 1, 0]]);
  const second = await runImport(s, bundle, () => {});
  assert.deepEqual(second.map((x) => [x.list, x.created, x.skipped]), [["Clients", 0, 2], ["Jobs", 0, 1]]);
  assert.equal((await s.readAll("Clients")).length, 2);
});

test("import rejects files that aren't bundles", () => {
  assert.throws(() => parseBundle("{nope"), /isn't valid JSON/);
  assert.throws(() => parseBundle(JSON.stringify({ format: "x" })), /isn't a Practice Planner import bundle/);
  assert.throws(
    () => parseBundle(JSON.stringify({ format: "practice-planner-import", version: 1, lists: { Clients: [{ Title: "x" }] } })),
    /needs a Key/,
  );
});

test("HttpGraph retries throttled requests and batch items", async () => {
  const fake = new FakeGraph();
  fake.throttleNext = 3;
  let throttledOnce = false;
  const waits: number[] = [];
  const fetchStub = async (url: string, init: RequestInit) => {
    if (!throttledOnce && url.endsWith("/lists?$select=id,displayName")) {
      throttledOnce = true;
      return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
    }
    const path = url.replace("https://graph.microsoft.com/v1.0", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const method = init.method || "GET";
    const json = method === "GET" ? await fake.get(path) : method === "POST" ? await fake.post(path, body) : await fake.patch(path, body);
    return new Response(JSON.stringify(json ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const http = new HttpGraph(async () => "token", fetchStub, async (ms) => void waits.push(ms));
  const s = new SharePointStore(http);
  await s.connect();
  assert.equal(waits[0], 2000, "honoured Retry-After");
  await s.ensureSchema();
  const rows = Array.from({ length: 45 }, (_, i) => ({ Key: `C${i}`, Title: `Client ${i}` }));
  const res = await s.createMany("Clients", rows);
  assert.equal(res.failed, 0);
  assert.equal((await s.readAll("Clients")).length, 45, "throttled items were retried, none lost or doubled");
});

test("retryDelay uses Retry-After or backs off", () => {
  assert.equal(retryDelay("5", 0), 5000);
  assert.equal(retryDelay(null, 0), 1000);
  assert.equal(retryDelay(null, 3), 8000);
  assert.equal(retryDelay(null, 10), 30000);
});

test("date and flag helpers", () => {
  assert.equal(daysBetween("2026-10-08", "2026-10-31"), 23);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2, "clock change doesn't break day counts");
  assert.equal(fmtDate("2026-10-31"), "31 Oct 2026");
  assert.equal(fmtDate("2026-10-13", { weekday: true, year: false }), "Tue 13 Oct");
  const base = { Key: "J", Title: "x", ClientKey: "C" };
  assert.equal(jobState({ ...base, Deadline: "2026-10-01" }, "2026-10-08").state, "overdue");
  assert.equal(jobState({ ...base, Deadline: "2026-10-20" }, "2026-10-08").state, "tight");
  assert.equal(jobState({ ...base, Deadline: "2027-01-31" }, "2026-10-08").state, "ok");
  assert.equal(jobState({ ...base, Deadline: "2027-01-31", PlannedDate: "2027-01-25" }, "2026-10-08").state, "tight");
  assert.equal(initials("Fired Up BBQ Global Ltd"), "FU");
  assert.equal(initials("Jane Smith"), "JS");
  assert.deepEqual(recordGaps({ Key: "C", Title: "A Ltd", Kind: "Ltd", Email: "x" } as any, new Set(["VAT"])), [
    "Company number", "Companies House auth code", "Corporation tax UTR", "VAT number",
  ]);
});

import { fitWithin, logoSrc } from "../src/lib/logo";

test("logos: shrink to fit without stretching or enlarging, uploaded logo wins", () => {
  assert.deepEqual(fitWithin(1200, 400), { w: 360, h: 120 });
  assert.deepEqual(fitWithin(500, 500), { w: 144, h: 144 });
  assert.deepEqual(fitWithin(100, 40), { w: 100, h: 40 });
  assert.equal(logoSrc({ LogoData: "data:image/png;base64,AAA", LogoUrl: "https://x/logo.png" }), "data:image/png;base64,AAA");
  assert.equal(logoSrc({ LogoUrl: "https://x/logo.png" }), "https://x/logo.png");
  assert.equal(logoSrc({}), undefined);
});
