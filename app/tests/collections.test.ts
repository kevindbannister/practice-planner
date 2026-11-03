import test from "node:test";
import assert from "node:assert/strict";
import { FakeAdfin } from "../src/lib/adfin.ts";
import { DEFAULT_ADFIN } from "../src/lib/billing.ts";
import {
  ageing, bucketOf, chargeEmail, chargeProblems, chaseEmail, chaseState, clientBooks, collectedSince, collectionProblems, fetchLedger, invoiceCharge, matchClients, paymentReference, paymentRequestBody, readChargeBill,
  recordChase, recordDispute, recordPromise, reconcile, resolveChase, syncCharge, toInvoice,
} from "../src/lib/collections.ts";
import { FakeXero } from "../src/lib/fakeXero.ts";
import { parseInvoice } from "../src/lib/xeroInvoices.ts";
import { DEFAULT_OPTIONS, scopesFor } from "../src/lib/xero.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-11-03T09:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const yes = () => true, no = () => false;
const TODAY = "2026-11-03";
const mem = () => { let v: string | undefined; return { read: () => v, write: (s: string | undefined) => void (v = s) }; };
const client: any = { Key: "C1", Title: "Acme Ltd" };
const charge = (o: any = {}): any => ({ Key: "FC1", ClientKey: "C1", ServiceKey: "ACCS", Label: "Catch-up fee Jan to Jun", Amount: 600, Vat: "standard", AgreedOn: "2026-10-01", Status: "agreed", ...o });
const CUST = "00000000-0000-4000-8000-0000000000c1";
const input = (o: any = {}): any => ({ charge: charge(), clientName: "Acme Ltd", customerId: CUST, customerName: "Acme", settings: { ...DEFAULT_ADFIN }, today: TODAY, ...o });

const inv = (o: any = {}) => parseInvoice({ InvoiceID: o.id || "i1", InvoiceNumber: o.no || "INV-1", Status: o.status || "AUTHORISED", DateString: `${o.date || "2026-09-01"}T00:00:00`, DueDateString: `${o.due || "2026-09-15"}T00:00:00`, Total: o.total ?? 480, AmountPaid: o.paid ?? 0, AmountDue: o.status === "PAID" ? 0 : (o.total ?? 480) - (o.paid ?? 0), Contact: { ContactID: o.cid || "ct1", Name: o.name || "Acme Limited" }, FullyPaidOnDate: o.paidOn ? `${o.paidOn}T00:00:00` : undefined }, TODAY);

test("a charge can be invoiced only when agreed, once, with VAT and a customer", () => {
  assert.deepEqual(chargeProblems(input()), []);
  assert.match(chargeProblems(input({ charge: charge({ Status: "proposed" }) }))[0], /approval/);
  assert.match(chargeProblems(input({ charge: charge({ Status: "cancelled" }) }))[0], /cancelled/);
  assert.match(chargeProblems(input({ charge: charge({ BillId: "x", BillNo: "PP FC1", BillStatus: "unpaid" }) }))[0], /already been invoiced/);
  assert.deepEqual(chargeProblems(input({ charge: charge({ BillId: "x", BillStatus: "void" }) })), [], "a voided invoice can be redone");
  assert.match(chargeProblems(input({ charge: charge({ Amount: 0 }) })).join(), /more than nothing/);
  assert.match(chargeProblems(input({ charge: charge({ Vat: "exempt" }) })).join(), /Exempt/);
  assert.match(chargeProblems(input({ charge: charge({ Vat: "" }) })).join(), /Record the VAT/);
  assert.match(chargeProblems(input({ customerId: "" })).join(), /Choose the Adfin customer/);
});

