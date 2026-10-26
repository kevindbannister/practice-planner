// The Xama (AML checks) bridge, as the app sees it. Xama's sign-in and addresses stay on the
// server (api/xama); the browser only asks it to test the connection or read one path.
export type XamaStatus = { configured: boolean; missing: string[]; clientIdEnding: string; tokenHost: string; apiBase: string; authStyle: string; audience?: string; scope?: string };
export type XamaStep = { name: string; ok: boolean; status?: number; message: string; sample?: string };
export type XamaTest = { ok: boolean; steps: XamaStep[] };

/** What the practice has chosen about how Xama is linked (kept in the Settings list as xama.config). */
export type XamaConfig = {
  firmId: string; // your Xama client ID (it's in every Xama address; not the OAuth client ID)
  staleMonths: number; // an approved assessment older than this shows as "Review due"
};
export const DEFAULT_XAMA_CONFIG: XamaConfig = { firmId: "", staleMonths: 12 };

export class XamaError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

export interface XamaApi {
  status(): Promise<XamaStatus>;
  test(path?: string, query?: Record<string, string>): Promise<XamaTest>;
  /** One read (GET) from Xama, below the API address, e.g. "clients/<id>/search". */
  get(path: string, query?: Record<string, string | number>): Promise<any>;
}

export class HttpXama implements XamaApi {
  constructor(private token: () => Promise<string>) {}

  private async post(action: string, body: Record<string, unknown>): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/xama/${action}`, { method: "POST", headers: { "X-PP-Token": await this.token(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new XamaError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let j: any = null;
    try { j = await res.json(); } catch { /* not JSON: bridge not deployed */ }
    if (!j) throw new XamaError("no-bridge", "The Xama connection isn't on the server yet. It arrives with the next deployment.");
    return j;
  }

  async status(): Promise<XamaStatus> {
    try {
      const res = await fetch("/api/xama/status", { headers: { Accept: "application/json" } });
      const j = await res.json();
      return { configured: !!j.configured, missing: j.missing || [], clientIdEnding: j.clientIdEnding || "", tokenHost: j.tokenHost || "", apiBase: j.apiBase || "", authStyle: j.authStyle || "json", audience: j.audience, scope: j.scope };
    } catch {
      return { configured: false, missing: ["the Xama connection isn't on the server yet"], clientIdEnding: "", tokenHost: "", apiBase: "", authStyle: "json" };
    }
  }

  async test(path?: string, query?: Record<string, string>): Promise<XamaTest> {
    try {
      const j = await this.post("test", { path: path || "", query });
      if (j.error) return { ok: false, steps: [{ name: "Check the set-up", ok: false, message: j.message || "Xama didn't answer." }] };
      return { ok: !!j.ok, steps: j.steps || [] };
    } catch (e) {
      return { ok: false, steps: [{ name: "Reach the app's server", ok: false, message: (e as Error).message }] };
    }
  }

  async get(path: string, query?: Record<string, string | number>): Promise<any> {
    const j = await this.post("call", { path, query });
    if (j.error) throw new XamaError(j.error, j.message || "Xama didn't answer.", j.status);
    return j.data;
  }
}
