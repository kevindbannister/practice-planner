import { test } from "node:test";
import assert from "node:assert/strict";
import { membersRegister, transactionsRegister, officersRegister, pscRegister, allRegisters, toCsv, registersPdf } from "../src/lib/cosecRegisters";
import { readEntry } from "../src/lib/shareLedger";

const e = (o: Record<string, unknown>) => readEntry({ Key: String(o.n), ClientKey: "C1", Status: "active", Created: String(o.n), Class: "Ordinary", ...o });
const led = [
  e({ n: "1", Type: "allotment", EffectiveDate: "2018-01-01", Number: 100, ToHolder: "Alice Smith" }),
  e({ n: "2", Type: "transfer", EffectiveDate: "2020-06-01", Number: 100, FromHolder: "Alice Smith", ToHolder: "Bob Jones" }),
  e({ n: "3", Type: "allotment", EffectiveDate: "2022-01-01", Number: 50, ToHolder: "Carol Ng" }),
];
test("register of members at different dates, with former members", () => {
  const now = membersRegister(led, "2026-01-01");
  assert.equal(now.required, true);
  assert.deepEqual(now.rows.map((r) => [r[0], r[1], r[2], r[3]]), [["Bob Jones", "100 Ordinary", "01/06/2020", ""], ["Carol Ng", "50 Ordinary", "01/01/2022", ""], ["Alice Smith", "None", "01/01/2018", "01/06/2020"]]);
  const then = membersRegister(led, "2019-01-01");
  assert.deepEqual(then.rows.map((r) => r[0]), ["Alice Smith"]);
  assert.equal(then.rows[0][3], "");
});
test("transactions register respects the date and leaves out superseded entries", () => {
  const t = transactionsRegister([...led, e({ n: "4", Type: "allotment", EffectiveDate: "2019-01-01", Number: 5, ToHolder: "X", Status: "superseded" })], "2021-01-01");
  assert.equal(t.rows.length, 2);
});
const officers = [
  { Key: "o1", ClientKey: "C1", Role: "director", Status: "current", First: "Jane", Last: "Doe", DOB: "1980-05-05", AppointedOn: "2015-02-01", ResidentialAddress: "1 Secret St", ServiceAddress: "Office" },
  { Key: "o2", ClientKey: "C1", Role: "director", Status: "resigned", First: "Tom", Last: "Old", AppointedOn: "2010-01-01", ResignedOn: "2012-12-31" },
  { Key: "o3", ClientKey: "C1", Role: "director", Status: "current", First: "No", Last: "Date" },
];
test("officers register: as-at filtering, public vs sensitive columns", () => {
  const pub = officersRegister(officers, "2026-01-01", false)[0];
  assert.equal(pub.columns.includes("Residential address"), false);
  assert.equal(pub.rows.find((r) => r[0] === "Jane Doe")![4], "05/1980");
  assert.equal(pub.rows.flat().includes("1 Secret St"), false);
  assert.equal(pub.rows.find((r) => r[0] === "No Date")![2], "Not recorded");
  const full = officersRegister(officers, "2026-01-01", true)[0];
  assert.equal(full.rows.flat().includes("1 Secret St"), true); assert.equal(full.sensitive, true);
  const old = officersRegister(officers, "2011-01-01", false)[0];
  assert.deepEqual(old.rows.map((r) => r[0]).sort(), ["No Date", "Tom Old"]); assert.equal(old.rows.find((r) => r[0] === "Tom Old")![3], "");
  assert.equal(officersRegister(officers, "2026-01-01", false)[0].required, false);
});
test("psc register and the full set; LLPs get no share registers", () => {
  const p = pscRegister([{ ClientKey: "C1", Status: "current", First: "A", Last: "B", Natures: '["ownership-of-shares-75-to-100-percent"]', NotifiedOn: "2016-04-06" }], "2026-01-01", false);
  assert.match(p.rows[0][1], /ownership of shares 75 to 100 percent/);
  const src = { ledger: led.map((x) => ({ ...x })) as never, officers, pscs: [], clientKey: "C1", llp: false };
  assert.equal(allRegisters(src, "2026-01-01", false).map((r) => r.id).join(), "members,transactions,directors,secretaries,pscs");
  assert.equal(allRegisters({ ...src, llp: true }, "2026-01-01", false).map((r) => r.id).join(), "members-llp,pscs");
});
test("csv is escaped and neutralises formulas; pdf is produced", async () => {
  const csv = toCsv({ id: "members", title: "t", required: true, note: "", columns: ["A", "B"], rows: [['=1+1', 'x, "y"']], sensitive: false });
  assert.equal(csv, "A,B\r\n'=1+1,\"x, \"\"y\"\"\"");
  const pdf = await registersPdf({ name: "Test Ltd", number: "01234567" }, membersRegister(led, "2026-01-01") && [membersRegister(led, "2026-01-01")], "2026-01-01", "kevin");
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
});
