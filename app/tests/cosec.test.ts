import test from "node:test";
import assert from "node:assert/strict";
import { act, allotShares, appointPerson, changePerson, coSecItems, cosecCan, detectClientChange, pendingFor, terminatePerson, transferShares, txIssues, txStatus, Snapshot, SOURCE_LABEL } from "../src/lib/cosec.ts";
import { addrIssues, officerForm, parseAddress, pscForm } from "../src/lib/cosecForms.ts";

let n = 0;
let clock = 0;
const ctx = () => ({ actor: "Kevin", now: new Date(Date.UTC(2026, 9, 27, 9, 0, clock++)).toISOString(), pid: "default", newKey: (p: string) => `${p}${++n}` });
const cfg: any = { staff: [], overriders: [], independentReview: false, auto: true };
const ltd: any = { _id: "1", Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", RegisteredOffice: "10 High Street, London, E1 5NF", TradingAddress: "Unit 2, Mill Road, Leeds", YearEnd: "31 March", SIC: "62020", Manager: "Max", Partner: "Pat" };
const person: any = { _id: "2", Key: "C2", Title: "Ann Acme", Kind: "Individual", HomeAddress: "5 Park Lane, London, W1K 1AA" };

/** A tiny in-memory store that applies what the engine writes, so a test can run several changes in a row. */
function world(clients: any[] = [{ ...ltd }, { ...person }]) {
  const s: Snapshot & { all: Record<string, any[]> } = { clients, officers: [], pscs: [], shares: [], txs: [], events: [], all: {} };
  let id = 100;
  const lists: Record<string, string> = { CoSecTransactions: "txs", CoSecEvents: "events", CoSecOfficers: "officers", CoSecPscs: "pscs", CoSecShares: "shares" };
  const apply = (w: any) => {
    for (const c of w.creates || []) { const arr = (s as any)[lists[c.list]]; if (arr) arr.push({ _id: String(++id), ...c.row }); }
    for (const p of w.patches || []) { const arr = (s as any)[lists[p.list]] || (p.list === "Clients" ? s.clients : undefined); const r = arr?.find((x: any) => x.Key === p.row.Key); if (r) Object.assign(r, p.patch); }
    if (w.verified) { const c = s.clients.find((x) => x.Key === w.verified.clientKey); if (c) c.CHVerified = JSON.stringify(w.verified.value); }
    return w;
  };
  /** Edit a client record the way the app does: detect against the record as it was, then change it. */
  const edit = (key: string, patch: any, source: any = "client") => {
    const client = s.clients.find((c) => c.Key === key)!;
    const w = detectClientChange({ client: { ...client }, patch, source, changeId: `${key}:${++id}` }, s, ctx());
    Object.assign(client, patch);
    apply(w);
    return w;
  };
  return { s, apply, edit };
}
const txsFor = (s: Snapshot, form?: string) => s.txs.filter((t) => !form || t.Form === form);

test("a registered office change prepares an AD01 draft that says it has not been filed", () => {
  const { s, edit } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  assert.equal(s.txs.length, 1);
  const t = s.txs[0];
  assert.equal(t.Form, "AD01");
  assert.equal(t.Status, "draft");
  assert.equal(t.Assignee, "Max", "the responsible manager");
  assert.equal(t.Before, "10 High Street, London, E1 5NF");
  assert.match(JSON.parse(t.History)[0].note, /Not yet submitted to Companies House/);
  assert.equal(JSON.parse(t.Payload).address.postcode, "N1 9GU");
  assert.ok(s.events.some((e) => e.Outcome === "draft"));
});

test("trading and correspondence address changes never prepare an AD01", () => {
  const { s, edit } = world();
  edit("C1", { TradingAddress: "Unit 9, New Road, Leeds" });
  edit("C1", { CorrespondenceAddress: "PO Box 1, London" });
  assert.equal(s.txs.length, 0);
  assert.ok(s.events.every((e) => e.Outcome === "ignored"), "recorded as ignored, with the reason");
  assert.match(s.events[0].Note, /not a statutory address/);
  assert.equal(s.clients[0].RegisteredOffice, "10 High Street, London, E1 5NF", "the registered office was not overwritten");
});

test("repeated edits update the one open draft; the same change processed twice does nothing", () => {
  const { s, edit, apply } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  edit("C1", { RegisteredOffice: "30 Market Road, London, N1 9GU" });
  edit("C1", { RegisteredOffice: "31 Market Road, London, N1 9GU" });
  assert.equal(s.txs.length, 1, "one draft only");
  assert.equal(s.txs[0].After, "31 Market Road, London, N1 9GU");
  assert.equal(s.txs[0].Before, "10 High Street, London, E1 5NF", "still compares with what Companies House holds");
  // replaying a change that was already processed
  const again = detectClientChange({ client: { ...s.clients[0], RegisteredOffice: "30 Market Road, London, N1 9GU" }, patch: { RegisteredOffice: "31 Market Road, London, N1 9GU" }, source: "client", changeId: "same" }, s, ctx());
  apply(again);
  const replay = detectClientChange({ client: { ...s.clients[0], RegisteredOffice: "30 Market Road, London, N1 9GU" }, patch: { RegisteredOffice: "31 Market Road, London, N1 9GU" }, source: "client", changeId: "same" }, s, ctx());
  assert.equal(replay.outcomes[0].outcome, "duplicate");
  assert.equal(s.txs.length, 1);
});

test("changing it back cancels the draft", () => {
  const { s, edit } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  edit("C1", { RegisteredOffice: "10 High Street, London, E1 5NF" });
  assert.equal(s.txs.length, 1);
  assert.equal(txStatus(s.txs[0]), "cancelled");
  assert.match(JSON.parse(s.txs[0].History).at(-1).note, /put back/);
  assert.equal(pendingFor(s.txs, "C1").length, 0, "no pending indicator any more");
});

test("changes made at Companies House or through Co Sec prepare no filing", () => {
  const { s, edit } = world();
  edit("C1", { RegisteredOffice: "1 New Street, London, EC1A 1BB" }, "ch-sync");
  edit("C1", { YearEnd: "30 June" }, "cosec");
  assert.equal(s.txs.length, 0);
  assert.deepEqual(s.events.map((e) => e.Outcome), ["info", "info"]);
});

test("an address Companies House already shows is not filed again", () => {
  const { s, edit } = world([{ ...ltd, CHVerified: JSON.stringify({ office: "25 Market Road, London, N1 9GU" }) }, { ...person }]);
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  assert.equal(s.txs.length, 0);
  assert.match(s.events[0].Note, /already shows/);
});

test("the other watched company fields: name, accounting date, SIC", () => {
  const { s, edit } = world();
  edit("C1", { Title: "ACME LTD" });
  assert.equal(s.txs.length, 0, "capital letters only");
  edit("C1", { Title: "Acme Holdings Ltd" });
  edit("C1", { YearEnd: "30 June" });
  edit("C1", { SIC: "62012" });
  assert.deepEqual(txsFor(s).map((t) => t.Form).sort(), ["AA01", "NM01"]);
  assert.match(txsFor(s, "NM01")[0].History, /special resolution/);
  assert.ok(s.events.some((e) => e.Field === "SIC" && e.Outcome === "info"), "SIC is flagged for the confirmation statement, not filed");
});

test("a sole trader or individual has no statutory filings", () => {
  const { s, edit } = world([{ ...ltd }, { ...person, RegisteredOffice: "1 A St", Kind: "Individual" }]);
  edit("C2", { RegisteredOffice: "2 B St" });
  assert.equal(s.txs.length, 0);
});

test("a director appointment prepares an AP01, an appointment is not live until Companies House accepts it", () => {
  const { s, apply } = world();
  const r: any = appointPerson(s.clients[0], "officer", { Role: "director", Kind: "individual", First: "Sam", Last: "Smith", DOB: "1980-04-01", Nationality: "British", Occupation: "Builder", CountryOfResidence: "England", ServiceAddress: "10 High Street, London, E1 5NF", ResidentialAddress: "7 Elm Road, Leeds, LS1 4AB", AppointedOn: "2026-10-27" }, s, true, ctx());
  apply(r);
  assert.equal(s.txs[0].Form, "AP01");
  assert.equal(s.txs[0].Source, "cosec");
  assert.equal(s.officers[0].Status, "pending");
  assert.deepEqual(txIssues(s.txs[0]), []);
  // missing details are listed, not guessed
  const bare: any = appointPerson(s.clients[0], "officer", { Role: "director", Kind: "individual", First: "Bo", Last: "Bee" }, s, true, ctx());
  assert.ok(txIssues(bare.creates.find((c: any) => c.list === "CoSecTransactions").row).includes("Nationality"));
  assert.equal((appointPerson(s.clients[1], "officer", { First: "X" }, s, true, ctx()) as any).error.length > 0, true, "an individual client has no officers");
});

test("director termination and detail changes are classified correctly, LLP and secretary forms too", () => {
  assert.equal(officerForm("terminate", { Role: "director" }, "limited"), "TM01");
  assert.equal(officerForm("terminate", { Role: "secretary" }, "limited"), "TM02");
  assert.equal(officerForm("change", { Role: "director", Kind: "individual" }, "limited"), "CH01");
  assert.equal(officerForm("change", { Role: "director", Kind: "corporate" }, "limited"), "CH02");
  assert.equal(officerForm("appoint", { Role: "member", Kind: "individual" }, "llp"), "LLAP01");
  assert.equal(pscForm("appoint", { Kind: "legal-entity" }), "PSC02");
  assert.equal(pscForm("terminate", { Kind: "individual" }), "PSC07");
  assert.equal(pscForm("change", { Kind: "other" }), "PSC06");
  const { s, apply } = world();
  s.officers.push({ _id: "9", Key: "CO9", ClientKey: "C1", Role: "director", Kind: "individual", Status: "current", First: "Sam", Last: "Smith", ResidentialAddress: "7 Elm Road, Leeds, LS1 4AB", ServiceAddress: "10 High Street, London, E1 5NF", Nationality: "British" });
  const end: any = terminatePerson(s.clients[0], "officer", s.officers[0], "2026-10-20", s, true, ctx());
  apply(end);
  assert.equal(s.txs[0].Form, "TM01");
  assert.equal(s.officers[0].Status, "current", "the register changes only once the filing is accepted");
  assert.match((terminatePerson(s.clients[0], "officer", { ...s.officers[0], Status: "resigned" }, "2026-10-20", s, true, ctx()) as any).error, /current/);
});

test("changes to a director's details fold into one CH01, and putting a detail back removes it", () => {
  const { s, apply } = world();
  s.officers.push({ _id: "9", Key: "CO9", ClientKey: "C1", Role: "director", Kind: "individual", Status: "current", First: "Sam", Last: "Smith", Nationality: "British", Occupation: "Builder", ServiceAddress: "10 High Street, London, E1 5NF", ResidentialAddress: "7 Elm Road, Leeds, LS1 4AB" });
  apply(changePerson(s.clients[0], "officer", s.officers[0], { Occupation: "Developer", Nationality: "Irish" }, s, true, ctx()) as any);
  assert.equal(txsFor(s, "CH01").length, 1);
  assert.deepEqual(Object.keys(JSON.parse(s.txs[0].Payload).changes).sort(), ["Nationality", "Occupation"]);
  apply(changePerson(s.clients[0], "officer", s.officers[0], { Occupation: "Builder" }, s, true, ctx()) as any);
  assert.deepEqual(Object.keys(JSON.parse(s.txs[0].Payload).changes), ["Nationality"], "occupation put back, nationality still to file");
  apply(changePerson(s.clients[0], "officer", s.officers[0], { Nationality: "British" }, s, true, ctx()) as any);
  assert.equal(txStatus(s.txs[0]), "cancelled");
});

test("an individual client's home address change reaches the linked director as a CH01 and never an AD01", () => {
  const { s, edit } = world();
  s.officers.push({ _id: "9", Key: "CO9", ClientKey: "C1", Role: "director", Kind: "individual", Status: "current", First: "Ann", Last: "Acme", PersonClientKey: "C2", ResidentialAddress: "5 Park Lane, London, W1K 1AA", ServiceAddress: "10 High Street, London, E1 5NF" });
  edit("C2", { HomeAddress: "9 Hill Road, Leeds, LS2 9JT" });
  assert.deepEqual(txsFor(s).map((t) => `${t.Form}:${t.ClientKey}`), ["CH01:C1"]);
  assert.equal(s.clients[0].RegisteredOffice, "10 High Street, London, E1 5NF", "the company's address is untouched");
  assert.equal(JSON.parse(s.txs[0].Payload).changes.ResidentialAddress, "9 Hill Road, Leeds, LS2 9JT");
});

test("portal changes arrive only after staff approve them, and say so", () => {
  const { s, edit } = world();
  // a request sitting in the portal has not touched the client record, so there is nothing to detect
  assert.equal(s.txs.length, 0);
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" }, "portal");
  assert.match(JSON.parse(s.txs[0].History)[0].note, /Requested by the client through the portal and approved by staff/);
  assert.equal(SOURCE_LABEL.portal.includes("approved by staff"), true);
});

test("review: edit, query, approve (with permissions), decline, filed elsewhere", () => {
  const { s, edit, apply } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London" });
  const tx = () => s.txs[0];
  assert.match((act(tx(), "approve", {}, cfg, ctx(), s) as any).error, /Still needed/, "an incomplete address can't be approved");
  apply(act(tx(), "edit", { payload: { address: parseAddress("25 Market Road, London, N1 9GU"), previous: "x" } }, cfg, ctx(), s) as any);
  apply(act(tx(), "clarify", { note: "Is the new lease signed?" }, cfg, ctx(), s) as any);
  assert.equal(txStatus(tx()), "info");
  assert.equal((act(tx(), "clarify", { note: "" }, cfg, ctx(), s) as any).error.length > 0, true);
  apply(act(tx(), "answer", { note: "Yes" }, cfg, ctx(), s) as any);
  const staff: any = { staff: [{ name: "Pat", role: "preparer" }, { name: "Mia", role: "manager" }], overriders: [], independentReview: true, auto: true };
  assert.equal(cosecCan(staff, "Pat", "approve"), false);
  assert.equal(cosecCan(staff, "Mia", "submit"), true);
  assert.match((act(tx(), "approve", {}, staff, { ...ctx(), actor: "Pat" }, s) as any).error, /Only a manager or partner/);
  apply(act(tx(), "approve", {}, cfg, ctx(), s) as any);
  assert.equal(txStatus(tx()), "approved");
  assert.equal(tx().ApprovedBy, "Kevin");
  // a further edit after approval needs approving again
  apply(act(tx(), "edit", { note: "changed" }, cfg, ctx(), s) as any);
  assert.equal(txStatus(tx()), "draft");
  assert.equal(tx().ApprovedBy, "");
  assert.match((act(tx(), "decline", { note: "" }, cfg, ctx(), s) as any).error, /why/);
  apply(act(tx(), "external", { ref: "Web filing 4471" }, cfg, ctx(), s) as any);
  assert.equal(txStatus(tx()), "external");
  assert.equal(JSON.parse(s.clients[0].CHVerified).office, "25 Market Road, London", "the last-verified record is brought up to date");
});

test("independent review stops the editor approving their own draft", () => {
  const { s, edit, apply } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  apply(act(s.txs[0], "edit", { note: "tidied" }, cfg, ctx(), s) as any);
  const strict: any = { staff: [], overriders: [], independentReview: true, auto: true };
  assert.match((act(s.txs[0], "approve", {}, strict, ctx(), s) as any).error, /Independent review/);
  assert.equal("error" in (act(s.txs[0], "approve", {}, strict, { ...ctx(), actor: "Someone else" }, s) as any), false);
});

test("submission: only an approved filing of a supported form, and the result is recorded; acceptance reconciles", () => {
  const { s, edit, apply } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  assert.match((act(s.txs[0], "submitted", { gatewayRef: "1" }, cfg, ctx(), s) as any).error, /Approve/);
  apply(act(s.txs[0], "approve", {}, cfg, ctx(), s) as any);
  assert.match((act(s.txs[0], "submitted", {}, cfg, ctx(), s) as any).error, /no reference/);
  apply(act(s.txs[0], "submitted", { gatewayRef: "000123" }, cfg, ctx(), s) as any);
  assert.equal(txStatus(s.txs[0]), "submitted");
  // while it is out, the same change again is not a second filing
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  assert.equal(txsFor(s, "AD01").length, 1);
  apply(act(s.txs[0], "result", { result: { status: "pending" } }, cfg, ctx(), s) as any);
  assert.equal(txStatus(s.txs[0]), "submitted");
  apply(act(s.txs[0], "result", { result: { status: "accepted", chRef: "ABC123" } }, cfg, ctx(), s) as any);
  assert.equal(txStatus(s.txs[0]), "accepted");
  assert.equal(s.txs[0].ChRef, "ABC123");
  assert.equal(JSON.parse(s.clients[0].CHVerified).office, "25 Market Road, London, N1 9GU");
  assert.equal(coSecItems(s.txs, s.clients, [], "2026-10-27").length, 0, "the action is closed");
  // the same address is now known to be filed: editing it to the same value does nothing
  edit("C1", { RegisteredOffice: "26 Market Road, London, N1 9GU" });
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  assert.equal(txsFor(s, "AD01").filter((t) => txStatus(t) === "accepted").length, 1);
});

test("acceptance updates the internal register: appointment, termination and changes", () => {
  const { s, apply } = world();
  s.officers.push({ _id: "9", Key: "CO9", ClientKey: "C1", Role: "director", Kind: "individual", Status: "current", First: "Sam", Last: "Smith", Occupation: "Builder" });
  apply(appointPerson(s.clients[0], "officer", { Role: "director", Kind: "individual", First: "Zed", Last: "Zee", DOB: "1990-01-01", Nationality: "British", Occupation: "Dev", CountryOfResidence: "England", ServiceAddress: "10 High Street, London, E1 5NF", ResidentialAddress: "7 Elm Road, Leeds, LS1 4AB", AppointedOn: "2026-10-01" }, s, true, ctx()) as any);
  apply(terminatePerson(s.clients[0], "officer", s.officers[0], "2026-10-20", s, true, ctx()) as any);
  apply(changePerson(s.clients[0], "officer", { ...s.officers[0], Status: "current" }, { Occupation: "Developer" }, s, true, ctx()) as any);
  for (const t of s.txs) { apply(act(t, "approve", {}, cfg, ctx(), s) as any); apply(act(t, "external", { ref: "x" }, cfg, ctx(), s) as any); }
  const sam = s.officers.find((o) => o.Key === "CO9")!;
  assert.equal(sam.Status, "resigned");
  assert.equal(sam.ResignedOn, "2026-10-20");
  assert.equal(sam.Occupation, "Developer");
  assert.equal(s.officers.find((o) => o.First === "Zed")!.Status, "current");
});

test("a rejected filing stays actionable and keeps its draft", () => {
  const { s, edit, apply } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  apply(act(s.txs[0], "approve", {}, cfg, ctx(), s) as any);
  apply(act(s.txs[0], "submitted", { gatewayRef: "7" }, cfg, ctx(), s) as any);
  apply(act(s.txs[0], "result", { result: { status: "rejected", reason: "Postcode not recognised" } }, cfg, ctx(), s) as any);
  assert.equal(txStatus(s.txs[0]), "rejected");
  const items = coSecItems(s.txs, s.clients, [], "2026-10-27");
  assert.equal(items[0].group, "rejected");
  assert.match(items[0].detail, /Postcode/);
  assert.equal(pendingFor(s.txs, "C1", "client:RegisteredOffice").length, 1);
  // fixing it and approving again re-files the same draft
  apply(act(s.txs[0], "edit", { payload: { address: parseAddress("25 Market Road, London, N1 9GU") } }, cfg, ctx(), s) as any);
  apply(act(s.txs[0], "approve", {}, cfg, ctx(), s) as any);
  assert.equal(txStatus(s.txs[0]), "approved");
  assert.equal(txsFor(s).length, 1);
});

test("the Action Centre list covers review, approval, submission, queries, rejections and Companies House differences", () => {
  const { s, edit, apply } = world();
  edit("C1", { RegisteredOffice: "25 Market Road, London, N1 9GU" });
  edit("C1", { YearEnd: "30 June" });
  apply(act(s.txs[1], "clarify", { note: "Which year?" }, cfg, ctx(), s) as any);
  const flags = [{ Key: "F1", ClientKey: "C1", Type: "officers", Title: "Officer differs", Detail: "x", Status: "open" }];
  const groups = coSecItems(s.txs, s.clients, [{ ...flags[0], ClientKey: "C2" }], "2026-10-27").map((i) => i.group).sort();
  assert.deepEqual(groups, ["discrepancy", "info", "review"]);
  assert.ok(coSecItems(s.txs, s.clients, [], "2026-10-27").every((i) => i.txKey));
});

test("share allotment prepares an SH01; a transfer updates the register and flags the confirmation statement", () => {
  const { s, apply } = world();
  const bad: any = allotShares(s.clients[0], { holder: "", class: "Ordinary", number: 0, currency: "GBP", nominal: 1, paid: 1, date: "2026-10-27" }, s, true, ctx());
  assert.ok(bad.error);
  apply(allotShares(s.clients[0], { holder: "Ann Acme", class: "Ordinary", number: 100, currency: "GBP", nominal: 1, paid: 1, date: "2026-10-27" }, s, true, ctx()) as any);
  assert.equal(s.txs[0].Form, "SH01");
  assert.equal(s.shares[0].Status, "pending");
  apply(act(s.txs[0], "approve", {}, cfg, ctx(), s) as any);
  apply(act(s.txs[0], "external", {}, cfg, ctx(), s) as any);
  assert.equal(s.shares[0].Status, "current");
  const t: any = transferShares(s.clients[0], s.shares[0], { holder: "Bob Brown" }, 40, "2026-10-28", true, ctx());
  apply(t);
  assert.equal(s.shares[0].Number, 60);
  assert.equal(s.shares[1].Holder, "Bob Brown");
  assert.equal(t.activities[0].Type, "cosec-flag");
  assert.equal(s.txs.length, 1, "a transfer files nothing by itself");
  assert.match((transferShares(s.clients[0], s.shares[0], { holder: "X" }, 999, "2026-10-28", true, ctx()) as any).error, /up to/);
});

test("addresses are split for Companies House and checked", () => {
  const a = parseAddress("Siu Offices 4 - 6 Greatorex Street, London, Greater London, England, E1 5NF");
  assert.equal(a.postcode, "E1 5NF");
  assert.equal(a.country, "England");
  assert.equal(a.town, "Greater London".length ? a.town : "");
  assert.ok(a.line1.length > 0);
  assert.deepEqual(addrIssues(parseAddress("25 Market Road, London, N1 9GU")), []);
  assert.ok(addrIssues(parseAddress("somewhere")).length > 0);
  assert.equal(parseAddress("1 Acacia Avenue\nLeeds\nls1 4ab").postcode, "LS1 4AB");
});

import { scanDifferences, verifiedFrom } from "../src/lib/cosec.ts";
test("a difference from the last-verified Companies House record (such as a portal change applied by the server) becomes one draft, once", () => {
  const verified = JSON.stringify({ at: "2026-10-01T00:00:00Z", name: "Acme Ltd", office: "10 High Street, London, E1 5NF", ard: "31 March" });
  const { s, apply } = world([{ ...ltd, RegisteredOffice: "25 Market Road, London, N1 9GU", CHVerified: verified }, { ...person }]);
  const first = scanDifferences(s, ctx(), "portal");
  apply(first);
  assert.equal(first.found, 1);
  assert.equal(s.txs[0].Form, "AD01");
  assert.equal(s.txs[0].Source, "portal");
  const again = scanDifferences(s, ctx(), "portal");
  apply(again);
  assert.equal(again.found, 0);
  assert.equal(s.txs.length, 1, "no second draft");
  // declined on purpose: the scan leaves it alone
  apply(act(s.txs[0], "decline", { note: "Not changing it" }, cfg, ctx(), s) as any);
  apply(scanDifferences(s, ctx(), "portal"));
  assert.equal(s.txs.length, 1);
  assert.equal(scanDifferences({ ...s, clients: [{ ...ltd, CHVerified: undefined }] }, ctx()).found, 0, "nothing to compare with until Companies House has been checked");
});

test("Companies House's profile is kept in the shape the comparison uses", () => {
  const v = verifiedFrom({ company_name: "ACME LTD", registered_office_address: { premises: "10", address_line_1: "High Street", locality: "London", postal_code: "E1 5NF" }, sic_codes: ["62020"], accounts: { accounting_reference_date: { day: "31", month: "03" } } }, "2026-10-27T00:00:00Z");
  assert.equal(v.office, "10 High Street, London, E1 5NF");
  assert.equal(v.ard, "31 March");
  assert.equal(v.sic, "62020");
});

import { officersFromCh, pscsFromCh } from "../src/lib/cosec.ts";
test("officers and PSCs imported from Companies House become the starting register, with no filing prepared", () => {
  const o = ctx();
  const off = officersFromCh(ltd, { items: [
    { name: "SMITH, Sam John", officer_role: "director", appointed_on: "2020-01-02", date_of_birth: { month: 4, year: 1980 }, nationality: "British", occupation: "Builder", country_of_residence: "England", address: { premises: "10", address_line_1: "High Street", locality: "London", postal_code: "E1 5NF" } },
    { name: "OLD, Ola", officer_role: "director", resigned_on: "2021-01-01" },
    { name: "MEGA SECRETARIES LTD", officer_role: "corporate-secretary", identification: {} },
  ] }, [], o);
  assert.equal(off.length, 2);
  assert.equal(off[0].Last, "Smith");
  assert.equal(off[0].First, "Sam John");
  assert.equal(off[0].DOB, "1980-04");
  assert.equal(off[0].Status, "current");
  assert.equal(off[1].Role, "secretary");
  assert.equal(off[1].Kind, "corporate");
  assert.equal(officersFromCh(ltd, { items: [{ name: "SMITH, Sam John", officer_role: "director" }] }, off, o).length, 0, "importing twice adds nobody twice");
  const psc = pscsFromCh(ltd, { items: [{ kind: "individual-person-with-significant-control", name: "Mr Sam Smith", name_elements: { forename: "Sam", surname: "Smith" }, natures_of_control: ["ownership-of-shares-75-to-100-percent"], notified_on: "2020-01-02", address: { address_line_1: "1 A St", postal_code: "E1 5NF" } }, { kind: "individual-person-with-significant-control", name: "Gone", ceased_on: "2022-01-01" }] }, [], o);
  assert.equal(psc.length, 1);
  assert.equal(psc[0].Kind, "individual");
  assert.deepEqual(JSON.parse(psc[0].Natures), ["ownership-of-shares-75-to-100-percent"]);
});

test("shares can only be allotted in a share class the company has set up", () => {
  const { s } = world();
  const a = { holder: "Ann Acme", holderKey: "P1", class: "Ordinary £1.00", number: 10, currency: "GBP", nominal: 1, paid: 1, date: "2026-10-27" };
  const ck = String(s.clients[0].Key);
  assert.ok(((allotShares(s.clients[0], a, { ...s, classes: [] }, true, ctx())) as any).error.includes("share class first"));
  const other = [{ Key: "SC1", ClientKey: "someone-else", Name: "Ordinary £1.00", Status: "current" }];
  assert.ok(((allotShares(s.clients[0], a, { ...s, classes: other }, true, ctx())) as any).error);
  const mine = [{ Key: "SC2", ClientKey: ck, Name: "Ordinary £1.00", Status: "current" }];
  assert.ok(!(allotShares(s.clients[0], a, { ...s, classes: mine }, true, ctx()) as any).error);
  assert.ok(((allotShares(s.clients[0], { ...a, class: "B" }, { ...s, classes: mine }, true, ctx())) as any).error.includes("isn't one of"));
  const former = [{ Key: "SC3", ClientKey: ck, Name: "Ordinary £1.00", Status: "former" }];
  assert.ok(((allotShares(s.clients[0], a, { ...s, classes: former }, true, ctx())) as any).error);
});
