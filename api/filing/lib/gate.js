// Which filing environments may be used right now. Mock is always allowed. The External Test Service needs HMRC's vendor ID and test
// credentials. Live is off by default: it needs FILING_LIVE_ENABLED=1 and FILING_LIVE_APPROVED_BY (who approved it), as well as the
// vendor ID. The same rules are in the planner's own record (app/src/lib/hmrcFiling.ts envGate), so a screen and the server agree.
async function settingsFrom(env, secrets) {
  const st = await secrets.status();
  return {
    vendorIdSet: !!st.set.FILING_VENDOR_ID,
    testCredentialsSet: !!(st.set.FILING_SENDER_ID && st.set.FILING_PASSWORD),
    liveEnabled: String(env.FILING_LIVE_ENABLED || "").trim() === "1",
    liveApprovedBy: String(env.FILING_LIVE_APPROVED_BY || "").trim(),
    store: { provider: st.provider, configured: st.configured, signIn: st.signIn, error: st.error },
  };
}
function envGate(mode, st) {
  if (mode === "mock") return { ok: true, reason: "" };
  if (mode === "ets") {
    if (!st.vendorIdSet) return { ok: false, reason: "HMRC's XML vendor ID isn't set up. It comes from HMRC's software developer support team." };
    if (!st.testCredentialsSet) return { ok: false, reason: "HMRC's test credentials aren't set up." };
    return { ok: true, reason: "" };
  }
  if (mode === "live") {
    if (!st.liveEnabled) return { ok: false, reason: "Live filing is switched off." };
    if (!st.liveApprovedBy) return { ok: false, reason: "Live filing hasn't been approved by a named person." };
    if (!st.vendorIdSet) return { ok: false, reason: "HMRC's XML vendor ID isn't set up." };
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: "That isn't a filing environment." };
}
module.exports = { settingsFrom, envGate };
