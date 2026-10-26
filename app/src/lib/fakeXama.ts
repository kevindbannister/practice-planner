// Stand-in for the demo build and tests: answers in Xama's formats with invented data.
import { XamaApi, XamaStatus, XamaTest } from "./xama";
import { normName } from "./xamaSync";

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const slug = (s: string) => normName(s).replace(/ /g, "-");

export class FakeXama implements XamaApi {
  calls: string[] = [];
  async status(): Promise<XamaStatus> {
    return { configured: true, missing: [], clientIdEnding: "demo", tokenHost: "auth-proxy.xama.example", apiBase: "https://xamahub.xama.example/api/", authStyle: "json", audience: "https://api.xama.example" };
  }
  async test(path?: string): Promise<XamaTest> {
    const steps: XamaTest["steps"] = [{ name: "Sign in to Xama", ok: true, message: "Xama accepted the client ID and secret. The access token lasts 60 minutes. (Demo)" }];
    if (path) steps.push({ name: `Read ${path}`, ok: true, status: 200, message: "Xama answered (HTTP 200). (Demo)", sample: JSON.stringify({ items: [{ id: "demo-1", name: "The Kent Stove Company Ltd", entity: "XAMA_HUB_ACCOUNT" }] }, null, 2) });
    return { ok: true, steps };
  }
  async get(path: string, query?: Record<string, string | number>): Promise<any> {
    this.calls.push(path);
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
