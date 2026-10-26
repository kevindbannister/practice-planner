import test from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_SECTIONS, DEFAULT_ENGAGEMENT_SETTINGS, EngagementSettings, addYears, advanceEng, coverageGaps, decide, editDraft, engagementAlerts, engagementCan, engagementDocument, generate, intact, markSigned, nextRef,
  readBody, readDecisions, recall, letterFor, readEngagementSettings, requestReview, reviewStatus, reviewTemplate, reviewYears, sealHash, sendOut, templateFor, uploadExternal, wordingHash, regenerate,
} from "../src/lib/engagements.ts";
import { readCatalogue } from "../src/lib/proposals.ts";

let n = 0;
const O = { actor: "Kevin", now: "2026-10-26T10:00:00.000Z", pid: "default", newKey: (p: string) => `${p}${++n}` };
const TODAY = "2026-10-26";
const yes = () => true;
const no = () => false;
const cfg = (staff: { name: string; role: string }[]): any => ({ staff, overriders: [], independentReview: false, auto: true });

const reviewedSettings = (o: Partial<EngagementSettings> = {}): EngagementSettings => {
  const s: EngagementSettings = { ...DEFAULT_ENGAGEMENT_SETTINGS, base: { ...BLANK_SECTIONS, terms: "Our terms apply.", clientResp: "Keep records.", feeTerms: "Fees are due in 14 days." }, ...o };
  const r = reviewTemplate(s, "base", yes, "Sam", O.now);
  if ("error" in r) throw new Error(r.error);
  return r.settings;
};
const catalogue = readCatalogue([
  { Key: "ACC", Title: "Annual accounts", Offered: true, Price: 1200, PriceFrequency: "annual", ClientTypes: "limited", Scope: "Prepare accounts\nFile at Companies House", Clauses: "Accounts are prepared on the basis of the records you give us.", ClientResp: "Provide records by the agreed date", PracticeResp: "Meet filing deadlines" },
  { Key: "VAT", Title: "VAT returns", Offered: true, Price: 90, PriceFrequency: "quarterly", ClientTypes: "limited" },
] as any);
const client: any = { Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CompanyNumber: "01234567", RegisteredOffice: "1 High St" };
const agreed = (keys = ["ACC", "VAT"]) => JSON.stringify({ vatRate: 0.2, lines: keys.map((k, i) => ({ id: `l${i}`, serviceKey: k, name: k === "ACC" ? "Annual accounts" : "VAT returns", frequency: k === "ACC" ? "annual" : "quarterly", price: k === "ACC" ? 1200 : 90, discount: null, setupFee: 0, vat: "standard", optional: false })) });
const proposal = (o: any = {}): any => ({ Key: "PR1", Ref: "P-2026-0001", Status: "accepted", ClientKey: "C1", OppKey: "O1", AcceptedVersion: 1, ...o });
const version = (o: any = {}): any => ({ Key: "PV1", ProposalKey: "PR1", Version: 1, Status: "accepted", Agreed: agreed(), ...o });
const gen = (o: any = {}) => generate({ proposal: proposal(), version: version(), client, settings: reviewedSettings(), catalogue, existing: [], practice: "Bannister & Co", today: TODAY, can: yes, ...o }, O);
const made = (o: any = {}) => { const g: any = gen(o); if ("error" in g) throw new Error(g.error); return g.engagement; };

test("review interval: engagement, then client, then template, then practice, default three years", () => {
  const s: EngagementSettings = { ...DEFAULT_ENGAGEMENT_SETTINGS, years: 4, typeYears: { limited: 2 }, clientYears: { C1: 5 } };
  assert.equal(reviewYears(DEFAULT_ENGAGEMENT_SETTINGS, {}), 3);
  assert.equal(reviewYears(s, { type: "individual" }), 4);
  assert.equal(reviewYears(s, { type: "limited" }), 2);
  assert.equal(reviewYears(s, { type: "limited", clientKey: "C1" }), 5);
  assert.equal(reviewYears(s, { type: "limited", clientKey: "C1", engagementYears: "1" }), 1);
  assert.equal(reviewYears(s, { type: "limited", clientKey: "C1", engagementYears: "99" }), 5, "an out-of-range value is ignored");
});

