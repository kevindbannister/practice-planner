// Talking to Adfin through the app's own bridge (/api/adfin, which holds Adfin's client secret and the sealed sign-in).
// The browser never sees a token. Adfin rotates its refresh token on every renewal, so a renewed sealed sign-in is saved
// before the next call, and calls go one at a time.
import { SealedStore } from "./xero";

export type AdfinStatus = { configured: boolean; environment: "staging" | "production"; redirectUri?: string };
export class AdfinError extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); }
}

export type AdfinMandate = { id: string; status: string; statusReasonCode?: string; statusReason?: string; url?: string; authorisationTime?: string; bankAccountNumber?: string };
export type AdfinPerson = { id?: string; name?: string; email?: string };
export type AdfinCustomer = { id: string; name: string; externalId?: string; people?: AdfinPerson[]; directDebitMandate?: AdfinMandate | null; status?: string };
export type AdfinSchedule = { id: string; recurringInvoiceNo?: string; status: string; nextIssueDate?: string; amount?: number; cadence?: { timeUnit: string; frequency: number; startDate: string }; invoiceDetails?: { customer?: { id: string }; items?: { unitAmount: number; taxRate?: number }[] } };

export interface AdfinApi {
  status(): Promise<AdfinStatus>;
  /** The Adfin sign-in page to send the browser to. */
  start(): Promise<string>;
  connected(): boolean;
  call<T = any>(method: "GET" | "POST" | "PUT", path: string, o?: { query?: Record<string, string | number | boolean | undefined>; body?: unknown }): Promise<T>;
  /** Renew the connection so it doesn't lapse (the refresh token expires after 5 days unused). */
  keepAlive(): Promise<void>;
  disconnect(): Promise<void>;
}

