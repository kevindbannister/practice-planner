// Sign-in for the client portal: the standard authorisation-code flow with PKCE against the identity
// provider (Microsoft Entra External ID). The browser never sees a password; the provider's own page
// handles registration, sign-in, confirming the email address and (if the practice requires it)
// two-step sign-in. Tokens stay in sessionStorage, so closing the tab signs the person out, and an
// idle timer signs them out sooner.

import type { PortalBranding } from "./brand";

export type Config = { configured: boolean; clientId: string; authority: string; practiceName: string; branding?: PortalBranding; dev?: boolean };

type Tokens = { id: string; refresh?: string; expires: number };
const TOKENS = "px.tokens";
const PENDING = "px.pkce";
const NOTICE = "px.notice";
const SCOPE = "openid profile email offline_access";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const challenge = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
export const redirectUri = () => `${location.origin}/portal`;

function read(): Tokens | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKENS) || "null");
    return t && typeof t.id === "string" ? t : null;
  } catch {
    return null;
  }
}
const write = (t: Tokens | null) => {
  try {
    if (t) sessionStorage.setItem(TOKENS, JSON.stringify(t));
    else sessionStorage.removeItem(TOKENS);
  } catch {
    /* this visit only */
  }
};

/** A message to show on the sign-in screen once (for example, "signed out because you were idle"). */
export function takeNotice(): string {
  try {
    const n = sessionStorage.getItem(NOTICE) || "";
    sessionStorage.removeItem(NOTICE);
    return n;
  } catch {
    return "";
  }
}
export function setNotice(message: string) {
  try {
    sessionStorage.setItem(NOTICE, message);
  } catch {
    /* fine */
  }
}

export const isSignedIn = () => Boolean(read());

async function exchange(cfg: Config, body: Record<string, string>): Promise<Tokens | null> {
  const res = await fetch(`${cfg.authority}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPE, ...body }).toString() });
  if (!res.ok) return null;
  const j = await res.json();
  if (!j.id_token) return null;
  const exp = JSON.parse(atob(String(j.id_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp;
  return { id: j.id_token, refresh: j.refresh_token, expires: Number(exp) * 1000 };
}

/** The current token, renewed quietly if it's about to run out. Null if the person must sign in again. */
export async function getToken(cfg: Config): Promise<string | null> {
  const t = read();
  if (!t) return null;
  if (t.expires - Date.now() > 60_000) return t.id;
  if (cfg.dev || !t.refresh) {
    write(null);
    return null;
  }
  const fresh = await exchange(cfg, { grant_type: "refresh_token", refresh_token: t.refresh }).catch(() => null);
  write(fresh);
  return fresh ? fresh.id : null;
}

/** Off to the provider's sign-in page. `register` opens it on the "create an account" side where the provider allows. */
export async function signIn(cfg: Config, opts: { register?: boolean; hint?: string } = {}): Promise<void> {
  const verifier = random(48);
  const state = random(16);
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
  } catch {
    throw new Error("This browser won't let the portal sign you in. Turn off private browsing restrictions and try again.");
  }
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: "code", redirect_uri: redirectUri(), scope: SCOPE, state, code_challenge: await challenge(verifier), code_challenge_method: "S256", response_mode: "query",
  });
  if (opts.hint) q.set("login_hint", opts.hint);
  location.assign(`${cfg.authority}/authorize?${q}`);
}

/** Finishes a sign-in when the provider sends the browser back with a code. */
export async function handleRedirect(cfg: Config): Promise<"signed-in" | "failed" | "none"> {
  const p = new URLSearchParams(location.search);
  if (!p.get("code") && !p.get("error")) return "none";
  let pending: { verifier: string; state: string } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING) || "null");
    sessionStorage.removeItem(PENDING);
  } catch {
    /* handled below */
  }
  history.replaceState(null, "", "/portal");
  if (p.get("error") || !pending || p.get("state") !== pending.state) return "failed";
  const t = await exchange(cfg, { grant_type: "authorization_code", code: p.get("code")!, redirect_uri: redirectUri(), code_verifier: pending.verifier }).catch(() => null);
  if (!t) return "failed";
  write(t);
  return "signed-in";
}

/** Local sign-out, then the provider's sign-out page so its own session ends too. */
export function signOut(cfg: Config, message = "") {
  write(null);
  if (message) setNotice(message);
  try {
    sessionStorage.removeItem("px.biz");
  } catch {
    /* fine */
  }
  if (cfg.dev || !cfg.authority) {
    location.assign("/portal");
    return;
  }
  location.assign(`${cfg.authority}/logout?post_logout_redirect_uri=${encodeURIComponent(redirectUri())}`);
}

/** Dev server only: sign in as anyone, with the stand-in identity provider. */
export async function devSignIn(who: { email: string; name: string; mfa: boolean }) {
  const res = await fetch("/dev/idp/token", { method: "POST", body: JSON.stringify(who) });
  const { token } = await res.json();
  const exp = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp;
  write({ id: token, expires: Number(exp) * 1000 });
}

/** Signs out after a quiet spell. Any click, key press or touch counts as being here. */
export function idleGuard(minutes: number, onIdle: () => void): () => void {
  let last = Date.now();
  const touch = () => (last = Date.now());
  const events = ["click", "keydown", "touchstart", "mousemove"] as const;
  events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
  const timer = setInterval(() => {
    if (Date.now() - last > minutes * 60_000) onIdle();
  }, 15_000);
  return () => {
    clearInterval(timer);
    events.forEach((e) => window.removeEventListener(e, touch));
  };
}
