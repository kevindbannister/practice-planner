// A virus check that never sends the file anywhere: only the file's SHA-256 fingerprint is looked up in VirusTotal's database of
// known malicious files. A file Microsoft 365 or VirusTotal's engines have seen as malicious is refused; an unknown fingerprint is
// let through (most client documents are unique, so this catches known malware, not new threats). Files kept in SharePoint are
// also scanned by Microsoft 365. Switched on by setting VIRUSTOTAL_API_KEY in Azure; if VirusTotal can't be reached the file is
// accepted (format checks still apply) and the reason is recorded, so a VirusTotal outage never blocks a client's upload.

function createHashScanner({ apiKey, fetch = globalThis.fetch, timeoutMs = 8000 }) {
  return async function scan(bytes, chk) {
    let res;
    try {
      res = await fetch(`https://www.virustotal.com/api/v3/files/${encodeURIComponent(chk.sha256)}`, { headers: { "x-apikey": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch { return { ok: true, result: "unchecked" }; }
    if (res.status === 404) return { ok: true, result: "not-known" };
    if (!res.ok) return { ok: true, result: "unchecked" };
    let j = null;
    try { j = await res.json(); } catch { return { ok: true, result: "unchecked" }; }
    const s = (j && j.data && j.data.attributes && j.data.attributes.last_analysis_stats) || {};
    const bad = Number(s.malicious || 0);
    return bad > 0 ? { ok: false, result: "malicious", engines: bad } : { ok: true, result: "clean" };
  };
}

module.exports = { createHashScanner };
