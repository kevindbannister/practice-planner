// CT600 builder: checked against HMRC's own XSD and business rules (CT RIM V1.994) using scripts/validate_rim.py (needs python3 + lxml).
// The iXBRL attachments here are placeholders: these tests prove the return and its envelope, not iXBRL content or taxonomy validity.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { build, computeTax, utrOk } = require("../filing/lib/ct600.js");

const RIM = path.join(__dirname, "../filing/rim/ct600-2026-v1-994");
const SCRIPT = path.join(__dirname, "../../scripts/validate_rim.py");
const haveLxml = spawnSync("python3", ["-I", "-c", "import lxml"]).status === 0;
const UTR = "1000000070";

const ATT = { accounts: { filename: "accounts.xhtml", content: '<html xmlns="http://www.w3.org/1999/xhtml"/>' }, computation: { filename: "comp.xhtml", content: '<html xmlns="http://www.w3.org/1999/xhtml"/>' } };
const ret = (over = {}) => ({
  company: { name: "Smith Plumbing Ltd", number: "01234567", utr: UTR, associated: 0 }, period: { from: "2025-04-01", to: "2026-03-31" },
  figures: { turnover: 200000, tradingProfit: 40000 }, declaration: { name: "A Smith", status: "Director" }, attachments: ATT, ...over,
});
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?><GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><EnvelopeVersion>2.0</EnvelopeVersion><Header/><GovTalkDetails><Keys><Key Type="UTR">${UTR}</Key></Keys></GovTalkDetails><Body>${body}</Body></GovTalkMessage>`;
const check = (xml) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ct600-")), "m.xml");
  fs.writeFileSync(f, xml);
  const r = spawnSync("python3", ["-I", SCRIPT, RIM, f], { encoding: "utf8" });
  return { status: r.status, out: r.stdout };
};
const skip = !haveLxml && "python3 lxml not installed";

for (const [label, over, tax] of [
  ["small profits rate", {}, 7600],
  ["main rate", { figures: { turnover: 900000, tradingProfit: 300000 } }, 75000],
  ["losses brought forward and a qualifying donation", { figures: { turnover: 200000, tradingProfit: 60000, lossesBf: 15000, qualifyingDonations: 5000 } }, 7600],
  ["a period across two financial years", { period: { from: "2025-07-01", to: "2026-06-30" }, figures: { turnover: 900000, tradingProfit: 300000 } }, 75000],
  ["associated companies lowering the limits", { company: { name: "Smith Plumbing Ltd", utr: UTR, associated: 1 }, figures: { turnover: 900000, tradingProfit: 600000 } }, 150000],
]) {
  test(`CT600 for ${label} passes HMRC's schema and business rules`, { skip }, () => {
    const r = build(ret(over));
    assert.deepEqual([r.errors, r.unsupported], [[], []]);
    assert.equal(r.tax.tax, tax);
    const c = check(wrap(r.xml));
    assert.equal(c.status, 0, c.out);
  });
}

test("the checker fails a return whose tax is wrong", { skip }, () => {
  const bad = build(ret()).xml.replace(/<Tax>[\d.]+<\/Tax>/, "<Tax>1.00</Tax>");
  const c = check(wrap(bad));
  assert.equal(c.status, 1);
});

test("tax: limits, rates and the marginal band", () => {
  assert.equal(computeTax("2025-04-01", "2026-03-31", 50000).years[0].rate, 19);
  assert.equal(computeTax("2025-04-01", "2026-03-31", 50001).marginal, true);
  assert.equal(computeTax("2025-04-01", "2026-03-31", 250000).years[0].rate, 25);
  assert.equal(computeTax("2025-04-01", "2026-03-31", 130000, 1).years[0].rate, 25, "one associated company halves the limits");
  assert.equal(computeTax("2025-10-01", "2026-03-31", 24000).years[0].rate, 19);
  assert.equal(computeTax("2025-10-01", "2026-03-31", 24000).marginal, false);
  assert.equal(computeTax("2025-10-01", "2026-03-31", 25500).marginal, true, "a six month period halves the limits");
  const split = computeTax("2025-07-01", "2026-06-30", 365000);
  assert.deepEqual(split.years.map((y) => y.year), [2025, 2026]);
  assert.equal(split.years[0].profit + split.years[1].profit, 365000);
});

test("iXBRL accounts and computation are required and not made up", () => {
  const r = build(ret({ attachments: { accounts: ATT.accounts } }));
  assert.equal(r.xml, "");
  assert.match(r.errors.join(" "), /iXBRL tax computation/);
  assert.match(build(ret({ attachments: undefined })).errors.join(" "), /iXBRL accounts/);
});

test("input problems are reported before anything is built", () => {
  assert.match(build(ret({ company: { name: "", utr: "1234567890" } })).errors.join(" "), /no name/);
  assert.match(build(ret({ company: { name: "X", utr: "1234567890" } })).errors.join(" "), /UTR/);
  assert.ok(utrOk(UTR));
  assert.match(build(ret({ company: { name: "X", utr: UTR, number: "123" } })).errors.join(" "), /company number/);
  assert.match(build(ret({ declaration: {} })).errors.join(" "), /declaration/i);
});

test("what the builder can't express refuses the build instead of sending a partial return", () => {
  for (const [over, re] of [
    [{ period: { from: "2025-01-01", to: "2026-03-31" } }, /over 12 months/],
    [{ period: { from: "2022-04-01", to: "2023-03-31" } }, /before 1 April 2023/],
    [{ period: { from: "2026-07-01", to: "2027-06-30" } }, /1 April 2027/],
    [{ figures: { turnover: 1, tradingProfit: 100000 } }, /marginal relief band/],
    [{ other: { property: 100 } }, /UK property/],
    [{ other: { groupRelief: 100, rd: 1 } }, /Group relief/],
    [{ amended: true }, /Amended/],
    [{ figures: { turnover: 1, tradingProfit: 1000, qualifyingDonations: 5000 } }, /donations larger/],
  ]) {
    const r = build(ret(over));
    assert.equal(r.xml, "", JSON.stringify(over));
    assert.match(r.unsupported.join(" "), re, JSON.stringify(over));
  }
});
