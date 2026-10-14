// Elements links: reading the client list and matching it to clients by name.
import assert from "node:assert/strict";
import { test } from "node:test";
import { elementsUrl, matchElements, nameKey, parseCsv, readElementsCsv } from "../src/lib/elements";

const cl = (Key: string, Title: string, Kind: string, extra: any = {}) => ({ Key, Title, Kind, ...extra }) as any;

test("only https links are used", () => {
  assert.equal(elementsUrl({ ElementsLink: " https://elements.iris.co.uk/x " }), "https://elements.iris.co.uk/x");
  assert.equal(elementsUrl({ ElementsLink: "javascript:alert(1)" }), undefined);
  assert.equal(elementsUrl({}), undefined);
});

test("names match whatever the case, Mr/Mrs and Ltd/Limited", () => {
  assert.equal(nameKey("Mr Kevin Bannister"), nameKey("kevin bannister"));
  assert.equal(nameKey("G&T Consultants Limited"), nameKey("G & T CONSULTANTS LTD"));
});

test("csv with quotes and a BOM", () => {
  assert.deepEqual(parseCsv('﻿Name,Elements Link\r\n"A, B Ltd",https://x\r\n'), [["Name", "Elements Link"], ["A, B Ltd", "https://x"]]);
  assert.equal(readElementsCsv("Foo,Bar\n1,2").error?.includes("Name"), true);
});

test("matching: exact, person by first and last name, duplicates flagged", () => {
  const clients = [
    cl("1", "Fired Up BBQ Global Ltd", "Ltd"), cl("2", "Alfresco Kitchens Ltd", "Ltd"), cl("3", "Alfresco Kitchens Global Ltd", "Ltd"),
    cl("4", "Max Frank Campbell", "Individual"), cl("5", "Stephen Walters", "Individual"), cl("6", "Stephen Baldwin", "Individual"),
    cl("7", "BCK Interior Ltd", "Ltd", { ElementsLink: "https://old" }),
  ];
  const m = matchElements(
    [
      { name: "Alfresco Kitchens Ltd", link: "https://a" }, { name: "Mr Max Campbell", link: "https://b" },
      { name: "Mr Stephen Walters", link: "https://c" }, { name: "Stephen Walters", link: "https://d" },
      { name: "Mr Stephen John Charles Baldwin", link: "https://e" }, { name: "FIRED UP BBQ LTD", link: "https://f" },
      { name: "Bck Interior Ltd", link: "https://a" },
    ],
    clients,
  );
  assert.deepEqual(m.map((x) => x.clientKey), ["2", "4", "5", "", "6", "", "7"]);
  assert.equal(m[3].note?.includes("already matched"), true);
  assert.equal(m[6].note?.includes("Same link as Alfresco"), true);
  assert.equal(m[6].note?.includes("Replaces"), true);
});
