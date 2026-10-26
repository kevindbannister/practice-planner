// The Xama (AML checks) bridge, as the app sees it. Xama's own sign-in and addresses stay on the
// server (api/xama); the browser only asks it to test the connection or read one path.
export type XamaStatus = { configured: boolean; missing: string[]; clientIdEnding: string; tokenHost: string; apiBase: string; authStyle: string; scope?: string };
export type XamaStep = { name: string; ok: boolean; status?: number; message: string; sample?: string };
export type XamaTest = { ok: boolean; steps: XamaStep[] };

/** What the practice has chosen about how Xama is linked (kept in the Settings list as xama.config). */
export type XamaConfig = {
  firmId: string; // the firm's own Xama client ID, if Xama's paths need it
  matchBy: "number-then-name" | "name"; // how a Xama client is matched to one of ours
  testPath: string; // a path to try in "Test connection"
  clientsPath: string; // where Xama lists clients
  amlPath: string; // where one client's AML check is read; {id} is replaced with the Xama client's ID
  passed: string; // the words Xama uses for a passed check, comma-separated
  review: string; // ...for a check that needs a look
  failed: string; // ...for a failed check
};
export const DEFAULT_XAMA_CONFIG: XamaConfig = { firmId: "", matchBy: "number-then-name", testPath: "", clientsPath: "", amlPath: "", passed: "approved, passed, low", review: "pending, review, medium", failed: "rejected, failed, high" };

export interface XamaApi {
  status(): Promise<XamaStatus>;
  test(path?: string): Promise<XamaTest>;
}

export class HttpXama implements XamaApi {
  constructor(private token: () => Promise<string>) {}
  async status(): Promise<XamaStatus> {
    try {
      const res = await fetch("/api/xama/status", { headers: { Accept: "application/json" } });
      const j = await res.json();
      return { configured: !!j.configured, missing: j.missing || [], clientIdEnding: j.clientIdEnding || "", tokenHost: j.tokenHost || "", apiBase: j.apiBase || "", authStyle: j.authStyle || "basic", scope: j.scope };
    } catch {
      return { configured: false, missing: ["the Xama connection isn't on the server yet"], clientIdEnding: "", tokenHost: "", apiBase: "", authStyle: "basic" };
    }
  }
  async test(path?: string): Promise<XamaTest> {
    let res: Response;
    try {
      res = await fetch("/api/xama/test", { method: "POST", headers: { "X-PP-Token": await this.token(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ path: path || "" }) });
    } catch {
      return { ok: false, steps: [{ name: "Reach the app's server", ok: false, message: "Couldn't reach the app's server. Check your internet connection." }] };
    }
    let j: any = null;
    try { j = await res.json(); } catch { /* not JSON: bridge not deployed */ }
    if (!j) return { ok: false, steps: [{ name: "Reach the app's server", ok: false, message: "The Xama connection isn't on the server yet. It arrives with the next deployment." }] };
    if (j.error) return { ok: false, steps: [{ name: "Check the set-up", ok: false, message: j.message || "Xama didn't answer." }] };
    return { ok: !!j.ok, steps: j.steps || [] };
  }
}

/** Stand-in for the demo build: pretends Xama is set up and answering. */
export class FakeXama implements XamaApi {
  async status(): Promise<XamaStatus> {
    return { configured: true, missing: [], clientIdEnding: "demo", tokenHost: "auth.xama.example", apiBase: "https://api.xama.example/v1/", authStyle: "basic" };
  }
  async test(path?: string): Promise<XamaTest> {
    const steps: XamaStep[] = [{ name: "Sign in to Xama", ok: true, message: "Xama accepted the client ID and secret. The access token lasts 60 minutes. (Demo)" }];
    if (path) steps.push({ name: `Read ${path}`, ok: true, status: 200, message: "Xama answered (HTTP 200). (Demo)", sample: JSON.stringify({ items: [{ id: "demo-1", name: "The Kent Stove Company Ltd", riskStatus: "approved" }] }, null, 2) });
    return { ok: true, steps };
  }
}