test("adding years: same day, with 29 February landing on 28 February", () => {
  assert.equal(addYears("2026-10-26", 3), "2029-10-26");
  assert.equal(addYears("2024-02-29", 3), "2027-02-28");
  assert.equal(addYears("2024-02-29", 4), "2028-02-29");
});

test("settings are read safely and sanitised", () => {
  assert.equal(readEngagementSettings([]).years, 3);
  assert.equal(readEngagementSettings([{ Key: "engagement.settings", Value: "not json" }]).years, 3);
  const s = readEngagementSettings([{ Key: "engagement.settings", Value: JSON.stringify({ years: 7, typeYears: { limited: 0, individual: 2 }, clientYears: { C9: 3, C8: "x" }, remindDays: [30, 90, 0, 400, "a"], base: { terms: "T", wording: 5 } }) }]);
  assert.equal(s.years, 7);
  assert.deepEqual(s.typeYears, { individual: 2 });
  assert.deepEqual(s.clientYears, { C9: 3 });
  assert.deepEqual(s.remindDays, [90, 30]);
  assert.equal(s.base.terms, "T");
  assert.equal(s.base.wording, BLANK_SECTIONS.wording, "a non-text section falls back");
});

test("client-type wording overrides the practice wording", () => {
  const s: EngagementSettings = { ...DEFAULT_ENGAGEMENT_SETTINGS, base: { ...BLANK_SECTIONS, terms: "Base terms" }, byType: { individual: { terms: "Individual terms" } } };
  assert.equal(templateFor(s, "limited").terms, "Base terms");
  assert.equal(templateFor(s, "individual").terms, "Individual terms");
  assert.equal(templateFor(s, "individual").confidentiality, "");
});

test("wording must be reviewed, and changing it un-reviews it", () => {
  assert.equal(reviewStatus(DEFAULT_ENGAGEMENT_SETTINGS, "limited").ok, false);
  const s = reviewedSettings();
  assert.equal(reviewStatus(s, "limited").ok, true);
  assert.equal(reviewStatus({ ...s, base: { ...s.base, terms: "Changed" } }, "limited").ok, false);
  assert.equal(reviewStatus({ ...s, byType: { limited: { terms: "Own terms" } } }, "limited").ok, false, "a type with its own wording needs its own review");
  assert.equal("error" in reviewTemplate(s, "base", no, "Pat", O.now), true, "only a manager can mark it reviewed");
  assert.notEqual(wordingHash(s.base), wordingHash({ ...s.base, terms: "x" }));
});

test("a letter is generated from the accepted proposal: services, clauses, responsibilities, fees, signature, review date", () => {
  const e = made();
  assert.equal(e.Status, "draft");
  assert.equal(e.Source, "generated");
  assert.equal(e.Ref, "E-2026-0001");
  assert.deepEqual(JSON.parse(e.ServiceKeys), ["ACC", "VAT"]);
  assert.equal(e.ReviewDate, "2029-10-26");
  const text = JSON.stringify(readBody(e.Body));
  for (const bit of ["Acme Ltd", "01234567", "Annual accounts", "File at Companies House", "Accounts are prepared on the basis", "Provide records by the agreed date", "Meet filing deadlines", "Our terms apply.", "Fees are due in 14 days.", "£1,200.00", "26 October 2029", "P-2026-0001", "Signature"]) assert.ok(text.includes(bit), bit);
  assert.ok(!text.includes("{{"), "no merge field left unfilled");
});

