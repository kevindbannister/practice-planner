#!/usr/bin/env node
// Phase 6 test-gateway runner. Sends ONE approved accounts snapshot to the Companies House TEST gateway and writes redacted evidence.
//   CH_PRESENTER_ID=... CH_PRESENTER_AUTH=... node api/tools/accounts-test-run.js snapshot.json
// It never goes live (CH_GATEWAY_LIVE is refused), never uses real client accounts unless you point it at one (don't), and refuses while
// the accounts message format is unverified. Evidence goes to ./test-evidence/ (keep it out of git). It is a manual tool, not part of the app.
const fs = require("node:fs");
const path = require("node:path");
const F = require("../cosec/lib/accountsFiling.js");

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const p = (k) => path.join(dir, encodeURIComponent(k) + ".json");
  return {
    async get(k) { try { return JSON.parse(fs.readFileSync(p(k), "utf8")); } catch { return null; } },
    async createIfAbsent(k, v) { try { fs.writeFileSync(p(k), JSON.stringify(v, null, 2), { flag: "wx" }); return true; } catch (e) { if (e.code === "EEXIST") return false; throw e; } },
    async put(k, v) { fs.writeFileSync(p(k), JSON.stringify(v, null, 2)); },
    async list(prefix) { return fs.readdirSync(dir).map(decodeURIComponent).map((f) => f.replace(/\.json$/, "")).filter((k) => k.startsWith(prefix)).map((k) => ({ ...JSON.parse(fs.readFileSync(p(k), "utf8")), key: k })); },
  };
}

async function main(argv, env = process.env, spec = F.ACCOUNTS_SPEC) {
  if (env.CH_GATEWAY_LIVE) return { code: 2, message: "Refusing: CH_GATEWAY_LIVE is set. This tool only ever uses the test gateway." };
  if (!argv[0]) return { code: 2, message: "Usage: accounts-test-run.js snapshot.json" };
  const snapshot = JSON.parse(fs.readFileSync(argv[0], "utf8"));
  const store = fileStore(env.CH_TEST_EVIDENCE_DIR || "test-evidence");
  const key = `TEST-${snapshot.company && snapshot.company.number}-${snapshot.period && snapshot.period.end}`;
  try {
    await F.recordApproval({ store, filingKey: key, snapshot, approvedBy: snapshot.signing && snapshot.signing.director, approvedOn: snapshot.signing && snapshot.signing.date, user: "test-run", now: Date.now() });
    const out = await F.submitAccounts({ store, fetch: globalThis.fetch, env, filingKey: key, user: "test-run", now: Date.now(), spec });
    return { code: 0, message: `Sent to the TEST gateway: ${JSON.stringify(out)}. Now email xml@companieshouse.gov.uk so the pending test submission is reviewed.` };
  } catch (e) { return { code: 1, message: `Not sent (${e.code || "error"}): ${F.redact(String(e.message))}` }; }
}
module.exports = { main, fileStore };
if (require.main === module) main(process.argv.slice(2)).then((r) => { console.log(r.message); process.exit(r.code); });
