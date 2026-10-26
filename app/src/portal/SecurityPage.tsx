import { useState } from "react";
import { signOut } from "./auth";
import type { Ctx } from "./PortalApp";

export function SecurityPage({ ctx }: { ctx: Ctx }) {
  const { me, api, cfg } = ctx;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const everywhere = async () => {
    setBusy(true); setErr("");
    try { await api.signOutEverywhere(); signOut(cfg, "You've been signed out on all devices."); } catch { setErr("Couldn't do that. Please try again."); setBusy(false); }
  };
  return (
    <div className="px-stack">
      <h1>Security</h1>
      <section className="px-card" aria-labelledby="s-acc">
        <h2 id="s-acc">Your account</h2>
        <dl className="px-dl">
          <div><dt>Name</dt><dd>{me.user.name || "—"}</dd></div>
          <div><dt>Sign-in email</dt><dd>{me.user.email}</dd></div>
          <div><dt>Two-step sign-in</dt><dd>{me.user.mfa ? "On for this sign-in" : "Not used for this sign-in"}</dd></div>
        </dl>
        <p className="px-muted">Two-step sign-in asks for a second check, such as a code sent to you, each time you sign in. It's your choice whether to use it, where {cfg.practiceName} allows. {me.user.mfa ? "You used it to sign in just now." : "To turn it on, or if you can't sign in, contact " + cfg.practiceName + "."}</p>
        <p className="px-muted">Your password, and any codes you use to sign in, are handled by our sign-in provider. {cfg.practiceName} can never see them. To change your sign-in email address, ask {cfg.practiceName}: they'll send a confirmation link to the new address.</p>
      </section>
      <section className="px-card" aria-labelledby="s-ses">
        <h2 id="s-ses">Sessions</h2>
        <p className="px-muted">You're signed out automatically after 30 minutes without using the portal. If you've used a shared computer, or think someone else has your login, sign out everywhere.</p>
        {err && <p className="px-error" role="alert">{err}</p>}
        <div className="px-actions">
          <button type="button" className="px-btn secondary" onClick={() => signOut(cfg)}>Sign out</button>
          <button type="button" className="px-btn" disabled={busy} onClick={everywhere}>Sign out on all devices</button>
        </div>
      </section>
    </div>
  );
}