test("generation is refused unless the proposal is accepted, the wording reviewed and you may edit", () => {
  assert.match((gen({ version: version({ Status: "sent" }) }) as any).error, /accepted proposal/);
  assert.match((gen({ settings: DEFAULT_ENGAGEMENT_SETTINGS }) as any).error, /reviewed/);
  assert.match((gen({ can: no }) as any).error, /can't create/);
  assert.match((gen({ version: version({ Agreed: "" }) }) as any).error, /what was agreed/);
});

test("one live letter per proposal version, but a client can have several engagements", () => {
  const first = made();
  assert.match((gen({ existing: [first] }) as any).error, /already an engagement letter/);
  const other = made({ proposal: proposal({ Key: "PR2", Ref: "P-2026-0002" }), version: version({ ProposalKey: "PR2", Agreed: agreed(["VAT"]) }), existing: [first] });
  assert.equal(other.Ref, "E-2026-0002");
  assert.equal(other.ClientKey, first.ClientKey);
  assert.equal(nextRef([first, other], 2026), "E-2026-0003");
});

test("the letter's effective date and review interval can be edited on a draft, and move the review date", () => {
  const e = made();
  const w: any = editDraft(e, { effectiveDate: "2026-12-01", reviewYears: "5", signatories: ["Ann Smith"] }, reviewedSettings(), () => ({ blocks: [{ type: "p", runs: [{ t: "rebuilt" }] }] }), yes, O);
  assert.equal(w.patches[0].patch.ReviewDate, "2031-12-01");
  assert.equal(w.patches[0].patch.ReviewYears, "5");
  assert.equal(JSON.parse(w.patches[0].patch.Signatories)[0], "Ann Smith");
  assert.match((editDraft(e, { effectiveDate: "nope" }, reviewedSettings(), () => undefined, yes, O) as any).error, /date/);
  assert.match((editDraft(e, { reviewYears: "11" }, reviewedSettings(), () => undefined, yes, O) as any).error, /whole number/);
  assert.match((editDraft({ ...e, Status: "approved" }, {}, reviewedSettings(), () => undefined, yes, O) as any).error, /Only a draft/);
});

test("workflow: draft to review to approved, with review rules and independence", () => {
  const e = made();
  assert.equal((advanceEng(e, "review", "", false, yes, O) as any).patches[0].patch.Status, "review");
  assert.match((advanceEng(e, "approved", "", true, yes, O) as any).error, /Someone else/);
  const ok: any = advanceEng({ ...e, Status: "review" }, "approved", "", true, yes, { ...O, actor: "Sam" });
  assert.equal(ok.patches[0].patch.ApprovedBy, "Sam");
  assert.match((advanceEng(e, "out" as any, "", false, yes, O) as any).error, /can't go/);
  assert.match((advanceEng({ ...e, Status: "review" }, "approved", "", false, no, O) as any).error, /can't approve/);
});

test("sending out seals the letter; signing sets the review date from the effective date and updates the client's letter status", () => {
  const e = { ...made(), Status: "approved" };
  const out: any = sendOut(e, { hash: "abc", portalDocId: "d1", signingId: "s1", signatories: ["Ann"], method: "portal" }, client, yes, TODAY, O);
  assert.equal(out.patches[0].patch.Status, "out");
  assert.equal(out.patches.find((p: any) => p.list === "Clients").patch.LoEStatus, "Active");
  assert.match((sendOut({ ...e, Status: "draft" }, { hash: "abc", signatories: [], method: "paper" }, client, yes, TODAY, O) as any).error, /Approve/);
  assert.match((sendOut(e, { hash: "abc", signatories: [], method: "portal" }, client, yes, TODAY, O) as any).error, /who signs/);
  assert.match((sendOut(e, { hash: "abc", signatories: ["A"], signingId: "s", method: "portal" }, client, no, TODAY, O) as any).error, /manager/);
  const signed: any = markSigned({ ...e, Status: "out", EffectiveDate: "2026-11-01" }, { by: "Ann", at: "2026-11-03T09:00:00Z", method: "portal", evidence: "" }, undefined, client, reviewedSettings(), yes, TODAY, O);
  assert.equal(signed.patches[0].patch.Status, "signed");
  assert.equal(signed.patches[0].patch.ReviewDate, "2029-11-01");
  assert.equal(signed.patches.find((p: any) => p.list === "Clients").patch.LoEStatus, "Finalised");
  assert.match((markSigned({ ...e, Status: "out" }, { by: "Ann", at: "x", method: "paper", evidence: "" }, undefined, client, reviewedSettings(), yes, TODAY, O) as any).error, /how you know/);
  assert.match((markSigned({ ...e, Status: "draft" }, { by: "Ann", at: "x", method: "portal", evidence: "" }, undefined, client, reviewedSettings(), yes, TODAY, O) as any).error, /sent for signature/);
});

test("the seal detects a changed letter", async () => {
  const e = made();
  const sealed = { ...e, Hash: await sealHash(String(e.Body)) };
  assert.equal(await intact(sealed), true);
  assert.equal(await intact({ ...sealed, Body: String(e.Body) + " " }), false);
  assert.equal(await intact(e), true, "unsealed drafts have nothing to compare");
});

test("signing a renewal supersedes the old letter and keeps it", () => {
  const old: any = { ...made(), Status: "signed", Key: "ENold" };
  const next: any = { ...made({ existing: [old], previousKey: "ENold" }), Status: "out", PreviousKey: "ENold" };
  const w: any = markSigned(next, { by: "Ann", at: "2029-10-20T09:00:00Z", method: "portal", evidence: "" }, old, client, reviewedSettings(), yes, TODAY, O);
  const sup = w.patches.find((p: any) => p.row === old);
  assert.equal(sup.patch.Status, "superseded");
  assert.equal(sup.patch.SupersededBy, next.Key);
  assert.ok(w.log.some((l: any) => l.Action === "superseded"));
});

test("a letter made elsewhere can be filed, signed or unsigned, with its own renewal date", () => {
  const base = { clientKey: "C1", title: "", documentDate: "2025-04-01", effectiveDate: "2025-04-06", signatories: ["Ann Smith"], signed: true, serviceKeys: ["ACC"], serviceNames: ["Annual accounts"], notes: "n", docKey: "D1", fileUrl: "https://x", fileName: "loe.pdf", clientType: "limited" as const };
  const w: any = uploadExternal(base, [], DEFAULT_ENGAGEMENT_SETTINGS, yes, TODAY, client, O);
  const row = w.creates[0].row;
  assert.equal(row.Status, "signed");
  assert.equal(row.Source, "uploaded");
  assert.equal(row.ReviewDate, "2028-04-06");
  assert.equal(w.patches.find((p: any) => p.list === "Clients").patch.LoEStatus, "Finalised");
  const un: any = uploadExternal({ ...base, signed: false, signatories: [], reviewDate: "2027-01-01" }, [], DEFAULT_ENGAGEMENT_SETTINGS, yes, TODAY, client, O);
  assert.equal(un.creates[0].row.Status, "unsigned");
  assert.equal(un.creates[0].row.ReviewDate, "2027-01-01");
  assert.equal(un.patches.length, 0, "an unsigned letter does not mark the client's letter as signed");
  assert.match((uploadExternal({ ...base, docKey: "" }, [], DEFAULT_ENGAGEMENT_SETTINGS, yes, TODAY, client, O) as any).error, /Upload/);
  assert.match((uploadExternal({ ...base, effectiveDate: "x" }, [], DEFAULT_ENGAGEMENT_SETTINGS, yes, TODAY, client, O) as any).error, /takes effect/);
  assert.match((uploadExternal({ ...base, signatories: [] }, [], DEFAULT_ENGAGEMENT_SETTINGS, yes, TODAY, client, O) as any).error, /who signed/);
  assert.match((uploadExternal(base, [], DEFAULT_ENGAGEMENT_SETTINGS, no, TODAY, client, O) as any).error, /can't file/);
});

test("a replacement uploaded for an engagement supersedes it", () => {
  const old: any = { ...made(), Status: "signed", Key: "ENold" };
  const w: any = uploadExternal({ clientKey: "C1", title: "New", documentDate: "2029-10-01", effectiveDate: "2029-10-26", signatories: ["Ann"], signed: true, serviceKeys: ["ACC"], serviceNames: [], notes: "", docKey: "D2", fileUrl: "", fileName: "x.pdf", clientType: "limited", replaces: old }, [old], DEFAULT_ENGAGEMENT_SETTINGS, yes, TODAY, client, O);
  assert.equal(w.patches.find((p: any) => p.row === old).patch.Status, "superseded");
  assert.equal(w.creates[0].row.PreviousKey, "ENold");
});

test("renewal decisions need authority and a reason, and are kept", () => {
  const e: any = { ...made(), Status: "signed", ReviewDate: "2026-12-01" };
  const can = (a: string) => engagementCan(cfg([{ name: "Kevin", role: "partner" }]), "Kevin", a as any);
  assert.match((decide(e, "extend", { note: "", newDate: "2027-12-01" }, reviewedSettings(), can, TODAY, O) as any).error, /Say why/);
  assert.match((decide(e, "extend", { note: "ok", newDate: "2026-11-01" }, reviewedSettings(), can, TODAY, O) as any).error, /later/);
  assert.match((decide(e, "extend", { note: "ok", newDate: "2050-01-01" }, reviewedSettings(), can, TODAY, O) as any).error, /too far/);
  const ext: any = decide(e, "extend", { note: "Client unchanged", newDate: "2027-12-01" }, reviewedSettings(), can, TODAY, O);
  assert.equal(ext.patches[0].patch.ReviewDate, "2027-12-01");
  const d = readDecisions(ext.patches[0].patch.Decisions);
  assert.deepEqual([d[0].decision, d[0].from, d[0].to, d[0].note], ["extend", "2026-12-01", "2027-12-01", "Client unchanged"]);
  const none: any = decide(e, "no-new-letter", { note: "Terms still fit" }, reviewedSettings(), can, TODAY, O);
  assert.equal(none.patches[0].patch.ReviewDate, "2029-10-26");
  const preparer = (a: string) => engagementCan(cfg([{ name: "Kevin", role: "preparer" }]), "Kevin", a as any);
  assert.match((decide(e, "extend", { note: "x", newDate: "2027-12-01" }, reviewedSettings(), preparer, TODAY, O) as any).error, /manager/);
  assert.match((decide({ ...e, Status: "draft" }, "extend", { note: "x", newDate: "2027-12-01" }, reviewedSettings(), can, TODAY, O) as any).error, /in force/);
  const end: any = decide(e, "end", { note: "Client left" }, reviewedSettings(), can, TODAY, O);
  assert.equal(end.patches[0].patch.Status, "ended");
});

test("an earlier review can be requested, and clears when a decision is made", () => {
  const e: any = { ...made(), Status: "signed" };
  const w: any = requestReview(e, "New service added", yes, O);
  assert.equal(w.patches[0].patch.ReviewRequest, "New service added");
  assert.match((requestReview(e, " ", yes, O) as any).error, /what has changed/);
  const flagged = { ...e, ReviewRequest: "New service added" };
  const d: any = decide(flagged, "no-new-letter", { note: "Covered already" }, reviewedSettings(), yes, TODAY, O);
  assert.equal(d.patches[0].patch.ReviewRequest, "");
});

test("a service agreed but not covered by any live engagement is a gap; a second engagement closes it", () => {
  const e = { ...made(), Status: "signed" };
  const e2 = { ...e, Key: "EN9", ServiceKeys: JSON.stringify(["ACC"]) };
  const p = proposal();
  const v = version({ Agreed: agreed(["ACC", "VAT", "ACC"]) });
  assert.deepEqual(coverageGaps("C1", [p], [v], [e2], catalogue).map((g) => g.serviceKey), ["VAT"]);
  assert.deepEqual(coverageGaps("C1", [p], [v], [e, e2], catalogue), []);
  assert.deepEqual(coverageGaps("C1", [p], [v], [{ ...e, Status: "superseded" }], catalogue).map((g) => g.serviceKey), ["ACC", "VAT"], "a superseded letter covers nothing");
});

test("alerts: renewal windows, overdue, awaiting signature, early review, uncovered services", () => {
  const s = DEFAULT_ENGAGEMENT_SETTINGS;
  const e = (o: any) => ({ ...made(), Key: `E${++n}`, Status: "signed", ...o });
  const clients = [client];
  const al = (rows: any[], extra: any = {}) => engagementAlerts(rows, extra.proposals || [], extra.versions || [], clients, s, TODAY, catalogue);
  assert.equal(al([e({ ReviewDate: "2027-06-01" })]).length, 0, "far away: nothing");
  assert.equal(al([e({ ReviewDate: "2027-01-10" })])[0].level, "amber");
  assert.equal(al([e({ ReviewDate: "2026-11-10" })])[0].level, "red");
  assert.match(al([e({ ReviewDate: "2026-10-01" })])[0].title, /overdue/);
  assert.match(al([e({ Status: "out", SentOn: "2026-10-10T00:00:00Z" })])[0].title, /awaiting signature/);
  assert.equal(al([e({ Status: "out", SentOn: "2026-10-25T00:00:00Z" })]).length, 0);
  assert.match(al([e({ ReviewDate: "2030-01-01", ReviewRequest: "Law changed" })])[0].title, /Early/);
  assert.equal(al([e({ Status: "superseded", ReviewDate: "2026-10-01" })]).length, 0);
  const gap = al([], { proposals: [proposal()], versions: [version()] });
  assert.match(gap[0].title, /No engagement letter yet/);
});

test("regenerating a draft picks up new wording; other statuses refuse", () => {
  const e = made();
  const s2 = reviewedSettings({ base: { ...BLANK_SECTIONS, terms: "Revised terms" } });
  const w: any = regenerate(e, { proposal: proposal(), version: version(), client, settings: s2, catalogue, practice: "B", today: TODAY, can: yes }, O);
  assert.ok(String(w.patches[0].patch.Body).includes("Revised terms"));
  assert.match((regenerate({ ...e, Status: "approved" }, { proposal: proposal(), version: version(), client, settings: s2, catalogue, practice: "B", today: TODAY, can: yes }, O) as any).error, /Only a draft/);
});

test("the letter shows the agreed fees, including discounts and any optional services the client chose", () => {
  const a = { vatRate: 0.2, lines: [
    { id: "a", serviceKey: "ACC", name: "Annual accounts", frequency: "annual", price: 1000, discount: { kind: "pct", value: 10 }, setupFee: 0, vat: "standard", optional: false },
    { id: "b", serviceKey: "VAT", name: "VAT returns", frequency: "annual", price: 100, discount: null, setupFee: 0, vat: "standard", optional: true },
  ] } as any;
  const doc = engagementDocument({ sections: BLANK_SECTIONS, client: { name: "Acme", address: "", companyNumber: "", type: "limited" }, practice: "P", agreed: a, catalogue, ref: "E-1", date: TODAY, effectiveDate: TODAY, reviewDate: "2029-10-26", years: 3, proposalRef: "P-1", signatories: ["Ann"] });
  const t = JSON.stringify(doc);
  assert.ok(t.includes("£900.00"), "net after the 10% discount");
  assert.ok(t.includes("First year, excluding VAT: £1,000.00"), "the chosen optional service is in the total");
});

test("a letter out for signature can be taken back to approved; anything else can't", () => {
  const out = { ...made(), Status: "out", Hash: "h", SigningId: "s1" };
  const w: any = recall(out, "declined", yes, O);
  assert.deepEqual([w.patches[0].patch.Status, w.patches[0].patch.Hash, w.patches[0].patch.SigningId], ["approved", "", ""]);
  assert.match((recall({ ...out, Status: "signed" }, "x", yes, O) as any).error, /isn't out/);
  assert.match((recall(out, "x", no, O) as any).error, /manager/);
});

test("letterFor rebuilds the letter for new dates and signatories, and says nothing without an agreed record", () => {
  const e = made();
  const i = { proposal: proposal(), version: version(), client, settings: reviewedSettings(), catalogue, practice: "B", today: TODAY };
  const doc = letterFor(e, i, "2027-01-01", 5, ["Zed"])!;
  const t = JSON.stringify(doc);
  assert.ok(t.includes("1 January 2027") && t.includes("1 January 2032") && t.includes("Zed"));
  assert.equal(letterFor(e, { ...i, version: version({ Agreed: "" }) }, "2027-01-01", 5, []), undefined);
});
