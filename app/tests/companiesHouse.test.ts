// Companies House comparisons, with made-up companies.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ChProfile, chAddress, chDeadlines, chNumber, compareCompany, people, personName, reconcile, sameAddress, sameName, tidyName,
} from "../src/lib/companiesHouse";
import { Client, Job } from "../src/lib/domain";

const client: Client = { Key: "C1", Title: "Acme Widgets Ltd", Kind: "Ltd", CompanyNumber: "1234567", RegisteredOffice: "1 High Street, Townville, TV1 1AA" };
const accs: Job = { Key: "J1", Title: "Limited company accounts", ClientKey: "C1", ServiceKey: "ACCS_LTD", PeriodEnd: "2026-03-31", Deadline: "2026-12-31", StageNo: 2 };
const cs01: Job = { Key: "J2", Title: "Confirmation statement", ClientKey: "C1", ServiceKey: "CS01", PeriodEnd: "2027-01-10", Deadline: "2027-01-24" };

function profile(over: Partial<ChProfile> = {}): ChProfile {
  return {
    company_name: "ACME WIDGETS LIMITED",
    company_status: "active",
    registered_office_address: { address_line_1: "1 High Street", locality: "Townville", postal_code: "TV1 1AA", country: "England" },
    accounts: { next_made_up_to: "2026-03-31", next_due: "2026-12-31", overdue: false, last_accounts: { made_up_to: "2025-03-31" } },
    confirmation_statement: { next_made_up_to: "2027-01-10", next_due: "2027-01-24", last_made_up_to: "2026-01-10" },
    ...over,
  };
}
const types = (ps: { type: string }[]) => ps.map((p) => p.type).sort();

test("a company that agrees with the planner raises nothing", () => {
  assert.deepEqual(compareCompany({ client, profile: profile(), jobs: [accs, cs01] }), []);
});

test("accounts filed while the job is open: complete it and set up the next from Companies House", () => {
  const p = profile({ accounts: { last_accounts: { made_up_to: "2026-03-31" }, next_made_up_to: "2027-03-31", next_due: "2027-12-31" } });
  const [f] = compareCompany({ client, profile: p, jobs: [accs, cs01] });
  assert.equal(f.type, "filed");
  assert.equal(f.jobKey, "J1");
  assert.deepEqual(f.action, { do: "complete", jobKey: "J1", next: { PeriodEnd: "2027-03-31", Deadline: "2027-12-31" } });
});

test("filed, but the next job already exists: just complete the old one", () => {
  const p = profile({ accounts: { last_accounts: { made_up_to: "2026-03-31" }, next_made_up_to: "2027-03-31", next_due: "2027-12-31" } });
  const next = { ...accs, Key: "J9", PeriodEnd: "2027-03-31", Deadline: "2027-12-31" };
  const out = compareCompany({ client, profile: p, jobs: [accs, next, cs01] });
  assert.deepEqual(types(out), ["filed"]);
  assert.deepEqual(out[0].action, { do: "complete", jobKey: "J1", next: undefined });
});

test("dates that differ are offered as an update", () => {
  const p = profile({ confirmation_statement: { next_made_up_to: "2027-01-10", next_due: "2027-01-31", last_made_up_to: "2026-01-10" } });
  const [f] = compareCompany({ client, profile: p, jobs: [accs, cs01] });
  assert.equal(f.type, "dates");
  assert.deepEqual(f.action, { do: "dates", jobKey: "J2", PeriodEnd: "2027-01-10", Deadline: "2027-01-31" });
  assert.match(f.detail, /deadline 24 Jan 2027 → 31 Jan 2027/);
});

test("a filing with no job in the planner offers to add one", () => {
  const [f] = compareCompany({ client, profile: profile(), jobs: [accs] });
  assert.equal(f.type, "missing");
  assert.deepEqual(f.action, { do: "create", serviceKey: "CS01", PeriodEnd: "2027-01-10", Deadline: "2027-01-24" });
  const llp = { ...client, Kind: "LLP" };
  const [g] = compareCompany({ client: llp, profile: profile(), jobs: [cs01] });
  assert.deepEqual(g.action, { do: "create", serviceKey: "ACCS_LLP", PeriodEnd: "2026-03-31", Deadline: "2026-12-31" });
});

test("planner moved on but Companies House hasn't had the filing", () => {
  const ahead = { ...accs, PeriodEnd: "2027-03-31", Deadline: "2027-12-31" };
  const out = compareCompany({ client, profile: profile(), jobs: [ahead, cs01] });
  assert.deepEqual(types(out), ["not-filed"]);
  assert.equal(out[0].severity, "red");
});

test("strike-off and overdue are flagged; dissolved companies skip the date checks", () => {
  const p = profile({ company_status_detail: "active-proposal-to-strike-off", accounts: { ...profile().accounts, overdue: true } });
  assert.deepEqual(types(compareCompany({ client, profile: p, jobs: [accs, cs01] })), ["overdue", "status"]);
  const gone = compareCompany({ client, profile: profile({ company_status: "dissolved" }), jobs: [] });
  assert.deepEqual(types(gone), ["status"]);
  assert.equal(gone[0].title, "Status: Dissolved");
});

