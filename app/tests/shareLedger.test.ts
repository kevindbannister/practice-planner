import test from "node:test";
import assert from "node:assert/strict";
import { entryProblems, openingFromRegister, ownership, readEntry, reconcile, record, replay, supersede, Entry, NewEntry } from "../src/lib/shareLedger";
import { Row } from "../src/lib/schema";

const NOW = "2026-10-28T10:00:00Z";
let n = 0;
function led(entries: NewEntry[], client = "C1"): { rows: Row[]; list: Entry[] } {
  const rows: Row[] = [];
  for (const e of entries) {
    const r = record(e, client, rows.map(readEntry), undefined, "Kevin", `2026-10-28T10:00:${String(n++).padStart(2, "0")}Z`);
    assert.ok(r.row, JSON.stringify(r));
    rows.push(r.row!);
  }
  return { rows, list: rows.map(readEntry) };
}
const open = (to: string, number: number, date = "2020-01-01", cls = "Ordinary"): NewEntry => ({ type: "opening", date, cls, number, to });

test("holdings are replayed from entries and can be read at any date", () => {
  const { list } = led([open("Ann", 60), open("Bob", 40), { type: "transfer", date: "2022-06-01", cls: "Ordinary", number: 10, from: "Ann", to: "Cat" }, { type: "allotment", date: "2024-03-01", cls: "Ordinary", number: 100, to: "Bob" }]);
  const at = (d: string) => Object.fromEntries(replay(list, d).holdings.map((h) => [h.name, h.number]));
  assert.deepEqual(at("2021-01-01"), { Ann: 60, Bob: 40 });
  assert.deepEqual(at("2022-06-01"), { Ann: 50, Bob: 40, Cat: 10 });
  assert.deepEqual(at("2026-01-01"), { Ann: 50, Bob: 140, Cat: 10 });
});

test("ownership is derived from holdings, by share and by class", () => {
  const { list } = led([open("Ann", 60), open("Bob", 40), open("Ann", 10, "2020-01-01", "A Ordinary")]);
  const o = ownership(replay(list).holdings);
  assert.equal(o.issued, 110);
  const ann = o.holders.find((h) => h.name === "Ann")!;
  assert.equal(ann.total, 70);
  assert.equal(ann.percent, 63.64);
  assert.deepEqual(ann.byClass.map((c) => [c.cls, c.number, c.percentOfClass]), [["A Ordinary", 10, 100], ["Ordinary", 60, 60]]);
});

test("a transfer cannot exceed what the holder has on that date", () => {
  const { list } = led([open("Ann", 60), open("Bob", 40)]);
  assert.deepEqual(entryProblems({ type: "transfer", date: "2021-01-01", cls: "Ordinary", number: 60, from: "Ann", to: "Bob" }, list), []);
  assert.match(entryProblems({ type: "transfer", date: "2021-01-01", cls: "Ordinary", number: 61, from: "Ann", to: "Bob" }, list)[0], /left holding -1 Ordinary/);
  // before the holder has any
  assert.match(entryProblems({ type: "transfer", date: "2019-01-01", cls: "Ordinary", number: 1, from: "Ann", to: "Bob" }, list)[0], /left holding/);
});

test("an entry that would break a later date is refused too", () => {
  const { list } = led([open("Ann", 100), { type: "transfer", date: "2023-01-01", cls: "Ordinary", number: 90, from: "Ann", to: "Bob" }]);
  const p = entryProblems({ type: "transfer", date: "2022-01-01", cls: "Ordinary", number: 50, from: "Ann", to: "Cat" }, list);
  assert.ok(p.length);
});

