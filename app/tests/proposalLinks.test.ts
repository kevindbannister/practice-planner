import { test } from "node:test";
import assert from "node:assert/strict";
import { interest, linksForVersion, openedLine } from "../src/lib/proposalLinks.ts";
import type { ProposalLinkInfo } from "../src/lib/portalAdmin.ts";

const l = (o: Partial<ProposalLinkInfo>): ProposalLinkInfo => ({ id: "a", version: 1, status: "open", createdAt: "2026-11-01T10:00:00Z", createdBy: "K", expiresAt: "", viewedAt: "", to: "x@y.com", answeredAt: "", ...o });
const when = (s: string) => s.slice(5, 10);

test("opened line covers never, once and many", () => {
  assert.equal(openedLine(l({}), when), "Not opened yet");
  assert.equal(openedLine(l({ viewedAt: "2026-11-02T14:05:00Z", viewCount: 1 }), when), "Opened once, 11-02");
  assert.equal(openedLine(l({ viewedAt: "2026-11-02T14:05:00Z", lastViewedAt: "2026-11-04T09:12:00Z", viewCount: 3 }), when), "Opened 3 times, first 11-02, last 11-04");
  // links made before counting existed still read as opened once
  assert.equal(openedLine(l({ viewedAt: "2026-11-02T14:05:00Z" }), when), "Opened once, 11-02");
});

test("only the version shown, newest first; withdrawn links don't count as interest", () => {
  const a = l({ id: "a", createdAt: "2026-11-01T10:00:00Z" }), b = l({ id: "b", createdAt: "2026-11-03T10:00:00Z" }), c = l({ id: "c", version: 2 });
  assert.deepEqual(linksForVersion([a, b, c], 1).map((x) => x.id), ["b", "a"]);
  assert.equal(interest([]).line, "");
  assert.equal(interest([l({ status: "revoked", viewedAt: "2026-11-02T00:00:00Z" })]).line, "");
  assert.equal(interest([a]).line, "Link sent, not opened yet");
  assert.equal(interest([a, l({ viewedAt: "2026-11-02T00:00:00Z" })]).opened, true);
});