export class HttpAdfin implements AdfinApi {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private token: () => Promise<string>, private sealed: SealedStore) {}

  private async post(action: string, body: Record<string, unknown> = {}): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/adfin/${action}`, { method: "POST", headers: { "X-PP-Token": await this.token(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new AdfinError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let json: any = null;
    try { json = await res.json(); } catch { /* not JSON: the bridge isn't deployed yet */ }
    // a renewed sign-in must be kept before anything else happens: the old one is dead
    if (json && typeof json.sealed === "string") await this.sealed.write(json.sealed);
    if (res.ok && json) return json;
    if (!json || !json.error) throw new AdfinError("no-bridge", "The Adfin connection isn't on the server yet. It arrives with the next deployment.", res.status);
    if (json.error === "reconnect") await this.sealed.write(undefined);
    throw new AdfinError(json.error, json.message || "Adfin didn't answer. Try again.", json.status || res.status);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async status(): Promise<AdfinStatus> {
    try {
      const res = await fetch(`/api/adfin/status?origin=${encodeURIComponent(location.origin)}`, { headers: { Accept: "application/json" } });
      const j = await res.json();
      return { configured: !!j.configured, environment: j.environment === "production" ? "production" : "staging", redirectUri: j.redirectUri };
    } catch {
      return { configured: false, environment: "staging" };
    }
  }
  async start(): Promise<string> { return (await this.post("start", { origin: location.origin })).url; }
  connected() { return !!this.sealed.read(); }
  call<T>(method: "GET" | "POST" | "PUT", path: string, o: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}): Promise<T> {
    return this.serial(async () => {
      const s = this.sealed.read();
      if (!s) throw new AdfinError("reconnect", "Connect to Adfin first (Settings › Adfin).");
      const r = await this.post("call", { sealed: s, method, path, query: o.query, body: o.body });
      return r.data as T;
    });
  }
  keepAlive() {
    return this.serial(async () => {
      const s = this.sealed.read();
      if (s) await this.post("refresh", { sealed: s });
    });
  }
  disconnect() {
    return this.serial(async () => {
      const s = this.sealed.read();
      if (s) await this.post("disconnect", { sealed: s });
      await this.sealed.write(undefined);
    });
  }
}

/**
 * A stand-in for Adfin in the DEMO build only, so the screens can be tried without an Adfin account. It keeps a few invented
 * customers and the schedules made against them in memory. Nothing is sent anywhere. The real build never uses it.
 */
export class FakeAdfin implements AdfinApi {
  private customers: AdfinCustomer[] = [
    { id: "00000000-0000-4000-8000-0000000000c1", name: "A.D. Bannister Roofing & Building Ltd", people: [{ name: "Alan Bannister", email: "adbannister@me.com" }], directDebitMandate: { id: "m1", status: "ACTIVE", authorisationTime: "2026-09-01T10:00:00.000Z", bankAccountNumber: "****1234" } },
    { id: "00000000-0000-4000-8000-0000000000c2", name: "Demo Customer Without Mandate", people: [{ name: "Sam", email: "sam@example.com" }], directDebitMandate: null },
  ];
  private schedules: AdfinSchedule[] = [];
  private requests: { id: string; status: string; reference?: string; totalAmount?: number; paymentLink: { url: string } }[] = [];
  /** Demo and tests only: the client pays a payment link. */
  pay(id: string) { const r = this.requests.find((x) => x.id === id); if (r) r.status = "PAID"; }
  private n = 0;
  constructor(private store: SealedStore) {}
  async status(): Promise<AdfinStatus> { return { configured: true, environment: "staging", redirectUri: location.origin + "/api/adfin/callback" }; }
  async start() { await this.store.write("demo-connection"); return "#/settings/adfin/connected/demo-connection"; }
  connected() { return !!this.store.read(); }
  async keepAlive() { /* nothing to renew */ }
  async disconnect() { await this.store.write(undefined); }
  async call<T>(method: "GET" | "POST" | "PUT", path: string, o: { query?: Record<string, string | number | boolean | undefined>; body?: any } = {}): Promise<T> {
    const b = o.body as any;
    if (method === "GET" && path === "customers") {
      const q = String(o.query?.searchText || "").toLowerCase();
      const ids = String(o.query?.customerIds || "");
      return { customers: this.customers.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!ids || ids.split(",").includes(c.id))) } as T;
    }
    if (method === "POST" && path === "customers") {
      const c: AdfinCustomer = { id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`, name: b.name, people: b.people || [], directDebitMandate: null };
      this.customers.push(c);
      return c as T;
    }
    if (method === "PUT" && /^customers\/[^/]+\/directdebitmandates$/.test(path)) {
      const c = this.customers.find((x) => path.includes(x.id));
      if (!c) throw new AdfinError("not-found", "Adfin has no record of that.", 404);
      c.directDebitMandate = { id: `m${++this.n}`, status: "CREATED", url: "https://staging.adfin.com/demo-mandate-link" };
      return c.directDebitMandate as T;
    }
    if (method === "POST" && path === "schedules/invoices") {
      const items = b.invoiceDetails.items as { unitAmount: number }[];
      const s: AdfinSchedule = { id: `00000000-0000-4000-9000-${String(++this.n).padStart(12, "0")}`, recurringInvoiceNo: `SCH-${1000 + this.n}`, status: "DRAFT", nextIssueDate: String(b.cadence.startDate).slice(0, 10), amount: items.reduce((a, i) => a + i.unitAmount, 0), cadence: b.cadence, invoiceDetails: b.invoiceDetails };
      this.schedules.push(s);
      return s as T;
    }
    if (method === "POST" && path === "payment_requests") {
      if (!b.customer?.id || !(b.totalAmount > 0)) throw new AdfinError("invalid", "Adfin didn't accept that: a customer and a total are needed.", 422);
      const id = `00000000-0000-4000-a000-${String(++this.n).padStart(12, "0")}`;
      const r = { id, status: "UNPAID", reference: b.reference, totalAmount: b.totalAmount, paymentLink: { url: `https://staging.adfin.com/pay/demo-${this.n}` } };
      this.requests.push(r);
      return r as T;
    }
    const pr = /^payment_requests\/([^/]+)$/.exec(path);
    if (pr && method === "GET") {
      const r = this.requests.find((x) => x.id === pr[1]);
      if (!r) throw new AdfinError("not-found", "Adfin has no record of that.", 404);
      return r as T;
    }
    const m = /^schedules\/invoices\/([^/:]+)(?::(activate|cancel))?$/.exec(path);
    if (m) {
      const s = this.schedules.find((x) => x.id === m[1]);
      if (!s) throw new AdfinError("not-found", "Adfin has no record of that.", 404);
      if (method === "GET") return s as T;
      if (m[2] === "activate") { if (s.status !== "DRAFT") throw new AdfinError("invalid", "Only a draft can be started.", 422); s.status = "ACTIVE"; }
      if (m[2] === "cancel") s.status = "CANCELLED";
      return s as T;
    }
    throw new AdfinError("bad-request", "The app isn't allowed to ask Adfin for that.", 400);
  }
}