test("basic validation: date, class, whole shares, parties, self-transfer, unknown class", () => {
  assert.ok(entryProblems({ type: "allotment", date: "", cls: "Ordinary", number: 1, to: "A" }, []).length);
  assert.ok(entryProblems({ type: "allotment", date: "2020-01-01", cls: "", number: 1, to: "A" }, []).length);
  assert.ok(entryProblems({ type: "allotment", date: "2020-01-01", cls: "Ordinary", number: 1.5, to: "A" }, []).length);
  assert.ok(entryProblems({ type: "allotment", date: "2020-01-01", cls: "Ordinary", number: 1 }, []).length);
  assert.match(entryProblems({ type: "transfer", date: "2020-01-01", cls: "Ordinary", number: 1, from: "A", to: "a " }, [])[0], /themselves/);
  assert.match(entryProblems({ type: "allotment", date: "2020-01-01", cls: "B", number: 1, to: "A" }, [], ["Ordinary"])[0], /isn't one of/);
});

test("the same entry recorded twice is skipped, not doubled", () => {
  const first = record({ ...open("Ann", 10), idem: "x1" }, "C1", [], undefined, "K", NOW);
  const again = record({ ...open("Ann", 10), idem: "x1" }, "C1", [readEntry(first.row!)], undefined, "K", NOW);
  assert.equal(again.skipped, true);
});

test("a holder is the linked record when there is one, otherwise the name", () => {
  const { list } = led([{ type: "opening", date: "2020-01-01", cls: "Ordinary", number: 10, to: "Ann Smith", toKey: "P1" }, { type: "allotment", date: "2021-01-01", cls: "Ordinary", number: 5, to: "A. Smith", toKey: "P1" }, open("bob  jones", 3), open("Bob Jones", 2)]);
  const h = replay(list).holdings;
  assert.equal(h.find((x) => x.key === "P1")!.number, 15);
  assert.equal(h.find((x) => x.name.toLowerCase().startsWith("bob"))!.number, 5);
});

test("redemption and cancellation reduce holdings; bonus adds", () => {
  const { list } = led([open("Ann", 100), { type: "redemption", date: "2021-01-01", cls: "Ordinary", number: 30, from: "Ann" }, { type: "bonus", date: "2022-01-01", cls: "Ordinary", number: 10, to: "Ann" }, { type: "cancellation", date: "2023-01-01", cls: "Ordinary", number: 5, from: "Ann" }]);
  assert.equal(replay(list).holdings[0].number, 75);
});

test("correcting an entry supersedes it with a reason and keeps the original", () => {
  const { rows, list } = led([open("Ann", 60), open("Bob", 40)]);
  const bad = supersede(list[0], rows[0], open("Ann", 50), list, "Kevin", NOW, " ");
  assert.match(bad.error!, /reason/);
  const ok = supersede(list[0], rows[0], open("Ann", 50), list, "Kevin", NOW, "Certificate shows 50");
  assert.deepEqual(ok.patch, { Status: "superseded" });
  assert.equal(ok.row!.Supersedes, list[0].key);
  const after = [{ ...rows[0], ...ok.patch }, rows[1], ok.row!].map(readEntry);
  assert.deepEqual(Object.fromEntries(replay(after).holdings.map((h) => [h.name, h.number])), { Ann: 50, Bob: 40 });
  assert.equal(after.length, 3); // nothing deleted
  assert.match(supersede(after[0], rows[0], open("Ann", 1), after, "K", NOW, "again").error!, /already been corrected/);
});

test("a correction that would unbalance later history is refused", () => {
  const { rows, list } = led([open("Ann", 60), { type: "transfer", date: "2021-01-01", cls: "Ordinary", number: 50, from: "Ann", to: "Bob" }]);
  const r = supersede(list[0], rows[0], open("Ann", 40), list, "K", NOW, "typo");
  assert.ok(r.error);
});

test("the ledger is compared with the working register", () => {
  const { list } = led([open("Ann", 60), open("Bob", 40), open("Cat", 5)]);
  const register: Row[] = [
    { Holder: "Ann", Class: "Ordinary", Number: 60, Status: "current" },
    { Holder: "Bob", Class: "Ordinary", Number: 35, Status: "current" },
    { Holder: "Dan", Class: "Ordinary", Number: 7, Status: "current" },
    { Holder: "Old", Class: "Ordinary", Number: 9, Status: "former" },
  ];
  const r = reconcile(register, list);
  assert.equal(r.matches, 1);
  assert.deepEqual(r.differences.map((d) => [d.holder, d.kind, d.register, d.ledger]), [["Bob", "differs", 35, 40], ["Cat", "ledger-only", 0, 5], ["Dan", "register-only", 7, 0]]);
});

test("opening balances carry the register in, only for what the ledger lacks", () => {
  const { list } = led([open("Ann", 20)]);
  const register: Row[] = [{ Holder: "Ann", Class: "Ordinary", Number: 60, Status: "current", NominalValue: 1, Currency: "GBP" }, { Holder: "Bob", Class: "Ordinary", Number: 40, Status: "current" }];
  const rows = openingFromRegister(register, list, "C1", "2018-05-01", "Kevin", NOW);
  assert.deepEqual(rows.map((r) => [r.ToHolder, r.Number, r.Type]), [["Ann", 40, "opening"], ["Bob", 40, "opening"]]);
  // applying them makes the two agree
  const merged = [...list, ...rows.map(readEntry)];
  assert.equal(reconcile(register, merged).differences.length, 0);
  // and running it again adds nothing
  assert.equal(openingFromRegister(register, merged, "C1", "2018-05-01", "Kevin", NOW).length, 0);
});

test("a holder named by key in one entry and by name in another is one holder", async () => {
  const { replay: rp, readEntry: re } = await import("../src/lib/shareLedger.ts");
  const mk = (o: Record<string, unknown>) => re({ Key: String(o.n), ClientKey: "C", Status: "active", Class: "Ordinary", Created: String(o.n), ...o });
  const r = rp([mk({ n: "1", Type: "allotment", EffectiveDate: "2026-10-28", Number: 100, ToHolder: "Adam French" }), mk({ n: "2", Type: "transfer", EffectiveDate: "2026-10-28", Number: 40, FromHolder: "Adam French", FromKey: "C9", ToHolder: "Bea", ToKey: "C8" })]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.holdings.find((h) => h.name === "Adam French")!.number, 60);
});

test("a transfer on the same day as the allotment that created the shares is allowed", async () => {
  const { record: rec, readEntry: re } = await import("../src/lib/shareLedger.ts");
  const ex = [re({ Key: "L1", ClientKey: "C1", Type: "allotment", EffectiveDate: "2026-10-28", Class: "Ordinary", Number: 100, ToHolder: "A", Status: "active", Created: "2026-10-28T10:00:00Z" })];
  assert.equal(rec({ type: "transfer", date: "2026-10-28", cls: "Ordinary", number: 40, from: "A", to: "B" }, "C1", ex, undefined, "k", "now").error, undefined);
  assert.ok(rec({ type: "transfer", date: "2026-10-27", cls: "Ordinary", number: 40, from: "A", to: "B" }, "C1", ex, undefined, "k", "now").error, "but not the day before");
});
