// Finding the planner client for what is on a Xero page. Pure functions, so they can be tested without a browser.

const NOISE = /\b(limited|ltd|llp|plc|lp|the|and|co|company|group|holdings|uk)\b/g;

/** A name boiled down for comparing: lower case, no punctuation, no company suffixes. */
export function normalise(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (s) => new Set(s.split(" ").filter((t) => t.length > 1));

/** 0 to 1: how well two names match. 1 is the same name once company suffixes and punctuation are ignored. */
export function score(a, b) {
  const x = normalise(a), y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = tokens(x), ty = tokens(y);
  if (!tx.size || !ty.size) return 0;
  const shared = [...tx].filter((t) => ty.has(t)).length;
  const jaccard = shared / (tx.size + ty.size - shared);
  // one name inside the other ("Alan Bannister" in "Mr Alan Bannister") counts, but less than a full match
  const contains = x.includes(y) || y.includes(x) ? 0.88 : 0;
  return Math.max(jaccard, contains);
}

/**
 * The best planner clients for the texts found on a page.
 * Returns { best, others } where best is set only when one client clearly wins.
 */
export function findClient(clients, candidates, opts = {}) {
  const threshold = opts.threshold ?? 0.75;
  const scored = [];
  for (const c of clients) {
    const names = [c.Title, c.TradingName].filter(Boolean);
    let top = 0, via = "";
    for (const cand of candidates) for (const n of names) {
      const s = score(cand, n);
      if (s > top) { top = s; via = cand; }
    }
    if (top > 0.4) scored.push({ client: c, score: top, via });
  }
  scored.sort((p, q) => q.score - p.score || String(p.client.Title).localeCompare(String(q.client.Title)));
  const first = scored[0], second = scored[1];
  const clear = first && first.score >= threshold && (!second || first.score - second.score >= 0.08 || first.score === 1 && second.score < 1);
  return { best: clear ? first : undefined, others: scored.slice(0, 5) };
}

/** Search the client list by typing: matches names, trading names and company numbers. */
export function searchClients(clients, query, limit = 8) {
  const q = normalise(query), raw = String(query || "").trim().toLowerCase();
  if (!raw) return [];
  return clients
    .map((c) => {
      const num = String(c.CompanyNumber || "").toLowerCase();
      const names = [c.Title, c.TradingName].filter(Boolean).map(String);
      let s = names.some((n) => n.toLowerCase().includes(raw)) ? 0.9 : 0;
      if (!s && q) s = Math.max(0, ...names.map((n) => score(n, query)));
      if (num && num === raw) s = 1;
      return { client: c, score: s };
    })
    .filter((r) => r.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.client);
}

/** The Xero organisation's short code from a Xero address, e.g. go.xero.com/app/!abc12/dashboard. */
export function xeroShortCode(url) {
  try {
    const u = new URL(url);
    const m = /\/app\/!([A-Za-z0-9]+)/.exec(u.pathname);
    return m ? m[1] : u.searchParams.get("shortcode") || "";
  } catch {
    return "";
  }
}

/** Names worth trying from a page's title, e.g. "Xero | Dashboard | Acme Ltd" gives "Acme Ltd". */
export function titleNames(title) {
  const parts = String(title || "").split(/\s[|–—-]\s/).map((p) => p.trim()).filter(Boolean);
  const generic = /^(xero|dashboard|business overview|home|contacts?|invoices?|bills?|reports?|bank accounts?|accounting|payroll|projects?|sales|purchases|settings|login|log in)$/i;
  return parts.filter((p) => !generic.test(p));
}
