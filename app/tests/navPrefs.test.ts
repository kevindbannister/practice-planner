import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU_KINDS, MODES, WORKSPACES, backFromAdvisory, defaultPrefs, effectiveMode, isModeKind, isThreeMode, landing, migrateLegacy, modeOfSection, newerPrefs, noteVisit, prefsKey, readPrefs, sectionOfHash } from "../src/lib/navAreas.ts";

const NOW = "2026-11-16T12:00:00.000Z";

test("three workspaces, each with a landing page and its own modules", () => {
  assert.deepEqual(MODES, ["practice", "work", "advisory"]);
  assert.deepEqual(WORKSPACES.practice.modules, ["plan", "clients", "sales", "comms", "practice", "aml"]);
  assert.deepEqual(WORKSPACES.work.modules, ["clients", "papers", "tax", "payroll", "cosec"]);
  assert.deepEqual(WORKSPACES.advisory.modules, ["clients", "reporting", "advisory", "taxplan"]);
  assert.equal(WORKSPACES.advisory.home, "#/advisory-overview");
  for (const m of MODES) assert.equal(modeOfSection(WORKSPACES[m].homeSection), m);
});

test("every menu style is offered, old and new", () => {
  const kinds = MENU_KINDS.map(([k]) => k);
  for (const k of ["drop", "named", "two", "pick", "toggle", "toggle-advisory", "three", "modedrop"]) assert.ok(kinds.includes(k as never), k);
  assert.equal(MENU_KINDS.find(([k]) => k === "toggle-advisory")![1], "Practice/Work + Advisory icon");
  assert.ok(isModeKind("toggle") && isModeKind("three") && !isModeKind("drop"));
  assert.ok(isThreeMode("toggle-advisory") && !isThreeMode("toggle"));
});

test("a page's workspace: Advisory is its own, shared pages belong to none", () => {
  assert.equal(modeOfSection("plan"), "practice");
  assert.equal(modeOfSection("chase"), "practice");
  assert.equal(modeOfSection("papers"), "work");
  assert.equal(modeOfSection("cosec"), "work");
  assert.equal(modeOfSection("reporting"), "advisory");
  assert.equal(modeOfSection("advisory"), "advisory");
  assert.equal(modeOfSection("taxplan"), "advisory");
  assert.equal(modeOfSection("advisory-overview"), "advisory");
  assert.equal(modeOfSection("clients"), undefined);
  assert.equal(modeOfSection("settings"), undefined);
  // the older two-way switch keeps Advisory's pages in Work
  assert.equal(modeOfSection("reporting", false), "work");
  assert.equal(modeOfSection("advisory-overview", false), "work");
});

test("the section of an address", () => {
  assert.equal(sectionOfHash("#/"), "home");
  assert.equal(sectionOfHash(""), "home");
  assert.equal(sectionOfHash("#/plan/deadlines?x=1"), "plan");
  assert.equal(sectionOfHash("#/advisory/C001/levers"), "advisory");
});

test("a new account starts on the Practice/Work + Advisory icon style", () => {
  assert.equal(defaultPrefs().menuStyle, "toggle-advisory");
  assert.equal(migrateLegacy({}, NOW).menuStyle, "toggle-advisory");
});

test("moving from browser storage: the old two-way switch becomes the new default, other choices are kept", () => {
  assert.equal(migrateLegacy({ menu: "toggle" }, NOW).menuStyle, "toggle-advisory");
  assert.equal(migrateLegacy({ menu: "two" }, NOW).menuStyle, "two");
  assert.equal(migrateLegacy({ menu: "pick" }, NOW).menuStyle, "pick");
  assert.equal(migrateLegacy({ menu: "nonsense" }, NOW).menuStyle, "toggle-advisory");
  const p = migrateLegacy({ menu: "toggle", mode: "work", lastPractice: "#/plan/deadlines", lastWork: "#/tax/C001" }, NOW);
  assert.equal(p.lastMode, "work");
  assert.equal(p.lastPracticeWorkMode, "work");
  assert.deepEqual(p.lastVisited, { practice: "#/plan/deadlines", work: "#/tax/C001" });
  // an old "last Work page" that is now an Advisory page is not kept as Work's
  assert.equal(migrateLegacy({ lastWork: "#/reporting/C001" }, NOW).lastVisited.work, undefined);
});

