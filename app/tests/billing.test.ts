import test from "node:test";
import assert from "node:assert/strict";
import { FakeAdfin } from "../src/lib/adfin.ts";
import { DEFAULT_ADFIN, billingState, cancelSchedule, createCustomer, liveLinkFor, mandateOf, readAdfinSettings, readCustomerLinks, readLink, readRepeating, replaceSchedule, requestMandate, scheduleBody, searchCustomers, setupProblems, setupSchedule, startSchedule, startSummary, syncLink, xeroOverlaps } from "../src/lib/billing.ts";
import { readFeeLine } from "../src/lib/fees.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-11-01T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const yes = () => true;
const client: any = { Key: "C1", Title: "Acme Ltd" };
const cs = (o: any = {}): any => ({ Key: "CS1", ClientKey: "C1", ServiceKey: "BOOK", Fee: 120, FeePeriod: "monthly", OneOff: false, AnnualFee: 1440, VatTreatment: "standard", ...o });
const input = (o: any = {}): any => ({ line: readFeeLine(cs()), clientName: "Acme Ltd", customerId: "00000000-0000-4000-8000-0000000000c1", method: "direct-debit", startDate: "2026-12-01", description: "Bookkeeping, monthly fee", today: "2026-11-01", settings: { ...DEFAULT_ADFIN }, ...o });
const mem = () => { let v: string | undefined; return { read: () => v, write: (s: string | undefined) => void (v = s) }; };
const created = (w: any) => w.creates.find((c: any) => c.list === "BillingLinks").row;

test("settings and customer links are read safely", () => {
  assert.deepEqual(readAdfinSettings(undefined), DEFAULT_ADFIN);
  assert.deepEqual(readAdfinSettings({ vatRate: 5, termDays: 0, accountCodeId: "69bd0549-2696-4a31-b1ed-66ac01abacf2" }), { vatRate: 5, termDays: 0, accountCodeId: "69bd0549-2696-4a31-b1ed-66ac01abacf2" });
  assert.equal(readAdfinSettings({ accountCodeId: "not a guid", vatRate: 900, termDays: 999 }).accountCodeId, "");
  assert.equal(readAdfinSettings({ vatRate: 900 }).vatRate, 20);
  assert.deepEqual(readCustomerLinks({ C1: { id: "x", name: "A" }, C2: {}, C3: null }), { C1: { id: "x", name: "A" } });
});

test("only an active recurring fee with VAT recorded, a customer and a future date can be set up", () => {
  assert.deepEqual(setupProblems(input()), []);
  assert.match(setupProblems(input({ line: readFeeLine(cs({ FeePeriod: "", OneOff: true, AnnualFee: 0 })) }))[0], /monthly, quarterly or annual/);
  assert.match(setupProblems(input({ line: readFeeLine(cs({ EndedOn: "2026-01-01" })) }))[0], /ended/);
  assert.match(setupProblems(input({ line: readFeeLine(cs({ Off: true })) }))[0], /on hold/);
  assert.match(setupProblems(input({ line: readFeeLine(cs({ Fee: 0 })) }))[0], /included in a package/);
  assert.match(setupProblems(input({ line: readFeeLine(cs({ VatTreatment: "exempt" })) })).join(), /Exempt/);
  assert.match(setupProblems(input({ line: readFeeLine(cs({ VatTreatment: "" })) })).join(), /Record the VAT/);
  assert.match(setupProblems(input({ customerId: "" })).join(), /Choose the Adfin customer/);
  assert.match(setupProblems(input({ startDate: "2026-10-31" })).join(), /past/);
  assert.match(setupProblems(input({ startDate: "" })).join(), /first invoice/);
  assert.match(setupProblems(input({ description: " " })).join(), /what the invoice is for/);
  assert.deepEqual(setupProblems(input({ startDate: "2026-11-01" })), [], "today is allowed");
});

test("the request to Adfin: net amount, tax on top, start date with milliseconds, cycle from the period", () => {
  const b: any = scheduleBody(input());
  assert.deepEqual(b.cadence, { timeUnit: "MONTH", frequency: 1, startDate: "2026-12-01T00:00:00.000Z" });
  assert.equal(b.invoiceDetails.customer.id, "00000000-0000-4000-8000-0000000000c1");
  assert.equal(b.invoiceDetails.distribution.collectionMethod, "AUTO_COLLECT");
  assert.equal(b.invoiceDetails.itemsTaxType, "EXCLUSIVE"); assert.equal(b.invoiceDetails.currencyCode, "GBP");
  assert.deepEqual(b.invoiceDetails.items, [{ description: "Bookkeeping, monthly fee", quantity: 1, unitAmount: 120, taxRate: 20 }]);
  assert.deepEqual(b.invoiceDetails.paymentTerm, { timeUnit: "DAY", value: 14 });
  assert.equal(scheduleBody(input({ line: readFeeLine(cs({ Fee: 360, FeePeriod: "quarterly" })) })).cadence.frequency, 3);
  assert.equal(scheduleBody(input({ line: readFeeLine(cs({ Fee: 1200, FeePeriod: "annually" })) })).cadence.timeUnit, "YEAR");
  assert.equal(scheduleBody(input({ method: "on-demand" })).invoiceDetails.distribution.collectionMethod, "ON_DEMAND");
  assert.equal((scheduleBody(input({ line: readFeeLine(cs({ VatTreatment: "zero" })) })) as any).invoiceDetails.items[0].taxRate, 0);
  const withCode = scheduleBody(input({ settings: { ...DEFAULT_ADFIN, accountCodeId: "69bd0549-2696-4a31-b1ed-66ac01abacf2" } })) as any;
  assert.equal(withCode.invoiceDetails.items[0].accountCodeId, "69bd0549-2696-4a31-b1ed-66ac01abacf2");
});

