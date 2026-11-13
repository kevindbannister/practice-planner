import test from "node:test";
import assert from "node:assert/strict";
import { buildActions, filedAtCH } from "../src/lib/actions";
import { DEFAULT_ENGAGEMENT_SETTINGS } from "../src/lib/engagements";

const TODAY = "2026-11-13";
const llp = (accTo: string) => ({ Key: "C1", Title: "Manic Paintball Europe LLP", Manager: "Mo", CompanyNumber: "OC123456", CHVerified: JSON.stringify({ accTo }) });
const src = (o: any = {}): any => ({
  today: TODAY, clients: [llp("2027-03-31")], jobs: [], tasks: [], leads: [], opps: [], firstStageKey: "new", proposals: [], versions: [], engagements: [], onboardings: [],
  viewFor: () => undefined, clientServices: [], portal: [], eng: DEFAULT_ENGAGEMENT_SETTINGS, catalogue: [], ch: [], agentDone: () => false,
  services: [{ Key: "ACCS_LLP", ServiceKey: "ACCS_LLP" }], stageTemplates: [], ...o,
});
const job = (o: any = {}) => ({ Key: "J1", ClientKey: "C1", Title: "LLP accounts 31 Mar 2026", ServiceKey: "ACCS_LLP", PeriodEnd: "2026-03-31", Deadline: "2026-09-30", StageNo: 1, Status: "Open", ...o });

test("accounts already filed at Companies House raise no overdue item, only one low dismissible housekeeping item", () => {
  const a = buildActions(src({ jobs: [job()] }));
  assert.equal(a.find((x) => x.key === "job:J1"), undefined);
  const h = a.filter((x) => x.key.startsWith("job:filed:"));
  assert.equal(h.length, 1); assert.equal(h[0].priority, "low"); assert.equal(h[0].dismissible, true);
});
test("not filed (Companies House still on that year): the overdue item stays", () => {
  const a = buildActions(src({ clients: [llp("2026-03-31")], jobs: [job()] }));
  assert.equal(a.find((x) => x.key === "job:J1")?.priority, "high");
  assert.equal(filedAtCH(llp("2026-03-31"), job() as any), false);
});
test("a year end that just passed gives one records review per client, for the latest year end only", () => {
  const jobs = [job({ Key: "J2", PeriodEnd: "2026-10-31", Deadline: "2027-07-31", Title: "Year to Oct" }), job({ Key: "J3", PeriodEnd: "2026-09-30", Deadline: "2027-06-30", Title: "Older" })];
  const a = buildActions(src({ clients: [llp("2025-10-31")], jobs, services: [{ ServiceKey: "ACCS_LLP" }] }));
  const y = a.filter((x) => x.key.startsWith("yearend:"));
  assert.equal(y.length, 1); assert.match(y[0].key, /2026-10-31/); assert.equal(y[0].href, "#/chase");
});
test("no review prompt when records are in, recently chased, or the year end is long gone", () => {
  const c = [llp("2025-10-31")];
  assert.equal(buildActions(src({ clients: c, jobs: [job({ PeriodEnd: "2026-10-31", Deadline: "2027-07-31", RecordsReceived: "2026-11-05" })] })).some((x) => x.key.startsWith("yearend:")), false);
  assert.equal(buildActions(src({ clients: c, jobs: [job({ PeriodEnd: "2026-10-31", Deadline: "2027-07-31", LastChased: "2026-11-10" })] })).some((x) => x.key.startsWith("yearend:")), false);
  assert.equal(buildActions(src({ clients: c, jobs: [job({ PeriodEnd: "2026-06-30", Deadline: "2027-03-31" })] })).some((x) => x.key.startsWith("yearend:")), false);
});