test("registered office and name", () => {
  const moved = profile({ registered_office_address: { premises: "Unit 4", address_line_1: "Park Way", locality: "Newtown", postal_code: "NT2 2BB" } });
  const [f] = compareCompany({ client, profile: moved, jobs: [accs, cs01] });
  assert.equal(f.type, "office");
  assert.deepEqual(f.action, { do: "client", patch: { RegisteredOffice: "Unit 4 Park Way, Newtown, NT2 2BB" } });
  const renamed = compareCompany({ client, profile: profile({ company_name: "ACME GADGETS LIMITED" }), jobs: [accs, cs01] });
  assert.deepEqual(renamed[0].action, { do: "client", patch: { Title: "Acme Gadgets Limited" } });
});

test("officer changes only after a first look", () => {
  const officers = ["Jane Smith (director)", "Sam Jones (director)"];
  assert.deepEqual(compareCompany({ client, profile: profile(), jobs: [accs, cs01], officers }), []);
  const out = compareCompany({ client, profile: profile(), jobs: [accs, cs01], officers, before: { officers: ["Jane Smith (director)", "Old Hand (secretary)"] } });
  assert.equal(out[0].type, "officers");
  assert.equal(out[0].detail, "Added: Sam Jones (director). No longer listed: Old Hand (secretary).");
});

test("company not found", () => {
  assert.equal(compareCompany({ client, profile: null, jobs: [] })[0].type, "not-found");
});

test("matching helpers", () => {
  assert.ok(sameAddress("1 High Street, Townville, England, TV1 1AA", "1 High Street, Townville, TV1 1AA"));
  assert.ok(!sameAddress("2 High Street, Townville, TV1 1AA", "1 High Street, Townville, TV1 1AA"));
  assert.ok(sameName("A.D. Smith & Sons Ltd", "A.D. SMITH AND SONS LIMITED"));
  assert.equal(personName("SMITH, Jane Anne"), "Jane Anne Smith");
  assert.equal(personName("O'NEILL-SMITH, Amy"), "Amy O'Neill-Smith");
  assert.equal(tidyName("ACME (UK) HOLDINGS LLP"), "Acme (UK) Holdings LLP");
  assert.equal(chNumber({ ...client, CompanyNumber: " 3367332" }), "03367332");
  assert.equal(chNumber({ ...client, CompanyNumber: "oc340377" }), "OC340377");
  assert.equal(chAddress({ premises: "Unit 4", address_line_1: "Park Way", locality: "Newtown", country: "England" }), "Unit 4 Park Way, Newtown, England");
  assert.deepEqual(
    people({ items: [{ name: "SMITH, Jane", officer_role: "director" }, { name: "OLD, Hand", officer_role: "secretary", resigned_on: "2020-01-01" }] }, "officers"),
    ["Jane Smith (director)"],
  );
});

test("Companies House deadline noted on matching jobs", () => {
  const p = profile({ accounts: { next_made_up_to: "2026-03-31", next_due: "2026-12-30" } });
  assert.deepEqual(chDeadlines(p, [accs, cs01]).map((x) => [x.job.Key, x.CHDeadline]), [["J1", "2026-12-30"], ["J2", "2027-01-24"]]);
  assert.deepEqual(chDeadlines(p, [{ ...accs, CHDeadline: "2026-12-30" }]), []);
});

test("reconcile: new, unchanged, ignored, changed and resolved", () => {
  const found = compareCompany({ client, profile: profile({ company_name: "ACME GADGETS LIMITED" }), jobs: [accs] });
  // first time: both new
  const first = reconcile(found, [], new Set(["C1"]), "2026-10-09");
  assert.equal(first.create.length, 2);
  assert.ok(first.create.every((r) => r.Status === "Open" && r.Found === "2026-10-09"));

  const rows = first.create.map((r, i) => ({ ...r, _id: String(i) }));
  // same findings again: nothing to write
  assert.deepEqual(reconcile(found, rows, new Set(["C1"]), "2026-10-10"), { create: [], update: [] });

  // ignored stays ignored while the values are the same
  const ignored = rows.map((r) => ({ ...r, Status: "Ignored" }));
  assert.deepEqual(reconcile(found, ignored, new Set(["C1"]), "2026-10-10"), { create: [], update: [] });

  // ...but comes back if Companies House's values change
  const changed = compareCompany({ client, profile: profile({ company_name: "ACME THINGS LIMITED" }), jobs: [accs] });
  const back = reconcile(changed, ignored, new Set(["C1"]), "2026-10-11");
  assert.equal(back.update.length, 1);
  assert.equal(back.update[0].patch.Status, "Open");

  // fixed by hand: open flags resolve; companies not checked this time are left alone
  const resolved = reconcile([], rows, new Set(["C1"]), "2026-10-12");
  assert.equal(resolved.update.length, 2);
  assert.ok(resolved.update.every((u) => u.patch.Status === "Resolved"));
  assert.deepEqual(reconcile([], rows, new Set(["C2"]), "2026-10-12"), { create: [], update: [] });
});

test("officer changes aren't resolved just because the next check is quiet", () => {
  const flag = { _id: "1", Key: "C1|officers", ClientKey: "C1", Type: "officers", Status: "Open", Proposed: "{}" };
  assert.deepEqual(reconcile([], [flag], new Set(["C1"]), "2026-10-12"), { create: [], update: [] });
});
