// Stand-in for the demo build and tests: answers in Xama's formats with invented data.
import { XamaApi, XamaStatus, XamaTest } from "./xama";
import { normName } from "./xamaSync";

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const slug = (s: string) => normName(s).replace(/ /g, "-");

export class FakeXama implements XamaApi {
  calls: string[] = [];
  writes: { method: string; path: string; body: any }[] = [];
  private asked = new Set<string>();
  private ran = new Set<string>();
  async status(): Promise<XamaStatus> {
    return { configured: true, missing: [], clientIdEnding: "demo", tokenHost: "auth-proxy.xama.example", apiBase: "https://xamahub.xama.example/api/", authStyle: "json", audience: "https://api.xama.example" };
  }
  async test(path?: string): Promise<XamaTest> {
    const steps: XamaTest["steps"] = [{ name: "Sign in to Xama", ok: true, message: "Xama accepted the client ID and secret. The access token lasts 60 minutes. (Demo)" }];
    if (path) steps.push({ name: `Read ${path}`, ok: true, status: 200, message: "Xama answered (HTTP 200). (Demo)", sample: JSON.stringify({ items: [{ id: "demo-1", name: "The Kent Stove Company Ltd", entity: "XAMA_HUB_ACCOUNT" }] }, null, 2) });
    return { ok: true, steps };
  }
  async write(method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<any> {
    this.writes.push({ method, path, body });
    if (method === "POST" && /^clients\/[^/]+\/accounts$/.test(path)) return { id: "fake-new-" + slug(String(body.name)) };
    const m = /^clients\/[^/]+\/accounts\/([^/]+)\/contacts\/[^/]+\/reports\/(onboarding|aml)$/.exec(path);
    if (method === "PUT" && m) { (m[2] === "aml" ? this.ran : this.asked).add(decodeURIComponent(m[1])); return {}; }
    throw new Error("That isn't one of the things the app is allowed to do in Xama.");
  }
  async get(path: string, query?: Record<string, string | number>): Promise<any> {
    this.calls.push(path);
    if (/\/onboarding-levels$/.test(path)) return { items: [{ id: "lvl-1", name: "Standard ID check", is_default: true }, { id: "lvl-2", name: "Biometric ID check", is_default: false }] };
    if (/\/mail-templates$/.test(path)) return { items: [{ id: "tpl-1", name: "Friendly reminder", is_default: true }] };
    let r = /^clients\/[^/]+\/accounts\/([^/]+)\/contacts$/.exec(path);
    if (r) return { items: [{ id: "con-1", type: "PRIMARY" }] };
    r = /^clients\/[^/]+\/accounts\/([^/]+)\/contacts\/[^/]+\/reports\/(onboarding|aml)$/.exec(path);
    if (r) {
      const id = decodeURIComponent(r[1]);
      if (r[2] === "onboarding") return this.asked.has(id) ? { status: "INITIATED", data: {} } : (() => { throw Object.assign(new Error("Xama couldn't find that (HTTP 404)."), { status: 404 }); })();
      return this.ran.has(id) ? { status: "READY", data: { decision: "PASS", pep_matches: [], sanctions_matches: [] } } : (() => { throw Object.assign(new Error("Xama couldn't find that (HTTP 404)."), { status: 404 }); })();
    }
    const m = /^clients\/([^/]+)\/(search|accounts\/([^/]+)\/risk-assessments)$/.exec(path);
    if (!m) throw new Error("Xama doesn't have that path (HTTP 404).");
    if (m[2] === "search") {
      const name = String(query?.query ?? "");
      const h = hash(normName(name));
      if (h % 5 === 0) return { items: [], page: 1, page_size: 100, result_size: 0 };
      const mk = (n: string, i: string) => ({ id: i, account_id: i, name: n, account_name: n, entity: "XAMA_HUB_ACCOUNT", type: "COMPANY", status: "ACTIVE" });
      if (h % 7 === 1) return { items: [mk(name + " (old)", "fake-a-" + slug(name)), mk(name + " Holdings", "fake-b-" + slug(name)), { id: "c1", entity: "CONTACT", name }], page: 1, page_size: 100, result_size: 3 };
      return { items: [mk(name.replace(/ Limited$/i, " Ltd"), "fake-" + slug(name)), { id: "c2", entity: "CONTACT", name }], page: 1, page_size: 100, result_size: 2 };
    }
    const id = decodeURIComponent(m[3]);
    const k = hash(id) % 4;
    const items =
      k === 0 ? [{ id: "r1", status: "COMPLETED", risk_level: "LOW", completed_at: "2026-06-12" }, { id: "r0", status: "COMPLETED", risk_level: "NORMAL", completed_at: "2024-06-01" }]
      : k === 1 ? [{ id: "r1", status: "COMPLETED", risk_level: "NORMAL", completed_at: "2024-09-03" }]
      : k === 2 ? [{ id: "r1", status: "IN_PROGRESS" }]
      : [];
    return { items, page: 1, page_size: 100, result_size: items.length };
  }
}
