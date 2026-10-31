import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../src/lib/domain.ts";
import { ExportRow, FilterRow, NO_FILTERS, activeFilters, exportTable, mailList, matchRow, membersToAdd, readCriteria, readViews, tasksToCreate, toCsv, withView, withoutView, yearEndText } from "../src/lib/clientFilter.ts";

const client = (o: Record<string, unknown>): Client => ({ Key: "C1", Title: "Client", Kind: "Ltd", ...o }) as Client;
const row = (o: Record<string, unknown> = {}, r: Partial<FilterRow> = {}): FilterRow => ({ client: client(o), groups: [], services: [], attention: false, open: 0, overdue: 0, ...r });
const f = (o: Partial<typeof NO_FILTERS>) => ({ ...NO_FILTERS, ...o });

test("no filters shows everyone", () => {
  assert.ok(matchRow(NO_FILTERS, row()));
  assert.equal(activeFilters(NO_FILTERS), 0);
});

test("type, search and attention", () => {
  assert.ok(matchRow(f({ kind: "companies" }), row({ Kind: "LLP" })));
  assert.ok(!matchRow(f({ kind: "companies" }), row({ Kind: "Individual" })));
  assert.ok(matchRow(f({ kind: "individuals" }), row({ Kind: "Individual" })));
  assert.ok(!matchRow(f({ kind: "individuals" }), row({ Kind: "Ltd" })));
  assert.ok(matchRow(f({ search: " kent " }), row({ Title: "The Kent Stove Company" })));
  assert.ok(matchRow(f({ search: "08479073" }), row({ CompanyNumber: "08479073" })));
  assert.ok(matchRow(f({ search: "stoves" }), row({ Title: "Alpha", TradingName: "Kent Stoves" })));
  assert.ok(!matchRow(f({ search: "zzz" }), row()));
  assert.ok(!matchRow(f({ attention: true }), row()));
  assert.ok(matchRow(f({ attention: true }), row({}, { attention: true })));
});

test("services: any, all or none of the chosen work", () => {
  const vatAndPayroll = row({}, { services: ["VAT", "PAYROLL"] });
  const vatOnly = row({}, { services: ["VAT"] });
  const nothing = row();
  const any = f({ services: ["VAT", "PAYROLL"], serviceMode: "any" });
  assert.deepEqual([vatAndPayroll, vatOnly, nothing].map((r) => matchRow(any, r)), [true, true, false]);
  const all = f({ services: ["VAT", "PAYROLL"], serviceMode: "all" });
  assert.deepEqual([vatAndPayroll, vatOnly, nothing].map((r) => matchRow(all, r)), [true, false, false]);
  const none = f({ services: ["VAT", "PAYROLL"], serviceMode: "none" });
  assert.deepEqual([vatAndPayroll, vatOnly, nothing].map((r) => matchRow(none, r)), [false, false, true]);
  // choosing no services means the mode does nothing
  assert.ok(matchRow(f({ serviceMode: "none" }), vatOnly));
});

test("fees: a range, or clients with no fee recorded", () => {
  assert.ok(matchRow(f({ feeMin: 1000 }), row({ AnnualFees: 1200 })));
  assert.ok(!matchRow(f({ feeMin: 1000 }), row({ AnnualFees: 900 })));
  assert.ok(!matchRow(f({ feeMin: 1000 }), row()), "no fee is not at least 1,000");
  assert.ok(matchRow(f({ feeMax: 500 }), row({ AnnualFees: 500 })));
  assert.ok(!matchRow(f({ feeMax: 500 }), row({ AnnualFees: 501 })));
  assert.ok(matchRow(f({ feeMin: 500, feeMax: 1500 }), row({ AnnualFees: 1000 })));
  assert.ok(matchRow(f({ feeNone: true }), row()));
  assert.ok(matchRow(f({ feeNone: true }), row({ AnnualFees: 0 })));
  assert.ok(!matchRow(f({ feeNone: true }), row({ AnnualFees: 300 })));
});