test("setting up makes a DRAFT only, records it with history, and a second press refuses", async () => {
  const api = new FakeAdfin(mem());
  const w: any = await setupSchedule(api, client, input(), [], "Acme", yes, O);
  assert.equal(w.error, undefined);
  const row = created(w);
  assert.equal(row.Status, "draft"); assert.equal(row.FeeKey, "CS1"); assert.equal(row.Amount, 120); assert.equal(row.VatRate, 20); assert.match(row.ScheduleNo, /^SCH-/);
  assert.equal(w.creates.find((c: any) => c.list === "FeeHistory").row.Action, "billing-draft");
  assert.equal((api as any).schedules[0].status, "DRAFT", "nothing is running in Adfin");
  const again: any = await setupSchedule(api, client, input(), [row], "Acme", yes, O);
  assert.match(again.error, /already has a billing schedule/);
  assert.equal((api as any).schedules.length, 1, "Adfin was not asked twice");
  assert.equal(liveLinkFor([row], "CS1")?.Key, row.Key);
  assert.equal(liveLinkFor([{ ...row, Status: "cancelled" }], "CS1"), undefined);
  assert.match(((await setupSchedule(api, client, input(), [], "Acme", () => false, O)) as any).error, /manager or partner/);
  assert.match(((await setupSchedule(api, client, input({ customerId: "" }), [], "Acme", yes, O)) as any).error, /Adfin customer/);
});

test("when Adfin refuses, nothing is recorded", async () => {
  const api: any = new FakeAdfin(mem());
  api.call = async () => { throw new Error("Adfin didn't accept that: startDate"); };
  const w: any = await setupSchedule(api, client, input(), [], "Acme", yes, O);
  assert.match(w.error, /startDate/); assert.equal(w.creates, undefined);
});

test("starting checks the amount against the fee and goes through Adfin once", async () => {
  const api = new FakeAdfin(mem());
  const row = created(await setupSchedule(api, client, input(), [], "Acme", yes, O));
  const line = readFeeLine(cs());
  assert.match(startSummary(readLink(row), "Acme Ltd"), /£120\.00 \+ VAT \(£144\.00 in all\) every month from 2026-12-01.*direct debit/);
  const w: any = await startSchedule(api, client, row, line, yes, O);
  assert.equal(w.error, undefined); assert.equal(w.patches[0].patch.Status, "active"); assert.equal(w.creates[0].row.Action, "billing-started");
  assert.equal((api as any).schedules[0].status, "ACTIVE");
  assert.match(((await startSchedule(api, client, { ...row, Status: "active" }, line, yes, O)) as any).error, /Only a draft/);
  const moved = readFeeLine(cs({ Fee: 150 }));
  const stale: any = await startSchedule(api, client, row, moved, yes, O);
  assert.match(stale.error, /bills £120\.00 but the fee is now £150\.00.*Replace/);
});

test("drift: changed amount, ended or held fee, VAT change", async () => {
  const api = new FakeAdfin(mem());
  const row = created(await setupSchedule(api, client, input(), [], "Acme", yes, O));
  assert.deepEqual(billingState(readFeeLine(cs()), row).drift, []);
  assert.equal(billingState(readFeeLine(cs()), row).state, "draft");
  assert.match(billingState(readFeeLine(cs({ Fee: 130 })), row).drift[0], /£120\.00 but the fee is now £130\.00/);
  assert.match(billingState(readFeeLine(cs({ EndedOn: "2026-12-31" })), row).drift.join(), /ended/);
  assert.match(billingState(readFeeLine(cs({ Off: true })), row).drift.join(), /on hold/);
  assert.match(billingState(readFeeLine(cs({ VatTreatment: "zero" })), row).drift.join(), /VAT treatment/);
  assert.equal(billingState(readFeeLine(cs()), undefined).state, "none");
  assert.deepEqual(billingState(readFeeLine(cs({ Fee: 999 })), { ...row, Status: "cancelled" }).drift, [], "a cancelled schedule can't drift");
});

