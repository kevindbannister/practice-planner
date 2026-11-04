// Where HMRC filing credentials come from. Values are only ever read here, on the server, and are never returned: status() says whether
// each one is set and nothing more. Two providers:
//
//   settings   Azure application settings (what the PAYE bridge uses today). The simplest, and the weakest: anyone who can read the
//              app's settings can read them.
//   keyvault   Azure Key Vault, read over its REST API. Two ways to sign in to the vault:
//                - managed identity (IDENTITY_ENDPOINT and IDENTITY_HEADER are set by Azure). NOT available to the managed functions of
//                  Azure Static Web Apps; it needs the API linked as a "bring your own" Functions app.
//                - a service principal (FILING_KV_TENANT_ID, FILING_KV_CLIENT_ID, FILING_KV_CLIENT_SECRET). That one secret still lives
//                  in application settings, but it can read only this vault, and the filing credentials themselves are not there.
//              FILING_KV_VAULT is the vault's name; a secret named like a setting (FILING_SENDER_ID) is looked up with dashes
//              (FILING-SENDER-ID), because Key Vault doesn't allow underscores.
//
// FILING_SECRETS chooses the provider ("keyvault" or "settings"); with a vault set up and no choice made, the vault is used.

const NAMES = ["FILING_VENDOR_ID", "FILING_SENDER_ID", "FILING_PASSWORD"];
const kvName = (name) => String(name).replace(/_/g, "-");

function createSecrets({ env = process.env, fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const vault = String(env.FILING_KV_VAULT || "").trim();
  const managed = !!(env.IDENTITY_ENDPOINT && env.IDENTITY_HEADER);
  const principal = !!(env.FILING_KV_TENANT_ID && env.FILING_KV_CLIENT_ID && env.FILING_KV_CLIENT_SECRET);
  const chosen = String(env.FILING_SECRETS || "").trim().toLowerCase();
  const provider = chosen === "settings" ? "settings" : chosen === "keyvault" || (vault && (managed || principal)) ? "keyvault" : "settings";
  let token = null;
  const cache = new Map();

  async function vaultToken() {
    if (token && token.exp - 60000 > now()) return token.value;
    let res;
    if (managed) {
      res = await fetch(`${env.IDENTITY_ENDPOINT}?resource=${encodeURIComponent("https://vault.azure.net")}&api-version=2019-08-01`, { headers: { "X-IDENTITY-HEADER": env.IDENTITY_HEADER } });
    } else {
      res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.FILING_KV_TENANT_ID)}/oauth2/v2.0/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.FILING_KV_CLIENT_ID, client_secret: env.FILING_KV_CLIENT_SECRET, scope: "https://vault.azure.net/.default" }).toString(),
      });
    }
    if (!res.ok) { const e = new Error("The key vault wouldn't sign in."); e.code = "vault-signin"; throw e; }
    const j = await res.json();
    const value = j.access_token;
    if (!value) { const e = new Error("The key vault sign-in gave no token."); e.code = "vault-signin"; throw e; }
    token = { value, exp: now() + (Number(j.expires_in) || 300) * 1000 };
    return value;
  }

  /** The value of a secret, or "" when it isn't there. Never logged and never returned to the browser. */
  async function get(name) {
    if (!NAMES.includes(name)) throw new Error(`${name} isn't a filing secret.`);
    if (provider === "settings") return String(env[name] || "");
    if (cache.has(name) && cache.get(name).exp > now()) return cache.get(name).value;
    const res = await fetch(`https://${vault}.vault.azure.net/secrets/${encodeURIComponent(kvName(name))}?api-version=7.4`, { headers: { Authorization: `Bearer ${await vaultToken()}` } });
    if (res.status === 404) return "";
    if (!res.ok) { const e = new Error("The key vault wouldn't give up a secret."); e.code = "vault-read"; throw e; }
    const value = String((await res.json()).value || "");
    cache.set(name, { value, exp: now() + 5 * 60 * 1000 });
    return value;
  }

  /** Which secrets are set, and where they are kept. The values themselves are never part of this. */
  async function status() {
    const set = {};
    let error = "";
    for (const n of NAMES) {
      try { set[n] = !!(await get(n)); } catch (e) { set[n] = false; error = e.message; }
    }
    const configured = provider === "settings" || !!vault;
    return { provider, configured, signIn: provider === "keyvault" ? (managed ? "managed identity" : principal ? "service principal" : "none") : "", set, error };
  }
  return { get, status, provider };
}

module.exports = { createSecrets, NAMES };