test("importance, VAT, year end", () => {
  assert.ok(matchRow(f({ importance: "key" }), row({ Importance: "key" })));
  assert.ok(matchRow(f({ importance: "normal" }), row()), "blank means normal");
  assert.ok(!matchRow(f({ importance: "low" }), row()));
  assert.ok(matchRow(f({ vat: "yes" }), row({ VATRegistered: "2020-05-01" })));
  assert.ok(!matchRow(f({ vat: "yes" }), row({ VATRegistered: "" })));
  assert.ok(matchRow(f({ vat: "no" }), row()));
  assert.ok(matchRow(f({ yearEnd: "03" }), row({ YearEnd: "03-31" })));
  assert.ok(!matchRow(f({ yearEnd: "03" }), row({ YearEnd: "12-31" })));
  assert.ok(!matchRow(f({ yearEnd: "03" }), row()));
});

test("AML, engagement letter and open work", () => {
  assert.ok(matchRow(f({ aml: "attention" }), row({ XamaStatus: "not linked" })));
  assert.ok(!matchRow(f({ aml: "ok" }), row({ XamaStatus: "not linked" })));
  assert.ok(matchRow(f({ loe: "signed" }), row({ LoEStatus: "Finalised" })));
  assert.ok(matchRow(f({ loe: "missing" }), row({ LoEStatus: "Active" })), "sent but not signed counts as missing");
  assert.ok(matchRow(f({ loe: "missing" }), row()));
  assert.ok(!matchRow(f({ loe: "missing" }), row({ LoEStatus: "Finalised" })));
  assert.ok(matchRow(f({ work: "overdue" }), row({}, { open: 3, overdue: 1 })));
  assert.ok(!matchRow(f({ work: "overdue" }), row({}, { open: 3 })));
  assert.ok(matchRow(f({ work: "none" }), row()));
  assert.ok(!matchRow(f({ work: "none" }), row({}, { open: 1 })));
  assert.ok(matchRow(f({ work: "open" }), row({}, { open: 1 })));
});

test("filters combine, and the count of switched-on filters ignores search and type", () => {
  const c = f({ kind: "companies", search: "x", services: ["VAT"], vat: "yes", yearEnd: "03", feeMin: 500 });
  assert.equal(activeFilters(c), 4);
  const ok = row({ VATRegistered: "2020-01-01", YearEnd: "03-31", AnnualFees: 900, Title: "Xylo" }, { services: ["VAT"] });
  assert.ok(matchRow(c, ok));
  assert.ok(!matchRow(c, { ...ok, services: [] }));
});

test("saved criteria are read safely, whatever is stored", () => {
  assert.deepEqual(readCriteria(null), NO_FILTERS);
  assert.deepEqual(readCriteria("junk"), NO_FILTERS);
  const c = readCriteria({ kind: "weird", services: ["VAT", 5], feeMin: -3, feeMax: "x", yearEnd: "13", vat: "yes", work: "overdue" });
  assert.equal(c.kind, "all");
  assert.deepEqual(c.services, ["VAT"]);
  assert.equal(c.feeMin, null);
  assert.equal(c.feeMax, null);
  assert.equal(c.yearEnd, "");
  assert.equal(c.vat, "yes");
  assert.equal(c.work, "overdue");
});

test("saved views: save, replace by name without regard to case, remove, and ignore damaged entries", () => {
  let views = withView([], "VAT clients", f({ vat: "yes" }));
  views = withView(views, "Key clients", f({ importance: "key" }));
  assert.deepEqual(views.map((v) => v.name), ["Key clients", "VAT clients"]);
  views = withView(views, "vat CLIENTS", f({ vat: "no" }));
  assert.equal(views.length, 2);
  assert.equal(views.find((v) => v.name === "vat CLIENTS")?.criteria.vat, "no");
  assert.equal(withView(views, "  ", NO_FILTERS).length, 2, "a blank name saves nothing");
  assert.deepEqual(withoutView(views, "Key clients").map((v) => v.name), ["vat CLIENTS"]);
  const read = readViews(JSON.parse(JSON.stringify(views)));
  assert.deepEqual(read, views);
  assert.deepEqual(readViews([{ name: "" }, 5, null, { name: "Ok" }]).map((v) => v.name), ["Ok"]);
  assert.deepEqual(readViews("nope"), []);
});

