import "./support/reactGlobal";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataContext } from "../src/ui/data";
import { HmrcFilingPanel } from "../src/ui/HmrcFiling";
import { emptyReturn } from "../src/lib/tax";
import { newFiling } from "../src/lib/hmrcFiling";

const client = { Key: "c1", Title: "Alison Baldwin" } as any;
const render = (rows: any[], log: any[] = []) => {
  const data: any = { settings: [], hmrcFilings: rows, hmrcFilingLog: log, clients: [client], cosecDividends: [] };
  const ctx: any = { data, user: "Kevin", create: async (_l: string, r: any) => r, update: async () => undefined };
  return renderToStaticMarkup(createElement(DataContext.Provider, { value: ctx }, createElement(HmrcFilingPanel, { client, year: 2024, ret: emptyReturn() })));
};
const row = (patch: Record<string, unknown> = {}) => ({ ...newFiling({ clientKey: "c1", service: "SA100", period: "2023-24", env: "mock", by: "Kevin", now: "2026-11-04T09:00:00.000Z" }).row, ...patch });

test("with nothing started the panel offers to start, says nothing is sent, and lists the environments", () => {
  const h = render([]);
  assert.match(h, /HMRC Filing/); assert.match(h, /2023-24/); assert.match(h, /Nothing is sent to HMRC from here yet/);
  assert.match(h, /Start a filing for 2023-24/); assert.match(h, /Mock \(nothing is sent to HMRC\)/); assert.match(h, /HMRC External Test Service/);
});

test("a draft shows its version, its readiness list and the next step", () => {
  const h = render([row()]);
  assert.match(h, /Version 1/); assert.match(h, /Prepare this version/); assert.match(h, /○ HMRC XML ready/);
  assert.match(h, /Which SA100 pages the planner covers/);
});

test("a prepared version whose return has since changed says the client's approval no longer covers it", () => {
  const h = render([row({ State: "client-approved", PayloadHash: "old", ApprovedHash: "old", ApprovedBy: "Client A" })]);
  assert.match(h, /changed since version 1 was prepared, so the client(&#x27;|')s approval no longer covers it/); assert.match(h, /Send back to Prepared/);
  assert.doesNotMatch(h, /Mark ready to file/);
});

test("a mock acceptance is never shown as filed, and a rejection offers a correction", () => {
  const mock = render([row({ State: "accepted", Outcome: "mock" })]);
  assert.match(mock, /Mock run only: nothing was sent to HMRC/); assert.doesNotMatch(mock, /Filed: HMRC accepted/);
  const rej = render([row({ State: "rejected", Outcome: "hmrc", Messages: JSON.stringify([{ number: "1046", text: "Invalid" }]) })]);
  assert.match(rej, /Rejected by HMRC/); assert.match(rej, /1046 Invalid/); assert.match(rej, /Start a correction \(new version\)/);
});

test("history rows are listed newest first and earlier versions are kept", () => {
  const a = row({ Key: "A", Version: 1, State: "rejected", Outcome: "hmrc" }), b = row({ Key: "B", Version: 2, Supersedes: "A" });
  const h = render([a, b], [{ Key: "L1", FilingKey: "A", At: "2026-11-04T09:00:00.000Z", By: "Kevin", Event: "created", To: "draft" }]);
  assert.match(h, /Version 2/); assert.match(h, /Earlier versions/); assert.match(h, /History \(1\)/);
});
