// SA800 builder: checked against HMRC's own XSD and business rules (RIM pack 2025-26 v1.0a) using scripts/validate_rim.py (needs python3 + lxml).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { build, utrOk } = require("../filing/lib/sa800.js");

const RIM = path.join(__dirname, "../filing/rim/sa800-2025-26");
const SCRIPT = path.join(__dirname, "../../scripts/validate_rim.py");
const haveLxml = spawnSync("python3", ["-I", "-c", "import lxml"]).status === 0;
// UTRs with a correct check digit.
const U1 = "1000000070", U2 = "1000000084", U3 = "1000000098";

const part = (over = {}) => ({
  name: "Smith and Jones", utr: U1, periodStart: "2025-04-06", periodEnd: "2026-04-05", nature: "Plumbing", nominatedPartner: "A Smith", capacity: "Partner",
  trade: { name: "Smith and Jones", description: "Plumbing", turnover: 60000, expenses: 20000 },
  partners: [{ name: "A Smith", utr: U2, nino: "QQ123456C", tradeProfit: 10000 }, { name: "B Jones", utr: U3, nino: "QQ654321C", tradeProfit: 30000 }],
  ...over,
});
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?><GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><EnvelopeVersion>2.0</EnvelopeVersion><Header/><GovTalkDetails><Keys><Key Type="UTR">${U1}</Key></Keys></GovTalkDetails><Body>${body}</Body></GovTalkMessage>`;
const check = (xml) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sa800-")), "m.xml");
  fs.writeFileSync(f, xml);
  const r = spawnSync("python3", ["-I", SCRIPT, RIM, f], { encoding: "utf8" });
  return { status: r.status, out: r.stdout };
};

test("a supported partnership return builds XML that passes HMRC's schema and business rules", { skip: !haveLxml && "python3 lxml not installed" }, () => {
  const r = build(part());
  assert.deepEqual([r.errors, r.unsupported], [[], []]);
  const c = check(wrap(r.xml));
  assert.equal(c.status, 0, c.out);
});

test("a loss is sent as a loss and still passes HMRC's rules", { skip: !haveLxml && "python3 lxml not installed" }, () => {
  const r = build(part({ trade: { name: "Smith and Jones", description: "Plumbing", turnover: 10000, expenses: 18000 }, partners: [{ name: "A Smith", utr: U2, tradeLoss: 2000 }, { name: "B Jones", utr: U3, tradeLoss: 6000 }] }));
  assert.deepEqual([r.errors, r.unsupported], [[], []]);
  const c = check(wrap(r.xml));
  assert.equal(c.status, 0, c.out);
});

test("the checker fails a body that breaks HMRC's rules", { skip: !haveLxml && "python3 lxml not installed" }, () => {
  const bad = build(part()).xml.replace(/<NetProfit>[\d.]+/, "<NetProfit>1.00");
  const c = check(wrap(bad));
  assert.equal(c.status, 1);
  assert.match(c.out, /Rule 6627/);
});

test("partner shares that don't add up to the partnership's profit are stopped before building", () => {
  const r = build(part({ partners: [{ name: "A Smith", utr: U2, tradeProfit: 10000 }, { name: "B Jones", utr: U3, tradeProfit: 29000 }] }));
  assert.equal(r.xml, "");
  assert.match(r.errors.join(" "), /partners' shares/);
});

test("UTRs are checked with HMRC's check digit and repeated digits are refused", () => {
  assert.ok(utrOk(U1) && utrOk(U2));
  assert.ok(!utrOk("1234567890") && !utrOk("2222222222") && !utrOk("123"));
  assert.match(build(part({ partners: [{ name: "A", utr: "1234567890", tradeProfit: 10000 }, { name: "B", utr: U3, tradeProfit: 30000 }] })).errors.join(" "), /UTR/);
});

test("a partnership needs two partners and a name HMRC accepts", () => {
  assert.match(build(part({ partners: [{ name: "A", utr: U2, tradeProfit: 40000 }] })).errors.join(" "), /two partners/);
  assert.match(build(part({ partners: [{ name: "A Smith £", utr: U2, tradeProfit: 10000 }, { name: "B Jones", utr: U3, tradeProfit: 30000 }] })).errors.join(" "), /character HMRC doesn't accept/);
});

test("what the builder can't express refuses the build instead of sending a partial return", () => {
  for (const [over, re] of [
    [{ trade: { name: "x", turnover: 120000, expenses: 1000 }, partners: [{ name: "A", utr: U2, tradeProfit: 59500 }, { name: "B", utr: U3, tradeProfit: 59500 }] }, /full income and expenses/],
    [{ trade: { name: "x", turnover: 60000, expenses: 20000, capitalAllowances: 1000 } }, /Capital allowances/],
    [{ other: { savings: 100 } }, /Other partnership income/],
    [{ amended: true }, /Amended/],
  ]) {
    const r = build(part(over));
    assert.equal(r.xml, "");
    assert.match(r.unsupported.join(" "), re);
  }
});
