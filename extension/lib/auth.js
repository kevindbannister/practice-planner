// Microsoft sign-in for the extension: the standard authorisation-code flow with PKCE, run through Chrome's identity API.
// Tokens stay in this browser's extension storage and are refreshed quietly. No passwords or secrets are held here.
import { AUTHORITY, CLIENT_ID, SCOPES } from "../config.js";

const KEY = "tokens";
export class AuthError extends Error {}

const b64url = (bytes) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const challenge = async (verifier) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

/** The address Microsoft sends you back to. It must be listed in the app registration (see the README). */
export const redirectUri = () => chrome.identity.getRedirectURL();

async function save(tokens) {
  await chrome.storage.local.set({ [KEY]: tokens });
  return tokens;
}
async function load() {
  return (await chrome.storage.local.get(KEY))[KEY] || null;
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES.join(" "), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(body.error_description ? String(body.error_description).split("\r")[0] : `Sign-in failed (${res.status})`);
  return { access: body.access_token, refresh: body.refresh_token, expires: Date.now() + (Number(body.expires_in) - 120) * 1000 };
}

export async function signIn() {
  const verifier = random(48), state = random(16);
  const redirect = redirectUri();
  const url = `${AUTHORITY}/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: redirect, response_mode: "query", scope: SCOPES.join(" "),
    code_challenge: await challenge(verifier), code_challenge_method: "S256", state,
  });
  let back;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    throw new AuthError(/did not approve|cancel|closed/i.test(String(e?.message)) ? "Sign-in was cancelled." : `Couldn't open the Microsoft sign-in window. ${e?.message || ""}`.trim());
  }
  const q = new URL(back).searchParams;
  if (q.get("error")) throw new AuthError(q.get("error_description") || q.get("error"));
  if (q.get("state") !== state) throw new AuthError("The sign-in reply didn't match. Try again.");
  return save(await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirect, code_verifier: verifier }));
}

export async function signedIn() {
  return !!(await load());
}
export async function signOut() {
  await chrome.storage.local.remove(KEY);
}

/** A valid access token, refreshed when it is about to run out. Throws AuthError when you need to sign in again. */
export async function getToken() {
  const t = await load();
  if (!t) throw new AuthError("Not signed in.");
  if (t.expires > Date.now()) return t.access;
  if (!t.refresh) { await signOut(); throw new AuthError("Your sign-in ran out. Sign in again."); }
  try {
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh });
    await save({ ...fresh, refresh: fresh.refresh || t.refresh });
    return fresh.access;
  } catch (e) {
    await signOut();
    throw new AuthError("Your sign-in ran out. Sign in again.");
  }
}