test("replacing makes the new draft first, then cancels the old; a failure to cancel leaves a harmless draft and says so", async () => {
  const api = new FakeAdfin(mem());
  const oldRow = created(await setupSchedule(api, client, input(), [], "Acme", yes, O));
  const moved = input({ line: readFeeLine(cs({ Fee: 150 })) });
  const w: any = await replaceSchedule(api, client, oldRow, moved, "Acme", yes, O);
  assert.equal(w.error, undefined);
  assert.equal(w.patches[0].patch.Status, "cancelled"); assert.match(w.patches[0].patch.Notes, /Replaced by SCH-/);
  const fresh = created(w);
  assert.equal(fresh.Status, "draft"); assert.equal(fresh.Amount, 150);
  assert.deepEqual((api as any).schedules.map((s: any) => s.status), ["CANCELLED", "DRAFT"]);
  // cancel fails: the new draft exists, the old is untouched, the message says what to do
  const api2: any = new FakeAdfin(mem());
  const old2 = created(await setupSchedule(api2, client, input(), [], "Acme", yes, O));
  const real = api2.call.bind(api2);
  api2.call = async (m: string, p: string, o: any) => { if (p.endsWith(":cancel")) throw new Error("Adfin is down"); return real(m, p, o); };
  const bad: any = await replaceSchedule(api2, client, old2, moved, "Acme", yes, O);
  assert.match(bad.error, /made in Adfin but the old schedule .* could not be cancelled/); assert.equal(bad.patches, undefined);
});

test("cancelling needs a reason, is recorded, and only works on a live schedule", async () => {
  const api = new FakeAdfin(mem());
  const row = created(await setupSchedule(api, client, input(), [], "Acme", yes, O));
  assert.match(((await cancelSchedule(api, client, row, " ", yes, O)) as any).error, /Say why/);
  const w: any = await cancelSchedule(api, client, row, "Client left", yes, O);
  assert.equal(w.patches[0].patch.Status, "cancelled"); assert.equal(w.creates[0].row.Reason, "Client left");
  assert.equal((api as any).schedules[0].status, "CANCELLED");
  assert.match(((await cancelSchedule(api, client, { ...row, Status: "cancelled" }, "again", yes, O)) as any).error, /isn't running/);
});

test("syncing picks up a status change made in Adfin, and a schedule deleted there", async () => {
  const api: any = new FakeAdfin(mem());
  const row = created(await setupSchedule(api, client, input(), [], "Acme", yes, O));
  const same = await syncLink(api, row, O.now);
  assert.equal(same.status, "draft"); assert.equal(same.patch?.Status, undefined);
  api.schedules[0].status = "ACTIVE"; api.schedules[0].nextIssueDate = "2027-01-01T00:00:00.000Z";
  const s = await syncLink(api, row, O.now);
  assert.equal(s.status, "active"); assert.equal(s.patch?.Status, "active"); assert.equal(s.patch?.NextDate, "2027-01-01");
  const gone = await syncLink({ call: async () => { throw Object.assign(new Error("none"), { status: 404 }); } } as any, row, O.now);
  assert.equal(gone.missing, true);
});

test("customers: search, create, and direct debit state in plain words", async () => {
  const api = new FakeAdfin(mem());
  assert.equal((await searchCustomers(api, "bannister")).length, 1);
  assert.equal((await searchCustomers(api, "")).length, 2);
  const c = await createCustomer(api, "New Co Ltd", "hello@newco.test");
  assert.equal(c.people?.[0].email, "hello@newco.test");
  await assert.rejects(() => createCustomer(api, " ", ""), /needs a name/);
  assert.equal(mandateOf(c).state, "none");
  assert.equal(mandateOf((await searchCustomers(api, "bannister"))[0]).state, "active");
  const r = await requestMandate(api, c.id);
  assert.match(r.url, /^https:\/\//);
  assert.equal(mandateOf((await searchCustomers(api, "New Co"))[0]).state, "waiting");
  assert.match(mandateOf({ id: "x", name: "x", directDebitMandate: { id: "m", status: "CANCELLED", statusReason: "Bank account closed" } }).label, /cancelled \(Bank account closed\)/);
  assert.equal(mandateOf({ id: "x", name: "x", directDebitMandate: { id: "m", status: "PENDING" } }).state, "waiting");
});

test("Xero's existing repeating invoices are matched by name so the same client isn't billed twice", () => {
  const rep = readRepeating({ RepeatingInvoices: [{ Contact: { Name: "ACME LIMITED" }, Total: 144, Status: "AUTHORISED", Type: "ACCREC" }, { Contact: { Name: "Acme Ltd" }, Total: 5, Status: "DELETED", Type: "ACCREC" }, { Contact: { Name: "Acme Ltd" }, Total: 9, Status: "AUTHORISED", Type: "ACCPAY" }, { Contact: { Name: "Other" }, Total: 1, Status: "DRAFT", Type: "ACCREC" }] });
  assert.equal(rep.length, 3, "supplier bills left out");
  assert.deepEqual(xeroOverlaps("Acme Ltd", rep).map((r) => r.total), [144]);
  assert.deepEqual(xeroOverlaps("", rep), []);
  assert.deepEqual(readRepeating(null), []);
});