test("the payment request carries the VAT-inclusive total, the rate, a short reference and the pay-by date", () => {
  const b = paymentRequestBody(input());
  assert.equal(b.totalAmount, 720); assert.equal(b.taxRate, 20); assert.equal(b.currencyCode, "GBP"); assert.equal(b.customer.id, CUST);
  assert.equal(b.payByDate, "2026-11-17"); assert.equal(b.reference, "PP FC1");
  assert.equal(paymentRequestBody(input({ charge: charge({ Vat: "zero" }) })).totalAmount, 600);
  assert.ok(paymentReference({ Key: "FC-1234567890-abcdefghijk!!" } as any).length <= 22);
  assert.match(paymentReference({ Key: "FC-1/2" } as any), /^[A-Za-z0-9 .]+$/);
  assert.equal(paymentRequestBody(input({ charge: charge({ Label: "x".repeat(300) }) })).description.length, 200);
});

test("invoicing records the request on the charge with history, refuses without permission and never twice", async () => {
  const api = new FakeAdfin(mem());
  assert.match(((await invoiceCharge(api, client, input(), no, O)) as any).error, /manager or partner/);
  const w: any = await invoiceCharge(api, client, input(), yes, O);
  assert.equal(w.error, undefined);
  const p = w.patches[0];
  assert.equal(p.list, "FeeCharges"); assert.equal(p.patch.BillStatus, "unpaid"); assert.equal(p.patch.BillAmount, 720); assert.equal(p.patch.BilledOn, TODAY); assert.match(p.patch.BillUrl, /^https:\/\//); assert.ok(p.patch.BillId);
  assert.equal(w.creates[0].row.Action, "charge-invoiced"); assert.equal(w.activities.length, 1);
  const done = { ...charge(), ...p.patch };
  assert.match(((await invoiceCharge(api, client, input({ charge: done }), yes, O)) as any).error, /already been invoiced/);
  assert.equal(toInvoice([charge(), done, charge({ Key: "FC2", Status: "proposed" }), charge({ Key: "FC3", BillId: "z", BillStatus: "void" })]).map((r) => r.Key).join(), "FC1,FC3");
});

test("an Adfin refusal changes nothing, and a reply without an id is not trusted", async () => {
  const api = new FakeAdfin(mem());
  const r: any = await invoiceCharge(api, client, input({ customerId: CUST }), yes, O);
  assert.equal(r.error, undefined);
  const bad: any = { call: async () => ({}) };
  assert.match(((await invoiceCharge(bad, client, input(), yes, O)) as any).error, /Check Adfin before trying again/);
  const boom: any = { call: async () => { throw new Error("Adfin didn't accept that: nope"); } };
  assert.match(((await invoiceCharge(boom, client, input(), yes, O)) as any).error, /nope/);
});

test("sync picks up payment and a missing request", async () => {
  const api = new FakeAdfin(mem());
  const w: any = await invoiceCharge(api, client, input(), yes, O);
  const row = { ...charge(), ...w.patches[0].patch };
  assert.equal((await syncCharge(api, row, TODAY)).patch, undefined);
  api.pay(row.BillId);
  const s = await syncCharge(api, row, "2026-11-10");
  assert.equal(s.status, "paid"); assert.equal(s.patch!.PaidOn, "2026-11-10");
  assert.equal(readChargeBill({ ...row, ...s.patch }).status, "paid");
  assert.equal((await syncCharge(api, { ...row, BillId: "00000000-0000-4000-a000-999999999999" }, TODAY)).missing, true);
  assert.equal((await syncCharge(api, charge(), TODAY)).status, "none");
});

test("the email with the payment link", () => {
  const e = chargeEmail("Sam", "Catch-up fee", 720, "https://pay/x", "2026-11-17");
  assert.match(e.body, /Hello Sam/); assert.match(e.body, /£720\.00 including VAT/); assert.match(e.body, /https:\/\/pay\/x/); assert.match(e.body, /17 Nov 2026/);
});

test("invoices are matched to clients by the chosen Xero contact, else an exact name, never a guess", () => {
  const clients: any[] = [{ Key: "C1", Title: "Acme Ltd" }, { Key: "C2", Title: "Bolt Limited" }, { Key: "C3", Title: "Twin Ltd" }, { Key: "C4", Title: "Twin Limited" }];
  const rows = [inv({ id: "a", cid: "ct1", name: "Acme Limited" }), inv({ id: "b", cid: "ctx", name: "Different name" }), inv({ id: "c", cid: "ct3", name: "Bolt Ltd" }), inv({ id: "d", cid: "ct9", name: "Twin Ltd" })];
  const { debts, unmatched } = matchClients(rows, clients, { C2: { id: "ctx", name: "Different name" } });
  assert.deepEqual(debts.map((d) => [d.id, d.clientKey]), [["a", "C1"], ["b", "C2"], ["c", "C2"]]);
  assert.deepEqual(unmatched.map((u) => u.id), ["d"], "two clients normalise to the same name, so it is left for a person");
});

test("ageing buckets by days past due, only unpaid invoices", () => {
  assert.equal(bucketOf({ due: "2026-11-03" }, TODAY), "current");
  assert.equal(bucketOf({ due: "2026-11-02" }, TODAY), "d30");
  assert.equal(bucketOf({ due: "2026-10-04" }, TODAY), "d30");
  assert.equal(bucketOf({ due: "2026-10-03" }, TODAY), "d60");
  assert.equal(bucketOf({ due: "2026-08-05" }, TODAY), "d90");
  assert.equal(bucketOf({ due: "2026-08-04" }, TODAY), "d90p");
  const a = ageing([inv({ id: "1", due: "2026-11-20", total: 100 }), inv({ id: "2", due: "2026-10-20", total: 200 }), inv({ id: "3", due: "2026-06-01", total: 300 }), inv({ id: "4", status: "PAID", total: 999, paid: 999 }), inv({ id: "5", status: "DRAFT", total: 50 })], TODAY);
  assert.deepEqual([a.current, a.d30, a.d90p, a.total, a.count], [100, 200, 300, 600, 3]);
});

test("a client's book: owed, overdue, how late, billed and paid over 12 months, how long they take to pay", () => {
  const { debts } = matchClients([
    inv({ id: "1", total: 480, due: "2026-09-15" }), inv({ id: "2", total: 480, status: "PAID", paid: 480, date: "2026-06-01", due: "2026-06-15", paidOn: "2026-06-11" }),
    inv({ id: "3", total: 100, status: "VOIDED" }), inv({ id: "4", total: 90, status: "DRAFT" }), inv({ id: "5", total: 70, status: "PAID", paid: 70, date: "2024-01-01", due: "2024-01-15", paidOn: "2024-01-05" }),
  ], [{ Key: "C1", Title: "Acme" }] as any, { C1: { id: "ct1", name: "Acme" } });
  const [b] = clientBooks(debts, TODAY);
  assert.equal(b.owed, 480); assert.equal(b.overdue, 480); assert.equal(b.oldestLate, 49); assert.equal(b.billed12, 960); assert.equal(b.paid12, 480); assert.equal(b.avgDaysToPay, 7);
  assert.equal(collectedSince(debts, TODAY, 30), 0);
  assert.equal(collectedSince(debts, "2026-06-20", 30), 480);
});

test("chasing climbs a ladder, waits a week, and stops for a promise or a dispute", () => {
  const book = (late: number): any => ({ clientKey: "C1", late: [{ number: "INV-1" }], oldestLate: late });
  const ch = (level: number, at: string, kind = "chase", extra: any = {}): any => ({ Key: `k${level}${at}`, ClientKey: "C1", Kind: kind, Level: level, At: `${at}T09:00:00Z`, ...extra });
  assert.equal(chaseState(undefined, [], TODAY).state, "none");
  assert.equal(chaseState({ ...book(0), late: [] }, [], TODAY).state, "none");
  assert.equal(chaseState(book(3), [], TODAY).state, "none", "not late enough yet");
  assert.deepEqual(chaseState(book(8), [], TODAY), { state: "chase", level: 1, label: "Friendly reminder", again: false });
  assert.equal((chaseState(book(80), [], TODAY) as any).level, 1, "the first chaser is the friendly one, however old the debt");
  assert.match((chaseState(book(30), [ch(1, "2026-11-01")], TODAY) as any).reason, /2 days ago/);
  assert.equal((chaseState(book(30), [ch(1, "2026-10-20")], TODAY) as any).level, 2);
  assert.equal((chaseState(book(40), [ch(2, "2026-10-20")], TODAY) as any).level, 3);
  const stay: any = chaseState(book(30), [ch(2, "2026-10-20")], TODAY);
  assert.equal(stay.level, 2); assert.equal(stay.again, true, "not late enough for the next rung yet");
  const again: any = chaseState(book(40), [ch(3, "2026-10-20")], TODAY);
  assert.equal(again.level, 3); assert.equal(again.again, true);
  assert.equal(chaseState(book(40), [ch(1, "2026-10-01", "promise", { PromiseOn: "2026-11-10", Status: "open" })], TODAY).state, "promised");
  assert.equal(chaseState(book(40), [ch(1, "2026-10-01", "promise", { PromiseOn: "2026-11-01", Status: "open" })], TODAY).state, "chase", "a broken promise is chased again");
  assert.equal(chaseState(book(40), [ch(1, "2026-10-01", "promise", { PromiseOn: "2026-11-10", Status: "kept" })], TODAY).state, "chase");
  assert.equal(chaseState(book(40), [ch(0, "2026-10-01", "dispute", { Status: "open", Note: "wrong amount" })], TODAY).state, "disputed");
  assert.equal(chaseState(book(40), [ch(0, "2026-10-01", "dispute", { Status: "resolved" })], TODAY).state, "chase");
});

test("chaser wording gets firmer, lists the invoices and offers payment links and direct debit help", () => {
  const invoices = [{ number: "INV-1", date: "2026-09-01", due: "2026-09-15", balance: 480, reference: "Year end" }, { number: "INV-2", date: "2026-10-01", due: "2026-10-15", balance: 120, reference: "" }];
  const base = { first: "Sam", invoices, hasDirectDebit: false, payUrls: [], today: TODAY };
  const e1 = chaseEmail({ ...base, level: 1 }), e2 = chaseEmail({ ...base, level: 2 }), e3 = chaseEmail({ ...base, level: 3, payUrls: ["https://pay/x"], hasDirectDebit: true });
  assert.match(e1.body, /Hello Sam/); assert.match(e1.body, /£600\.00 in all/); assert.match(e1.body, /INV-1.*£480\.00 \(Year end\)/); assert.match(e1.body, /already paid, thank you/);
  assert.match(e2.subject, /Overdue: INV-1, INV-2/); assert.match(e2.body, /Please pay by return/);
  assert.match(e3.subject, /Final reminder: £600\.00/); assert.match(e3.body, /pause further work/); assert.match(e3.body, /https:\/\/pay\/x/); assert.match(e3.body, /direct debit/);
  assert.doesNotMatch(e1.body, /direct debit/);
});

test("chasing, promises and disputes are recorded with who and when, and need permission", () => {
  const inv2 = [{ number: "INV-1", balance: 480 }, { number: "INV-2", balance: 120 }];
  assert.match((recordChase(client, 1, inv2, "", no, O) as any).error, /manager or partner/);
  assert.match((recordChase(client, 1, [], "", yes, O) as any).error, /nothing overdue/);
  const w: any = recordChase(client, 2, inv2, "", yes, O);
  const r = w.creates[0].row;
  assert.equal(w.creates[0].list, "BillingChases"); assert.deepEqual([r.Kind, r.Level, r.Amount, r.InvoiceNos, r.Actor, r.Status], ["chase", 2, 600, "INV-1, INV-2", "Kevin", "drafted"]);
  assert.match(w.activities[0].Title, /second reminder/);
  assert.match((recordPromise(client, "", 100, "", TODAY, yes, O) as any).error, /date/);
  assert.match((recordPromise(client, "2026-11-01", 100, "", TODAY, yes, O) as any).error, /passed/);
  assert.equal((recordPromise(client, "2026-11-10", 100, "after VAT refund", TODAY, yes, O) as any).creates[0].row.PromiseOn, "2026-11-10");
  assert.match((recordDispute(client, "INV-1", " ", yes, O) as any).error, /what the client disputes/);
  assert.equal((recordDispute(client, "INV-1", "Hours too high", yes, O) as any).creates[0].row.Status, "open");
  assert.equal((resolveChase({ Key: "BC1" } as any, "resolved", yes) as any).patches[0].patch.Status, "resolved");
  assert.match((resolveChase({ Key: "BC1" } as any, "kept", no) as any).error, /manager or partner/);
});

test("direct debit schedules with no working mandate are flagged", () => {
  const link = (o: any): any => ({ Key: "BL1", ClientKey: "C1", Status: "active", Method: "direct-debit", CustomerId: "cu1", ScheduleNo: "SCH-1", ...o });
  const cu = (status?: string): any => ({ cu1: { id: "cu1", name: "Acme", directDebitMandate: status ? { id: "m", status } : null } });
  assert.deepEqual(collectionProblems([link({})], cu("ACTIVE")), []);
  assert.match(collectionProblems([link({})], cu())[0].problem, /no direct debit has been requested/);
  assert.equal(collectionProblems([link({})], cu("CREATED"))[0].level, "amber");
  assert.equal(collectionProblems([link({})], cu("CANCELLED"))[0].level, "red");
  assert.deepEqual(collectionProblems([link({ Method: "on-demand" })], cu()), [], "card or bank billing needs no mandate");
  assert.deepEqual(collectionProblems([link({ Status: "cancelled" })], cu()), []);
  assert.deepEqual(collectionProblems([link({})], {}), [], "customer not read: say nothing rather than guess");
});

test("billed over 12 months against the agreed fees, with VAT", () => {
  const cs = (o: any): any => ({ Key: "CS", ClientKey: "C1", ServiceKey: "BOOK", Fee: 100, FeePeriod: "monthly", AnnualFee: 1200, VatTreatment: "standard", OneOff: false, ...o });
  const book = (clientKey: string, billed12: number): any => ({ clientKey, billed12 });
  const rec = (billed: number, extra: any[] = [], charges: any[] = []) => reconcile([cs({}), ...extra], charges, [book("C1", billed)], 20, TODAY)[0];
  assert.deepEqual([rec(1440).expected, rec(1440).state], [1440, "ok"]);
  assert.equal(rec(1000).state, "under"); assert.equal(rec(1000).diff, -440);
  assert.equal(rec(2000).state, "over");
  assert.equal(rec(1400).state, "ok", "a small difference is left alone");
  assert.equal(rec(1440, [cs({ Key: "Z", ClientKey: "C1", VatTreatment: "zero", Fee: 50, AnnualFee: 600 })]).expected, 2040);
  assert.equal(rec(1440 + 720, [], [{ Key: "F", ClientKey: "C1", Amount: 600, Vat: "standard", AgreedOn: "2026-10-01", Status: "agreed" }]).state, "ok");
  assert.equal(rec(1440, [], [{ Key: "F", ClientKey: "C1", Amount: 600, Vat: "standard", AgreedOn: "2024-01-01", Status: "agreed" }]).expected, 1440, "an old charge is outside the year");
  assert.equal(reconcile([], [], [book("C9", 300)], 20, TODAY)[0].state, "over", "billed with nothing agreed");
});

test("the ledger is read from Xero once and de-duplicated", async () => {
  let sealed: string | undefined = "demo:" + btoa(JSON.stringify(scopesFor({ groups: DEFAULT_OPTIONS.groups, classic: false })));
  const xero = new FakeXero({ read: () => sealed, write: (x) => void (sealed = x) });
  const rows = await fetchLedger(xero as any, "00000000-0000-4000-8000-0000000000aa", TODAY);
  assert.ok(rows.length >= 6);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(rows.some((r) => r.state === "overdue"));
});

test("an invoiced charge can't be cancelled until the invoice is voided", async () => {
  const { cancelCharge } = await import("../src/lib/fees.ts");
  assert.match((cancelCharge(charge({ BillId: "x", BillStatus: "unpaid" }), client, "why", yes, O) as any).error, /Void the invoice in Adfin/);
  assert.equal((cancelCharge(charge({ BillId: "x", BillStatus: "void" }), client, "why", yes, O) as any).error, undefined);
  assert.equal((cancelCharge(charge(), client, "why", yes, O) as any).error, undefined);
});