test("all six moves between workspaces land on the last page there, or the landing page", () => {
  let p = defaultPrefs(NOW);
  p = noteVisit(p, "plan", "#/plan/deadlines", NOW);
  p = noteVisit(p, "tax", "#/tax/C001", NOW);
  p = noteVisit(p, "advisory", "#/advisory/C001/levers", NOW);
  assert.equal(landing(p, "work"), "#/tax/C001"); // Practice -> Work, Advisory -> Work
  assert.equal(landing(p, "practice"), "#/plan/deadlines"); // Work -> Practice, Advisory -> Practice
  assert.equal(landing(p, "advisory"), "#/advisory/C001/levers"); // Practice -> Advisory, Work -> Advisory
  const fresh = defaultPrefs(NOW);
  assert.equal(landing(fresh, "practice"), "#/");
  assert.equal(landing(fresh, "work"), "#/work");
  assert.equal(landing(fresh, "advisory"), "#/advisory-overview");
  // a remembered page that no longer belongs to the workspace is not used
  assert.equal(landing({ ...fresh, lastVisited: { work: "#/reporting" } }, "work"), "#/work");
});

test("from Advisory, the Practice/Work control goes back to whichever was last used", () => {
  let p = defaultPrefs(NOW);
  p = noteVisit(p, "papers", "#/papers", NOW);
  p = noteVisit(p, "advisory-overview", "#/advisory-overview", NOW);
  assert.equal(p.lastMode, "advisory");
  assert.equal(backFromAdvisory(p), "work");
  p = noteVisit(p, "plan", "#/plan", NOW);
  p = noteVisit(p, "reporting", "#/reporting", NOW);
  assert.equal(backFromAdvisory(p), "practice");
});

test("shared pages keep the workspace you were in", () => {
  let p = defaultPrefs(NOW);
  p = noteVisit(p, "reporting", "#/reporting", NOW);
  const same = noteVisit(p, "clients", "#/clients/C001", NOW);
  assert.equal(same, p); // nothing changes, nothing to save
  assert.equal(effectiveMode(p, "clients"), "advisory");
  assert.equal(effectiveMode(p, "settings"), "advisory");
  assert.equal(effectiveMode(p, "plan"), "practice");
  // the older two-way switch has no Advisory: a shared page falls back to Practice or Work
  assert.equal(effectiveMode(p, "clients", false), "practice");
  assert.equal(effectiveMode(p, "reporting", false), "work");
});

test("a visit that changes nothing gives back the same object, so it is not saved again", () => {
  const p = noteVisit(defaultPrefs(NOW), "plan", "#/plan", NOW);
  assert.equal(noteVisit(p, "plan", "#/plan", "2027-01-01T00:00:00.000Z"), p);
  assert.notEqual(noteVisit(p, "plan", "#/plan/month", NOW), p);
});

test("preferences are kept per account, keyed by account id", () => {
  assert.equal(prefsKey("11111111-aaaa"), "navPrefs:11111111-aaaa");
  assert.notEqual(prefsKey("11111111-aaaa"), prefsKey("22222222-bbbb"));
});

test("reading saved preferences: bad or missing values are put right, rubbish is refused", () => {
  assert.equal(readPrefs(undefined), undefined);
  assert.equal(readPrefs("not json"), undefined);
  assert.equal(readPrefs({ menuStyle: "sideways" }), undefined);
  const p = readPrefs(JSON.stringify({ menuStyle: "three", lastMode: "advisory", lastPracticeWorkMode: "work", lastVisited: { work: "#/tax", advisory: "javascript:alert(1)", other: "#/x" }, updated: NOW }))!;
  assert.equal(p.menuStyle, "three");
  assert.equal(p.lastMode, "advisory");
  assert.deepEqual(p.lastVisited, { work: "#/tax" });
  // an explicitly chosen old two-way switch stays chosen once it is on the account
  assert.equal(readPrefs({ menuStyle: "toggle" })!.menuStyle, "toggle");
});

test("between devices the later change wins, and a tie keeps the account's copy", () => {
  const a = { ...defaultPrefs("2026-11-16T10:00:00.000Z"), menuStyle: "three" as const };
  const b = { ...defaultPrefs("2026-11-16T11:00:00.000Z"), menuStyle: "modedrop" as const };
  assert.equal(newerPrefs(a, b).menuStyle, "modedrop");
  assert.equal(newerPrefs(b, a).menuStyle, "modedrop");
  assert.equal(newerPrefs(a, { ...b, updated: a.updated }).menuStyle, "three");
});
