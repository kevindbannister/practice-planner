// Backups: the Excel writer and the backup's shape.
import assert from "node:assert/strict";
import { test } from "node:test";
import { backupDue, backupName, backupSheets, buildBackup } from "../src/lib/backup";
import { colName, crc32, sheetNames, workbook } from "../src/lib/xlsx";
import { FakeGraph } from "../src/lib/fakeGraph";
import { uploadBackup } from "../src/lib/backup";

test("zip checksums and column letters", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  assert.deepEqual(sheetNames(["Jobs", "jobs", "A/B: C?", "x".repeat(40)]), ["Jobs", "jobs 2", "A B  C", "x".repeat(31)]);
});

test("a workbook is a zip with a sheet per table", async () => {
  const bytes = await workbook([{ name: "One", rows: [["Name", "Fee", "Done"], ["A & B <Ltd>", 12.5, true]] }]);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  // read the sheet back out of the zip
  const { inflateRawSync } = await import("node:zlib");
  const files = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const method = view.getUint16(at + 8, true), size = view.getUint32(at + 18, true), nameLen = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + nameLen));
    const raw = bytes.slice(at + 30 + nameLen, at + 30 + nameLen + size);
    files.set(name, new TextDecoder().decode(method === 8 ? inflateRawSync(raw) : raw));
    at += 30 + nameLen + size;
  }
  assert.ok(files.has("xl/worksheets/sheet1.xml"));
  const text = files.get("xl/worksheets/sheet1.xml")!;
  assert.ok(text.includes("A &amp; B &lt;Ltd&gt;"));
  assert.ok(text.includes('<c r="B2"><v>12.5</v></c>'));
  assert.ok(text.includes('<c r="C2" t="b"><v>1</v></c>'));
});

test("backup has a contents sheet and one sheet per list, every column", () => {
  const when = new Date(2026, 9, 9, 22, 46);
  assert.equal(backupName(when), "Practice Planner backup 2026-10-09 2246.xlsx");
  const sheets = backupSheets({ Clients: [{ Key: "C2", Title: "Beta" }, { Key: "C10", Title: "Gamma" }, { Key: "C1", Title: "Alpha", CHChecked: true }] }, when);
  assert.equal(sheets[0].name, "Contents");
  const clients = sheets.find((s) => s.name === "Clients")!;
  assert.deepEqual(clients.rows[0].slice(0, 3), ["Title", "Key", "Kind"]);
  assert.deepEqual(clients.rows.slice(1).map((r) => r[0]), ["Alpha", "Beta", "Gamma"]);
  assert.equal(sheets.length, 1 + 14);
});

test("backup counts rows", async () => {
  assert.equal((await buildBackup({ Clients: [{ Key: "C1" }], Jobs: [{ Key: "J1" }, { Key: "J2" }] })).rows, 3);
});

test("daily backup is due after 20 hours", () => {
  const now = new Date("2026-10-10T09:00:00Z");
  assert.equal(backupDue(undefined, now), true);
  assert.equal(backupDue({ at: "2026-10-09T20:00:00Z" }, now), false);
  assert.equal(backupDue({ at: "2026-10-09T12:00:00Z" }, now), true);
});

test("upload goes to the backups folder in OneDrive", async () => {
  const g = new FakeGraph();
  const out = await uploadBackup(g, new Uint8Array([1, 2, 3]), "Practice Planner backup 2026-10-09 2246.xlsx");
  assert.equal(out.size, 3);
  assert.match(out.webUrl!, /Practice%20Planner%20Backups\/Practice%20Planner%20backup/);
  assert.ok(out.folderUrl);
  assert.equal(g.state.files![0].path, "Practice Planner Backups/Practice Planner backup 2026-10-09 2246.xlsx");
});
