import { useState } from "react";
import { Config, devSignIn, signIn } from "./auth";

export function SignInScreen({ cfg, message }: { cfg: Config | null; message: string }) {
  const [err, setErr] = useState("");
  const go = async (register: boolean) => {
    setErr("");
    try {
      if (cfg) await signIn(cfg, { register });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start sign-in.");
    }
  };
  return (
    <main className="px-signin" aria-labelledby="si-h">
      <div className="px-signin-card">
        {cfg?.branding?.loginLogo || cfg?.branding?.logo ? <img className="px-signin-logo" src={cfg.branding.loginLogo || cfg.branding.logo} alt={cfg.practiceName} /> : <div className="px-brand">{cfg?.practiceName || "Client portal"}</div>}
        <h1 id="si-h">Client portal</h1>
        {!cfg ? (
          <p role="alert">The portal can't be reached right now. Please try again in a few minutes.</p>
        ) : !cfg.configured ? (
          <p role="alert">The portal isn't open yet. Please contact {cfg.practiceName}.</p>
        ) : (
          <>
            {cfg.branding?.welcome ? <p className="px-welcome">{cfg.branding.welcome}</p> : <p>Sign in to see your documents, sign them, answer requests and message us securely.</p>}
            {message && <p className="px-notice" role="status">{message}</p>}
            {err && <p className="px-error" role="alert">{err}</p>}
            {cfg.dev ? <DevSignIn /> : (
              <div className="px-actions">
                <button type="button" className="px-btn" onClick={() => go(false)}>Sign in</button>
                <button type="button" className="px-btn secondary" onClick={() => go(true)}>Create an account</button>
              </div>
            )}
            {(cfg.branding?.supportEmail || cfg.branding?.contact.phone) && <p className="px-fine">Need help? {cfg.branding?.supportEmail && <a href={`mailto:${cfg.branding.supportEmail}`}>{cfg.branding.supportEmail}</a>}{cfg.branding?.supportEmail && cfg.branding?.contact.phone ? " or " : ""}{cfg.branding?.contact.phone}</p>}
            <p className="px-fine">New here? Create an account with the email address {cfg.practiceName} has for you. You'll be asked to confirm it with a one-time code. Creating an account doesn't open anything by itself: {cfg.practiceName} chooses what you can see.</p>
          </>
        )}
      </div>
    </main>
  );
}

/** Dev server only (never in production): stands in for the identity provider's pages. */
function DevSignIn() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [mfa, setMfa] = useState(false);
  return (
    <form className="px-form" onSubmit={async (e) => { e.preventDefault(); await devSignIn({ email, name, mfa }); location.reload(); }}>
      <p className="px-notice">Test sign-in (stand-in for the identity provider)</p>
      <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="px-check"><input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} /> Used two-step sign-in</label>
      <button type="submit" className="px-btn">Sign in</button>
    </form>
  );
}