test("the export has a header, the right cells, and nothing that runs as a formula", () => {
  const r: ExportRow = {
    ...row({ Title: "=cmd|' /C calc'!A0", Kind: "Ltd", CompanyNumber: "08479073", YearEnd: "04-30", Email: "a@b.co", AnnualFees: 1200, Importance: "key", VATRegistered: "2020-01-01", XamaStatus: "not linked", LoEStatus: "Finalised" }, { open: 2, overdue: 1 }),
    groupNames: ["Kent Stove Group", "Other"], serviceNames: ["Accounts", "VAT"], nextJob: "VAT return", nextDeadline: "7 Dec 2026",
  };
  const t = exportTable([r]);
  assert.equal(t.length, 2);
  assert.equal(t[0][0], "Client");
  assert.deepEqual(t[1].slice(1, 11), ["Limited company", "08479073", "30 Apr", "a@b.co", "", "Kent Stove Group; Other", "Accounts; VAT", "1200", "key", "Yes"]);
  assert.equal(t[1][12], "Signed");
  const csv = toCsv(t);
  assert.ok(csv.split("\r\n")[1].startsWith(`"'=cmd`), "a leading = is made harmless");
  assert.ok(toCsv([['say "hi", ok']]).includes('"say ""hi"", ok"'), "quotes and commas are escaped");
  assert.equal(yearEndText("03-31"), "31 Mar");
  assert.equal(yearEndText(""), "");
});

test("the email list drops duplicates and counts clients with no address", () => {
  const m = mailList([{ client: client({ Key: "1", Email: "a@x.co" }) }, { client: client({ Key: "2", Email: " A@X.co " }) }, { client: client({ Key: "3" }) }, { client: client({ Key: "4", Email: "b@x.co" }) }]);
  assert.deepEqual(m.emails, ["a@x.co", "b@x.co"]);
  assert.equal(m.missing, 1);
});

test("adding to a group skips clients already in it", () => {
  let n = 0;
  const key = (p: string) => `${p}${++n}`;
  const clients = [client({ Key: "A", Kind: "Ltd" }), client({ Key: "B", Kind: "Individual" }), client({ Key: "C", Kind: "LLP" })];
  const members = [{ Key: "m", GroupKey: "G1", MemberKey: "B" }, { Key: "m2", GroupKey: "G2", MemberKey: "A" }];
  const r = membersToAdd(clients, "G1", members, key);
  assert.deepEqual(r.rows.map((x) => [x.MemberKey, x.Kind, x.GroupKey]), [["A", "Company", "G1"], ["C", "LLP", "G1"]]);
  assert.equal(r.already, 1);
  // membership of a different group doesn't count, and a second run adds nothing
  const again = membersToAdd(clients, "G1", [...members, ...r.rows], key);
  assert.equal(again.rows.length, 0);
  assert.equal(again.already, 3);
});

test("a task for each client: needs a name, and a second press doesn't double up", () => {
  let n = 0;
  const key = (p: string) => `${p}${++n}`;
  const clients = [client({ Key: "A" }), client({ Key: "B" })];
  assert.match(tasksToCreate(clients, { title: "  ", type: "Client work", dueDate: "", hours: null }, [], key).problem || "", /name/);
  const draft = { title: "Ask for year end records", type: "Client work", dueDate: "2026-12-01", hours: 0.5 };
  const first = tasksToCreate(clients, draft, [], key);
  assert.equal(first.rows.length, 2);
  assert.deepEqual(first.rows[0], { Key: "T1", Title: "Ask for year end records", ClientKey: "A", Type: "Client work", Status: "Open", DueDate: "2026-12-01", EstimateHours: 0.5 });
  const second = tasksToCreate(clients, { ...draft, title: "ask for YEAR end records" }, first.rows, key);
  assert.equal(second.rows.length, 0);
  assert.equal(second.skipped, 2);
  // a finished task with the same name doesn't block a new one
  const done = tasksToCreate(clients, draft, first.rows.map((t) => ({ ...t, Status: "Done" })), key);
  assert.equal(done.rows.length, 2);
  // optional fields are left out when empty
  const bare = tasksToCreate([clients[0]], { title: "Call", type: "Other", dueDate: "", hours: null }, [], key).rows[0];
  assert.equal("DueDate" in bare, false);
  assert.equal("EstimateHours" in bare, false);
});
