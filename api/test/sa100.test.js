// SA100 builder: checked against HMRC's own XSD and business rules (RIM pack 2025-26 v1.2) using scripts/validate_rim.py (needs python3 + lxml).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { build, unsupported } = require("../filing/lib/sa100.js");

const RIM = path.join(__dirname, "../filing/rim/sa100-2025-26");
const SCRIPT = path.join(__dirname, "../../scripts/validate_rim.py");
const haveLxml = spawnSync("python3", ["-I", "-c", "import lxml"]).status === 0;

const ret = (over = {}) => ({
  front: { region: "england", dob: "1980-05-01", utr: "1234567890", nino: "QQ123456C" },
  employments: [], partnerships: [], interest: [], dividends: [], gains: [], reliefs: {}, studentLoan: { plans: [] },
  selfEmployments: [{ id: "1", name: "Plumber", turnover: 40000, expenses: 5000, expenseItems: [{ id: "a", label: "Van", amount: 3000, box: "12" }, { id: "b", label: "Other", amount: 2000, disallowable: 100 }], cis: 500, capitalAllowances: 1000 }],
  ...over,
});
const ctx = { periodEnd: "2026-04-05", totals: { totalTaxEtcDue: 4000, class4: 1500 } };
const wrap = (body, utr = "1234567890") => `<?xml version="1.0" encoding="UTF-8"?><GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope"><EnvelopeVersion>2.0</EnvelopeVersion><Header/><GovTalkDetails><Keys><Key Type="UTR">${utr}</Key></Keys></GovTalkDetails><Body>${body}</Body></GovTalkMessage>`;
const check = (xml) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sa100-")), "m.xml");
  fs.writeFileSync(f, xml);
  const r = spawnSync("python3", ["-I", SCRIPT, RIM, f], { encoding: "utf8" });
  return { status: r.status, out: r.stdout };
};

test("a supported return builds XML that passes HMRC's schema and business rules", { skip: !haveLxml && "python3 lxml not installed" }, () => {
  const r = build(ret(), ctx);
  assert.deepEqual(r.unsupported, []);
  const c = check(wrap(r.xml));
  assert.equal(c.status, 0, c.out);
});

test("the checker really fails a body that breaks HMRC's rules (so a pass means something)", { skip: !haveLxml && "python3 lxml not installed" }, () => {
  const bad = build(ret(), ctx).xml.replace(/<TotalTaxableBusinessProfits>[\d.]+/, "<TotalTaxableBusinessProfits>1.00");
  const c = check(wrap(bad));
  assert.equal(c.status, 1);
  assert.match(c.out, /SSE31/);
});

test("anything the builder can't express refuses the build instead of producing a partial return", () => {
  const r = build(ret({ interest: [{ id: "i", payer: "Bank", untaxed: 10 }], gains: [{ id: "g" }] }), ctx);
  assert.equal(r.xml, "");
  assert.ok(r.unsupported.some((u) => /Interest/.test(u)) && r.unsupported.some((u) => /gains/i.test(u)));
});

test("turnover over the SA103S limit needs the full form, which isn't built", () => {
  const u = unsupported(ret({ selfEmployments: [{ id: "1", name: "Big", turnover: 120000, expenses: 0 }] }));
  assert.ok(u.some((x) => /SA103F/.test(x)));
});

test("region sets the taxpayer status", () => {
  assert.match(build(ret({ front: { region: "scotland", utr: "1234567890" } }), ctx).xml, /<TaxpayerStatus>S<\/TaxpayerStatus>/);
  assert.match(build(ret({ front: { region: "wales", utr: "1234567890" } }), ctx).xml, /<TaxpayerStatus>C<\/TaxpayerStatus>/);
});
