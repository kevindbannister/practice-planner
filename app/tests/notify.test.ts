import test from "node:test";
import assert from "node:assert/strict";
import { plan, inQuiet, DEFAULT_NOTIFY, EMPTY_STATE, NotifyPrefs } from "../src/lib/notify";
import { Action } from "../src/lib/actions";

const A = (key: string, o: Partial<Action> = {}) => ({ key, category: "jobs", title: `Do ${key}`, clientKey: "c", clientName: "Acme Ltd", detail: "Overdue", assignee: "Kevin", due: "2026-11-10", priority: "high", dismissible: false, href: `editor:task:${key}`, ...o }) as Action;
const P: NotifyPrefs = { ...DEFAULT_NOTIFY, enabled: true, quiet: false };
const away = { minutesNow: 600, inFront: false };

test("first run records what exists and pops nothing up", () => {
  const r = plan([A("a"), A("b")], "kevin", P, EMPTY_STATE, away);
  assert.equal(r.pops.length, 0); assert.equal(r.reason, "baseline"); assert.deepEqual(Object.keys(r.state.seen), ["a", "b"]);
});
test("a new action pops up once, then not again", () => {
  const s1 = plan([A("a")], "kevin", P, EMPTY_STATE, away).state;
  const r = plan([A("a"), A("b")], "kevin", P, s1, away); assert.equal(r.pops.length, 1); assert.equal(r.pops[0].tag, "b"); assert.match(r.pops[0].title, /Acme Ltd: Do b/); assert.equal(r.pops[0].href, "editor:task:b");
  assert.equal(plan([A("a"), A("b")], "kevin", P, r.state, away).pops.length, 0);
});
test("only my actions, at or above the chosen priority and topics", () => {
  const s = plan([], "kevin", P, EMPTY_STATE, away).state;
  const list = [A("mine"), A("theirs", { assignee: "Sam" }), A("low", { priority: "low" }), A("sales", { category: "sales" })];
  assert.deepEqual(plan(list, "kevin", P, s, away).pops.map((p) => p.tag).sort(), ["mine", "sales"]);
  assert.deepEqual(plan(list, "kevin", { ...P, categories: ["jobs"] }, s, away).pops.map((p) => p.tag), ["mine"]);
  assert.deepEqual(plan(list, "kevin", { ...P, minPriority: "low" }, s, away).pops.map((p) => p.tag).sort(), ["low", "mine", "sales"]);
});
test("a rise in priority notifies again; an action that goes away and returns is new again", () => {
  const s = plan([A("a", { priority: "medium" })], "kevin", P, EMPTY_STATE, away).state;
  const up = plan([A("a", { priority: "high" })], "kevin", P, s, away); assert.equal(up.pops.length, 1);
  const gone = plan([], "kevin", P, up.state, away).state; assert.equal(plan([A("a")], "kevin", P, gone, away).pops.length, 1);
});
test("more than three new at once become one summary", () => {
  const s = plan([], "kevin", P, EMPTY_STATE, away).state;
  const r = plan(["a", "b", "c", "d", "e"].map((k) => A(k)), "kevin", P, s, away);
  assert.equal(r.pops.length, 1); assert.match(r.pops[0].title, /5 new actions/); assert.match(r.pops[0].body, /and 2 more/);
});
test("quiet hours hold everything back and nothing is lost; it is summarised afterwards", () => {
  const q = { ...P, quiet: true, quietFrom: "19:00", quietTo: "08:00" };
  const s = plan([], "kevin", q, EMPTY_STATE, away).state;
  const night = plan([A("a")], "kevin", q, s, { minutesNow: 23 * 60, inFront: false }); assert.equal(night.pops.length, 0); assert.equal(night.reason, "quiet");
  const morning = plan([A("a")], "kevin", q, night.state, { minutesNow: 8 * 60 + 1, inFront: false }); assert.equal(morning.pops.length, 1);
  assert.ok(inQuiet(q, 6 * 60) && inQuiet(q, 20 * 60) && !inQuiet(q, 12 * 60) && !inQuiet({ ...q, quiet: false }, 23 * 60));
});
test("while the app is in front, new items are marked seen but don't pop up (unless turned off)", () => {
  const s = plan([], "kevin", P, EMPTY_STATE, away).state;
  const r = plan([A("a")], "kevin", P, s, { minutesNow: 600, inFront: true }); assert.equal(r.pops.length, 0); assert.equal(r.reason, "in-front");
  assert.equal(plan([A("a")], "kevin", P, r.state, away).pops.length, 0);
  assert.equal(plan([A("b")], "kevin", { ...P, onlyWhenAway: false }, s, { minutesNow: 600, inFront: true }).pops.length, 1);
});
test("details off keeps the pop-up generic", () => {
  const s = plan([], "kevin", P, EMPTY_STATE, away).state;
  const r = plan([A("a")], "kevin", { ...P, details: false }, s, away); assert.equal(r.pops[0].title, "New action for you"); assert.ok(!/Acme/.test(r.pops[0].body));
});
