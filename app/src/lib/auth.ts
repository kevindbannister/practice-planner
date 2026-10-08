// Microsoft sign-in using the standard authorisation-code flow with PKCE, as Microsoft
// requires for single-page apps. Tokens live in sessionStorage only (cleared when the
// tab closes) and are refreshed automatically while the tab is open.
import { AUTHORITY, CLIENT_ID, SCOPES } from "../config";

type Tokens = { access: string; refresh?: string; expires: number };
type Pending = { verifier: string; state: string; returnTo: string };

const TOKENS = "pp.tokens";
const PENDING = "pp.pkce";

export class AuthError extends Error {}

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export const redirectUri = (): string => window.location.origin + "/";

function load(): Tokens | null {
  try {
    return JSON.parse(sessionStorage.getItem(TOKENS) || "null");
  } catch {
    return null;
  }
}

export function isSignedIn(): boolean {
  return load() !== null;
}

export async function signIn(prompt?: "select_account"): Promise<never> {
  const verifier = randomString(48);
  const state = randomString(16);
  const pending: Pending = { verifier, state, returnTo: window.location.hash };
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
  });
  if (prompt) params.set("prompt", prompt);
  window.location.assign(`${AUTHORITY}/authorize?${params}`);
  return new Promise<never>(() => {}); // the page is navigating away
}

/** Finish sign-in if this page load is Microsoft redirecting back. Returns true if it was. */
export async function handleRedirect(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code && !error) return false;

  const pending: Pending | null = JSON.parse(sessionStorage.getItem(PENDING) || "null");
  sessionStorage.removeItem(PENDING);
  window.history.replaceState(null, "", url.pathname + (pending?.returnTo || ""));

  if (error) throw new AuthError(url.searchParams.get("error_description") || error);
  if (!pending || pending.state !== url.searchParams.get("state")) {
    throw new AuthError("The sign-in response didn't match this browser tab. Please sign in again.");
  }
  await tokenRequest({
    grant_type: "authorization_code",
    code: code as string,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  return true;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES.join(" "), ...params });
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new AuthError(json.error_description || json.error || `Sign-in failed (${res.status})`);
  }
  const tokens: Tokens = {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + (Number(json.expires_in || 3600) - 120) * 1000,
  };
  sessionStorage.setItem(TOKENS, JSON.stringify(tokens));
  return tokens;
}

let refreshing: Promise<Tokens> | null = null;

/** A current access token for Microsoft Graph, refreshing or signing in again if needed. */
export async function getAccessToken(): Promise<string> {
  const t = load();
  if (t && t.expires > Date.now()) return t.access;
  if (t?.refresh) {
    refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh }).finally(() => {
      refreshing = null;
    });
    try {
      return (await refreshing).access;
    } catch {
      /* fall through to a fresh sign-in */
    }
  }
  sessionStorage.removeItem(TOKENS);
  return signIn();
}

export function signOut(): void {
  sessionStorage.removeItem(TOKENS);
  window.location.assign(`${AUTHORITY}/logout?post_logout_redirect_uri=${encodeURIComponent(redirectUri())}`);
}
