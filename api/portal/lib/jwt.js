// Verifies the sign-in token a client's browser sends to the portal API.
//
// Clients sign in with an external identity provider (Microsoft Entra External ID). Its tokens are
// RS256 JWTs; we check the signature against the provider's published keys, then the issuer,
// audience and times. Nothing here stores or sees a password. Keys are fetched once and kept
// for an hour (and re-fetched when a token names a key we haven't seen).

const crypto = require("node:crypto");

const KEYS_FOR_MS = 60 * 60 * 1000;
const SKEW_S = 60;

function parts(token) {
  const p = String(token || "").split(".");
  if (p.length !== 3 || p.some((x) => !x || x.length > 8000)) return null;
  try {
    return { header: JSON.parse(Buffer.from(p[0], "base64url").toString("utf8")), claims: JSON.parse(Buffer.from(p[1], "base64url").toString("utf8")), signed: `${p[0]}.${p[1]}`, sig: Buffer.from(p[2], "base64url") };
  } catch {
    return null;
  }
}

/** { verify(token) -> { ok, claims } | { ok: false, reason } } */
function createVerifier({ issuer, audience, jwksUrl, fetch = globalThis.fetch, now = () => Date.now() }) {
  let keys = new Map(); // kid -> KeyObject
  let loaded = 0;

  async function load() {
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new Error(`keys ${res.status}`);
    const body = await res.json();
    const next = new Map();
    for (const k of body.keys || []) {
      if (k.kty !== "RSA" || !k.kid || (k.use && k.use !== "sig")) continue;
      try {
        next.set(k.kid, crypto.createPublicKey({ key: k, format: "jwk" }));
      } catch {
        /* skip a key we can't read */
      }
    }
    keys = next;
    loaded = now();
  }

  async function keyFor(kid) {
    if (!loaded || now() - loaded > KEYS_FOR_MS) await load();
    if (!keys.has(kid) && now() - loaded > 30 * 1000) await load(); // unknown key: maybe rotated
    return keys.get(kid);
  }

  async function verify(token) {
    const p = parts(token);
    if (!p) return { ok: false, reason: "malformed" };
    if (p.header.alg !== "RS256" || !p.header.kid) return { ok: false, reason: "algorithm" };
    let key;
    try {
      key = await keyFor(p.header.kid);
    } catch {
      return { ok: false, reason: "keys-unavailable" };
    }
    if (!key) return { ok: false, reason: "unknown-key" };
    if (!crypto.verify("RSA-SHA256", Buffer.from(p.signed), key, p.sig)) return { ok: false, reason: "signature" };
    const c = p.claims;
    if (c.iss !== issuer) return { ok: false, reason: "issuer" };
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(audience)) return { ok: false, reason: "audience" };
    const t = Math.floor(now() / 1000);
    if (typeof c.exp !== "number" || c.exp + SKEW_S < t) return { ok: false, reason: "expired" };
    if (typeof c.nbf === "number" && c.nbf - SKEW_S > t) return { ok: false, reason: "not-yet" };
    if (!c.sub && !c.oid) return { ok: false, reason: "no-subject" };
    return { ok: true, claims: c };
  }
  return { verify };
}

/** The person behind a verified token: a stable id, an email, a name and whether MFA was used. */
function identityOf(c) {
  const email = String(c.email || (Array.isArray(c.emails) ? c.emails[0] : "") || (/@/.test(c.preferred_username || "") ? c.preferred_username : "") || "").trim().toLowerCase();
  const amr = Array.isArray(c.amr) ? c.amr : [];
  return {
    sub: String(c.oid || c.sub),
    email,
    emailVerified: c.email_verified !== false, // the provider verifies sign-up email by one-time code
    name: String(c.name || [c.given_name, c.family_name].filter(Boolean).join(" ") || "").trim(),
    mfa: amr.includes("mfa"),
    issuedAt: Number(c.iat) || 0,
  };
}

module.exports = { createVerifier, identityOf, parts };
