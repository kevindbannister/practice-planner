import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as e from "../src/lib/payroll/engine.ts";
import * as r from "../src/lib/payroll/rti.ts";

const Y = 2027;
const scheme: r.Scheme = { officeNo: "123", payeRef: "AB45678", aoRef: "123PA00045678", cotaxRef: "1234567890", name: "Example Trading Ltd" };
const setup: e.PersonSetup = { taxCode: "1257L", niLetter: "A", director: { method: "AN", apptWeek: 1 }, pension: { kind: "none", eePct: 0, erPct: 0, basis: "qualifying" } };
const alex: r.FpsPerson = { nino: "AB123456C", first: "Alex", last: "Example", birthDate: "1980-05-01", gender: "M", address: ["1 High Street", "Leeds"], postcode: "LS1 1AA", payId: "001", letter: "A", director: { method: "AN" }, hours: "E" };
const sam: r.FpsPerson = { nino: "", first: "Sam", last: "O'Neill-Example", birthDate: "1990-02-03", gender: "F", address: ["2 Low Road"], postcode: "LS2 2BB", payId: "002", letter: "A", hours: "D", studentPlan: "plan2", starter: { startDate: "2026-05-01", declaration: "B", studentLoan: true } };
const hasXmllint = (() => { try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const dir = mkdtempSync(join(tmpdir(), "rti-"));
function validate(xml: string, xsd: string) {
  if (!hasXmllint) return;
  const f = join(dir, `m${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(f, xml);
  try { execFileSync("xmllint", ["--noout", "--schema", join(import.meta.dirname, "rti", xsd), f], { stdio: "pipe" }); }
  catch (err: any) { assert.fail(String(err.stderr || err.message)); }
}

test("an FPS for a director and a new employee is valid against HMRC's 2026-27 schema", () => {
  const l1 = e.payLine(setup, { basic: 1047.5 }, "M1", 8, { ...e.zeroYtd(), taxablePay: 7332.5, niEarnings: 7332.5, er: 349.88 }, Y) as e.Line;
  const l2 = e.payLine({ ...setup, director: undefined, studentPlan: "plan2" }, { basic: 3000, nonTaxable: 25.5 }, "M1", 8, e.zeroYtd(), Y) as e.Line;
  const xml = r.buildFps({ scheme, year: Y, freq: "M1", period: 8, payday: "2026-11-28", people: [{ person: alex, line: l1 }, { person: sam, line: l2 }] });
  assert.match(xml, /<DirectorsNIC>AN<\/DirectorsNIC>/);
  assert.match(xml, /<StudentLoanRecovered PlanType="02">49.00<\/StudentLoanRecovered>/);
  assert.match(xml, /<Sender>Agent<\/Sender>/);
  assert.match(xml, /<RelatedTaxYear>26-27<\/RelatedTaxYear>/);
  validate(xml.replace(r.IRMARK_PLACEHOLDER, "abc"), "FullPaymentSubmission-2027-v1-0.xsd");
});

test("the last FPS of the year is marked final", () => {
  const l = e.payLine(setup, { basic: 12570 }, "M1", 12, e.zeroYtd(), Y) as e.Line;
  const xml = r.buildFps({ scheme, year: Y, freq: "M1", period: 12, payday: "2027-03-31", people: [{ person: alex, line: l }], final: true });
  assert.match(xml, /<FinalSubmission><ForYear>yes<\/ForYear><\/FinalSubmission>/);
  validate(xml, "FullPaymentSubmission-2027-v1-0.xsd");
});

test("a nil EPS, an Employment Allowance claim and statutory pay recovery are valid against the EPS schema", () => {
  const nil = r.buildEps({ scheme, year: Y, noPaymentMonth: 3 });
  assert.match(nil, /<NoPaymentDates><From>2026-06-06<\/From><To>2026-07-05<\/To><\/NoPaymentDates>/);
  validate(nil, "EmployerPaymentSummary-2027-v1-0.xsd");
  validate(r.buildEps({ scheme, year: Y, employmentAllowance: true }), "EmployerPaymentSummary-2027-v1-0.xsd");
  validate(r.buildEps({ scheme, year: Y, recoverable: { month: 5, smp: 920, compSmp: 82.8 } }), "EmployerPaymentSummary-2027-v1-0.xsd");
  validate(r.buildEps({ scheme, year: Y, noPaymentMonth: 12, final: true }), "EmployerPaymentSummary-2027-v1-0.xsd");
});

test("tax month dates", () => {
  assert.deepEqual(r.taxMonthDates(Y, 1), { from: "2026-04-06", to: "2026-05-05" });
  assert.deepEqual(r.taxMonthDates(Y, 9), { from: "2026-12-06", to: "2027-01-05" });
  assert.deepEqual(r.taxMonthDates(Y, 10), { from: "2027-01-06", to: "2027-02-05" });
  assert.deepEqual(r.taxMonthDates(Y, 12), { from: "2027-03-06", to: "2027-04-05" });
});

test("the IRmark input is the canonical Body without the IRmark", () => {
  const l = e.payLine(setup, { basic: 1047.5 }, "M1", 1, e.zeroYtd(), Y) as e.Line;
  const xml = r.buildFps({ scheme, year: Y, freq: "M1", period: 1, payday: "2026-04-28", people: [{ person: alex, line: l }] });
  const input = r.irmarkInput(xml);
  assert.ok(!input.includes("IRmark"));
  assert.ok(input.startsWith(`<Body xmlns="${r.ENVELOPE_NS}"><IRenvelope xmlns="${r.FPS_NS}">`));
  // check against a real C14N implementation where one is available
  try {
    const py = `import sys\nfrom lxml import etree\nx=sys.stdin.read()\nroot=etree.fromstring(x.encode())\nbody=root.find('{${r.ENVELOPE_NS}}Body')\nfor m in body.iter('{${r.FPS_NS}}IRmark'): m.getparent().remove(m)\nsys.stdout.write(etree.tostring(body, method='c14n').decode())`;
    const full = `<GovTalkMessage xmlns="${r.ENVELOPE_NS}"><EnvelopeVersion>2.0</EnvelopeVersion><Body>${xml}</Body></GovTalkMessage>`;
    const c14n = execFileSync("python3", ["-c", py], { input: full }).toString();
    assert.equal(c14n, input);
  } catch (err: any) { if (/No module named|ENOENT/.test(String(err.stderr || err.message))) return; throw err; }
  const mark = createHash("sha1").update(input, "utf8").digest("base64");
  assert.equal(mark.length, 28);
  assert.ok(r.withIrmark(xml, mark).includes(`<IRmark Type="generic">${mark}</IRmark>`));
});

test("money is written as HMRC wants it", () => {
  assert.equal(r.money(0), "0.00"); assert.equal(r.money(-0.001), "0.00"); assert.equal(r.money(-5.5), "-5.50"); assert.equal(r.money(1234.567), "1234.57");
  assert.equal(r.whole(49.99), "49.00");
});

test("problems with references and people are caught before sending", () => {
  assert.equal(r.schemeProblems(scheme).length, 0);
  assert.equal(r.schemeProblems({ ...scheme, officeNo: "12", aoRef: "x" }).length, 2);
  assert.ok(r.personProblems({ ...alex, nino: "XX123" }).some((p) => /National Insurance/.test(p)));
  assert.ok(r.personProblems({ ...sam, postcode: "" }).some((p) => /address/.test(p)));
  assert.equal(r.personProblems(alex).length, 0);
});
