// An in-memory stand-in for the parts of Microsoft Graph the app uses. It powers
// demo builds and the tests, so the app can be exercised without a live tenant.
import { BatchRequest, BatchResponse, Graph, GraphError } from "./graph";

type Item = { id: string; fields: Record<string, unknown> };
type List = { id: string; displayName: string; description?: string; columns: { name: string }[]; items: Item[]; nextItem: number };
type DriveFile = { id: string; name: string; path: string; size: number; at: string; data64?: string };
type FakeMessage = { id: string; subject: string; to: string[]; html: string; attachments: { name: string; size: number }[] };
type FakeEvent = { id: string; subject: string; start: string; end: string; showAs: string; isAllDay: boolean; categories: string[]; props: { id: string; value: string }[] };
type FakeMail = { id: string; folder: string; name: string; address: string; subject: string; body: string; html: boolean; to: { name: string; address: string }[]; at: string; read: boolean; flagged: boolean; attach: boolean };
type State = { lists: List[]; nextList: number; files?: DriveFile[]; events?: FakeEvent[]; nextEvent?: number; messages?: FakeMessage[]; mailbox?: FakeMail[] };

const toB64 = (d: Uint8Array) => {
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

const BUILT_IN = ["Title", "Created", "Modified", "ID"];

export class FakeGraph implements Graph {
  state: State = { lists: [], nextList: 1 };
  calls: { method: string; path: string }[] = [];
  /** Make the next N item writes answer 429, to exercise retries. */
  throttleNext = 0;

  constructor(private persistKey?: string) {
    if (persistKey && typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(persistKey);
      if (saved) this.state = JSON.parse(saved);
    }
  }

  private save(): void {
    if (this.persistKey && typeof localStorage !== "undefined") {
      localStorage.setItem(this.persistKey, JSON.stringify(this.state));
    }
  }

  async get<T = any>(path: string): Promise<T> {
    return this.route("GET", path) as T;
  }
  async post<T = any>(path: string, body: unknown): Promise<T> {
    if (path === "/$batch") return { responses: await this.runBatch((body as any).requests) } as T;
    return this.route("POST", path, body) as T;
  }
  async patch<T = any>(path: string, body: unknown): Promise<T> {
    return this.route("PATCH", path, body) as T;
  }
  async delete(path: string): Promise<void> {
    this.route("DELETE", path);
  }
  /** OneDrive uploads: keeps the name and size (not the bytes), like a drive listing would. */
  async put<T = any>(path: string, data: Uint8Array, _contentType: string): Promise<T> {
    const m = decodeURIComponent(path).match(/^\/me\/drive\/root:\/(.+):\/content$/);
    if (!m) throw new GraphError(400, `FakeGraph doesn't handle PUT ${path}`);
    const full = m[1];
    const name = full.split("/").pop()!;
    const files = (this.state.files ||= []);
    const file: DriveFile = { id: `file-${files.length + 1}`, name, path: full, size: data.byteLength, at: new Date().toISOString() };
    // letters and the letterhead keep their bytes, so they can be opened again
    if (full.startsWith("Practice Planner Letters/") && data.byteLength < 1_500_000) file.data64 = toB64(data);
    if (full.startsWith("Practice Planner Xero/") && data.byteLength < 8_000_000) file.data64 = toB64(data);
    const same = files.findIndex((f) => f.path === full);
    if (same >= 0) files.splice(same, 1, { ...file, id: files[same].id });
    else files.push(file);
    this.lastUpload = data;
    this.save();
    return { id: file.id, name, size: file.size, webUrl: `https://example-my.sharepoint.com/personal/demo/Documents/${encodeURI(full)}` } as T;
  }
  async download(itemPath: string): Promise<Uint8Array> {
    const m = decodeURIComponent(itemPath).match(/^\/me\/drive\/root:\/(.+?)(?::)?$/);
    const f = m && (this.state.files || []).find((x) => x.path === m[1]);
    if (!f || !f.data64) throw new GraphError(404, "Item not found");
    return fromB64(f.data64);
  }
  /** Outlook drafts: kept without attachment bytes. */
  private mail(method: string, path: string, body: any): any {
    const messages = (this.state.messages ||= []);
    if (method === "POST" && path === "/me/messages") {
      const msg: FakeMessage = {
        id: `msg-${messages.length + 1}`, subject: body.subject, html: body.body?.content || "",
        to: (body.toRecipients || []).map((r: any) => r.emailAddress?.address), attachments: [],
      };
      messages.push(msg);
      this.save();
      return { id: msg.id, webLink: `https://outlook.office.com/mail/drafts/id/${msg.id}` };
    }
    const sendM = path.match(/^\/me\/messages\/([^/]+)\/send$/);
    if (method === "POST" && sendM) {
      const i = messages.findIndex((x) => x.id === sendM[1]);
      if (i < 0) throw new GraphError(404, "Message not found");
      messages.splice(i, 1); // a sent draft leaves the drafts
      this.save();
      return {};
    }
    const m = path.match(/^\/me\/messages\/([^/]+)\/attachments$/);
    const msg = m && messages.find((x) => x.id === m[1]);
    if (method === "POST" && msg) {
      msg.attachments.push({ name: body.name, size: Math.round(((body.contentBytes as string) || "").length * 0.75) });
      this.save();
      return { id: `att-${msg.attachments.length}` };
    }
    throw new GraphError(404, "Message not found");
  }
  /**
   * A demo mailbox: an inbox with a mix of client mail, official mail and noise, plus Drafts, Sent
   * Items, an Archive with a sub-folder, Deleted Items and Junk. Flags and read marks are kept.
   */
  private mailbox(): FakeMail[] {
    if (this.state.mailbox) return this.state.mailbox;
    const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
    const me = { name: "Demo User", address: "demo@example.com" };
    const m = (id: string, folder: string, name: string, address: string, subject: string, body: string, hours: number, o: Partial<FakeMail> = {}): FakeMail => ({
      id, folder, name, address, subject, body, html: true, to: [me], at: ago(hours), read: false, flagged: false, attach: false, ...o,
    });
    const out = (id: string, folder: string, to: { name: string; address: string }, subject: string, body: string, hours: number, o: Partial<FakeMail> = {}) =>
      m(id, folder, me.name, me.address, subject, body, hours, { to: [to], read: true, ...o });
    this.state.mailbox = [
      m("in-1", "inbox", "Jo Bright", "jo@brightbakes.example", "VAT return question", "<p>Hi Kevin,</p><p>Can you let me know by Friday whether the van purchase goes through the VAT return?</p><p>Thanks, Jo</p>", 5),
      m("in-2", "inbox", "HMRC", "noreply@hmrc.example", "Your VAT return receipt", "<p>Thank you for submitting your return.</p>", 8),
      m("in-3", "inbox", "Sam Lee", "sam@leeplumbing.example", "Bank statements", "<p>Attached are the statements for September. Please confirm you have them.</p>", 20, { read: true, flagged: true, attach: true }),
      m("in-4", "inbox", "Accounting Weekly", "newsletter@accweekly.example", "This week's newsletter", "<p>Ten tips for your practice.</p>", 30),
      m("in-5", "inbox", "A friend", "pal@mail.example", "Lunch on Thursday?", "<p>Fancy a bite at 1?</p>", 3),
      m("in-6", "inbox", "Priya Nair", "priya@orchardphysio.example", "Payroll changes for November", "<p>Hello,</p><p>Two new starters join on 2 November. Can you add them to payroll?</p><ul><li>A. Clarke</li><li>M. Evans</li></ul>", 26, { attach: true }),
      m("in-7", "inbox", "Jo Bright", "jo@brightbakes.example", "Re: Engagement letter", "<p>Signed and attached, thanks.</p>", 50, { read: true, attach: true }),
      m("in-8", "inbox", "Companies House", "noreply@companieshouse.example", "Confirmation statement reminder", "<p>Your confirmation statement is due soon.</p>", 60, { read: true }),
      m("in-9", "inbox", "Elm Street Software", "sales@elmstreet.example", "Your invoice from Elm Street", "<p>Invoice 2291 is attached.</p>", 90, { read: true, attach: true }),
      m("in-10", "inbox", "Dan Lee", "dan@leeplumbing.example", "Van tax question", "<p>Sam asked me to check: is the van tax deductible?</p>", 100),
      out("dr-1", "drafts", { name: "Jo Bright", address: "jo@brightbakes.example" }, "Year-end accounts: what I need", "<p>Hi Jo, to finish your accounts I need your bank statements and sales summary.</p>", 6),
      out("se-1", "sent", { name: "Jo Bright", address: "jo@brightbakes.example" }, "Re: VAT return question", "<p>Hi Jo, yes, it goes through the return. I'll confirm the figures on Friday.</p>", 52),
      out("se-2", "sent", { name: "Sam Lee", address: "sam@leeplumbing.example" }, "September statements: received", "<p>Thanks Sam, got them.</p>", 70),
      out("se-3", "sent", { name: "A friend", address: "pal@mail.example" }, "Re: Lunch on Thursday?", "<p>Yes, 1 o'clock works.</p>", 120),
      m("ar-1", "archive", "Priya Nair", "priya@orchardphysio.example", "Last quarter's payslips", "<p>Thanks for sending these.</p>", 700, { read: true }),
      m("ar-2", "clients2025", "Jo Bright", "jo@brightbakes.example", "2025 accounts signed", "<p>Signed copy attached.</p>", 5000, { read: true, attach: true }),
      m("de-1", "deleted", "Accounting Weekly", "newsletter@accweekly.example", "Last week's newsletter", "<p>Old news.</p>", 200, { read: true }),
      m("ju-1", "junk", "Prize Team", "win@prizes.example", "You've won!", "<p>Click here.</p>", 40),
      m("rc-1", "receipts", "Cloud Storage", "billing@cloudstore.example", "Receipt for October", "Your receipt is attached.", 300, { read: true, html: false, attach: true }),
    ];
    this.save();
    return this.state.mailbox;
  }
  private static FOLDERS = [
    { id: "inbox", name: "Inbox" }, { id: "drafts", name: "Drafts" }, { id: "sent", name: "Sent Items" }, { id: "archive", name: "Archive", children: [{ id: "clients2025", name: "Clients 2025" }] },
    { id: "deleted", name: "Deleted Items" }, { id: "junk", name: "Junk Email" }, { id: "receipts", name: "Receipts" },
  ];
  private mailFolders(path: string): any {
    const all = this.mailbox();
    const shape = (f: { id: string; name: string; children?: unknown[] }) => ({
      id: `fld-${f.id}`, displayName: f.name, childFolderCount: f.children?.length || 0,
      totalItemCount: all.filter((x) => x.folder === f.id).length, unreadItemCount: all.filter((x) => x.folder === f.id && !x.read).length,
    });
    const kids = path.match(/^\/me\/mailFolders\/fld-([^/]+)\/childFolders$/);
    if (kids) return { value: (FakeGraph.FOLDERS.find((f) => f.id === kids[1])?.children || []).map(shape) };
    return { value: FakeGraph.FOLDERS.map(shape) };
  }
  private mailItem(x: FakeMail): any {
    return {
      id: x.id, subject: x.subject, bodyPreview: x.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), receivedDateTime: x.at, sentDateTime: x.at,
      isRead: x.read, flag: { flagStatus: x.flagged ? "flagged" : "notFlagged" }, hasAttachments: x.attach,
      from: { emailAddress: { name: x.name, address: x.address } }, toRecipients: x.to.map((t) => ({ emailAddress: t })), ccRecipients: [],
      body: { contentType: x.html ? "html" : "text", content: x.body }, webLink: `https://outlook.office.com/mail/${x.folder}/id/${x.id}`,
    };
  }
  /** GET a folder's messages (paged with $top and $skip), and GET or PATCH one message. */
  private mailRoute(method: string, path: string, q: URLSearchParams, body: any): any {
    const all = this.mailbox();
    const folder = path.match(/^\/me\/mailFolders\/(?:fld-)?([^/]+)\/messages$/);
    if (folder && method === "GET") {
      const mine = all.filter((x) => x.folder === folder[1]).sort((a, b) => b.at.localeCompare(a.at));
      const top = Number(q.get("$top")) || 50, skip = Number(q.get("$skip")) || 0;
      const value = mine.slice(skip, skip + top).map((x) => this.mailItem(x));
      const next = skip + top < mine.length ? `/me/mailFolders/fld-${folder[1]}/messages?$top=${top}&$skip=${skip + top}` : undefined;
      return next ? { value, "@odata.nextLink": next } : { value };
    }
    if (method === "GET" && path === "/me/messages" && q.get("$search")) {
      // $search="participants:name@example.com": messages from or to that address
      const want = (/participants:([^"\s]+)/.exec(q.get("$search") || "")?.[1] || "").toLowerCase();
      const mine = all.filter((x) => x.address.toLowerCase() === want || x.to.some((t) => t.address.toLowerCase() === want)).sort((a, b) => b.at.localeCompare(a.at));
      return { value: mine.slice(0, Number(q.get("$top")) || 50).map((x) => ({ ...this.mailItem(x), isDraft: x.folder === "drafts" })) };
    }
    const one = path.match(/^\/me\/messages\/([^/]+)$/);
    const x = one && all.find((y) => y.id === one[1]);
    if (!x) return undefined;
    if (method === "GET") return this.mailItem(x);
    if (method === "PATCH") {
      if (typeof body?.isRead === "boolean") x.read = body.isRead;
      if (body?.flag?.flagStatus) x.flagged = body.flag.flagStatus === "flagged";
      this.save();
      return this.mailItem(x);
    }
    return undefined;
  }
  /** A small Outlook calendar for the demo, with a few meetings in the next fortnight. */
  private calendar(method: string, path: string, q: URLSearchParams, body: any): any {
    if (!this.state.events) {
      const monday = new Date();
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const at = (dayOffset: number, h: number, m = 0) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + dayOffset);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const mk = (subject: string, s: string, e: string, showAs = "busy") =>
        ({ id: `ev-${(this.state.nextEvent = (this.state.nextEvent || 0) + 1)}`, subject, start: s, end: e, showAs, isAllDay: false, categories: [], props: [] });
      this.state.events = [];
      for (const w of [0, 7]) {
        this.state.events.push(
          mk("Client meeting", at(w + 0, 10), at(w + 0, 11, 30)),
          mk("Networking lunch", at(w + 2, 12), at(w + 2, 14)),
          mk("Training", at(w + 3, 9), at(w + 3, 12, 30)),
          mk("Optional webinar", at(w + 4, 15), at(w + 4, 16), "free"),
        );
      }
    }
    const events = this.state.events;
    const out = (e: FakeEvent) => ({
      id: e.id, subject: e.subject, start: { dateTime: e.start.replace("Z", ""), timeZone: "UTC" }, end: { dateTime: e.end.replace("Z", ""), timeZone: "UTC" },
      showAs: e.showAs, isAllDay: e.isAllDay, isCancelled: false, categories: e.categories, singleValueExtendedProperties: e.props,
    });
    const toIso = (t: { dateTime: string; timeZone: string }) => new Date(t.dateTime + (t.timeZone === "UTC" ? "Z" : "")).toISOString();
    if (method === "GET" && path === "/me/calendarView") {
      const from = q.get("startDateTime")!, to = q.get("endDateTime")!;
      return { value: events.filter((e) => e.end > from && e.start < to).map(out) };
    }
    if (method === "POST" && path === "/me/events") {
      const e: FakeEvent = {
        id: `ev-${(this.state.nextEvent = (this.state.nextEvent || 0) + 1)}`, subject: body.subject, start: toIso(body.start), end: toIso(body.end),
        showAs: body.showAs || "busy", isAllDay: false, categories: body.categories || [], props: body.singleValueExtendedProperties || [],
      };
      events.push(e);
      this.save();
      return out(e);
    }
    const m = path.match(/^\/me\/events\/([^/]+)$/);
    const e = m && events.find((x) => x.id === m[1]);
    if (!e) throw new GraphError(404, "Event not found");
    if (method === "PATCH") {
      if (body.subject) e.subject = body.subject;
      if (body.start) e.start = toIso(body.start);
      if (body.end) e.end = toIso(body.end);
      if (body.showAs) e.showAs = body.showAs;
      this.save();
      return out(e);
    }
    if (method === "DELETE") {
      events.splice(events.indexOf(e), 1);
      this.save();
      return undefined;
    }
    throw new GraphError(400, `FakeGraph doesn't handle ${method} ${path}`);
  }

  /** The bytes of the most recent upload (not saved between visits). */
  lastUpload?: Uint8Array;
  async getAll<T = any>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: any = await this.get(next);
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }
  async batch(requests: BatchRequest[], onProgress?: (done: number) => void): Promise<BatchResponse[]> {
    const out: BatchResponse[] = [];
    for (let i = 0; i < requests.length; i += 20) {
      const res = await this.runBatch(requests.slice(i, i + 20).map((r, j) => ({ ...r, id: String(i + j) })));
      out.push(...res.map((r) => ({ status: r.status, body: r.body })));
      onProgress?.(out.length);
    }
    return out;
  }

  private async runBatch(requests: { id: string; method: string; url: string; body?: unknown }[]) {
    if (requests.length > 20) throw new GraphError(400, "A batch can hold at most 20 requests");
    return requests.map((r) => {
      if (r.method === "POST" && r.url.endsWith("/items") && this.throttleNext > 0) {
        this.throttleNext--;
        return { id: r.id, status: 429, headers: { "Retry-After": "0" }, body: { error: { message: "Throttled" } } };
      }
      try {
        return { id: r.id, status: r.method === "POST" ? 201 : 200, body: this.route(r.method, r.url, r.body) };
      } catch (e) {
        const err = e as GraphError;
        return { id: r.id, status: err.status || 500, body: { error: { message: err.message } } };
      }
    });
  }

  private list(id: string): List {
    const l = this.state.lists.find((x) => x.id === id);
    if (!l) throw new GraphError(404, "List not found");
    return l;
  }

  private route(method: string, rawPath: string, body?: any): any {
    const url = new URL(rawPath.replace("https://graph.microsoft.com/v1.0", ""), "https://fake");
    const path = decodeURIComponent(url.pathname);
    const q = url.searchParams;
    this.calls.push({ method, path: rawPath });
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/me") return { displayName: "Demo User", mail: "demo@example.com" };
    if (path.startsWith("/me/calendarView") || path.startsWith("/me/events")) return this.calendar(method, path, q, body);
    if (path.startsWith("/me/mailFolders")) {
      if (method === "GET" && path.endsWith("/messages")) return this.mailRoute(method, path.replace("/inbox/", "/fld-inbox/"), q, body);
      if (method === "GET") return this.mailFolders(path.replace("/fld-fld-", "/fld-"));
    }
    if (path.startsWith("/me/messages")) {
      const done = this.mailRoute(method, path, q, body);
      if (done !== undefined) return done;
      return this.mail(method, path, body);
    }
    if (method === "GET" && (m = path.match(/^\/me\/drive\/root:\/(.+)$/))) {
      const folder = m[1];
      const file = (this.state.files || []).find((f) => f.path === folder);
      if (file) return { id: file.id, name: file.name, size: file.size, webUrl: `https://example-my.sharepoint.com/personal/demo/Documents/${encodeURI(folder)}`, file: {} };
      if (!(this.state.files || []).some((f) => f.path.startsWith(folder + "/"))) throw new GraphError(404, "Item not found");
      return { name: folder, webUrl: `https://example-my.sharepoint.com/personal/demo/Documents/${encodeURI(folder)}`, folder: {} };
    }
    if (method === "GET" && /^\/sites\/[^/]+:\/sites\/[^/]+$/.test(path)) {
      return { id: "site-1", webUrl: "https://example.sharepoint.com/sites/PracticePlanner" };
    }
    if ((m = path.match(/^\/sites\/site-1\/lists$/))) {
      if (method === "GET") return { value: this.state.lists.map((l) => ({ id: l.id, displayName: l.displayName })) };
      if (method === "POST") {
        if (this.state.lists.some((l) => l.displayName === body.displayName)) throw new GraphError(409, "List exists");
        const list: List = {
          id: `list-${this.state.nextList++}`,
          displayName: body.displayName,
          description: body.description,
          columns: [...BUILT_IN.map((name) => ({ name })), ...(body.columns || []).map((c: any) => ({ name: c.name }))],
          items: [],
          nextItem: 1,
        };
        this.state.lists.push(list);
        this.save();
        return { id: list.id, displayName: list.displayName };
      }
    }
    if ((m = path.match(/^\/sites\/site-1\/lists\/([^/]+)\/columns$/))) {
      const list = this.list(m[1]);
      if (method === "GET") return { value: list.columns };
      if (method === "POST") {
        if (list.columns.some((c) => c.name === body.name)) throw new GraphError(409, "Column exists");
        list.columns.push({ name: body.name });
        this.save();
        return { name: body.name };
      }
    }
    if ((m = path.match(/^\/sites\/site-1\/lists\/([^/]+)\/items$/))) {
      const list = this.list(m[1]);
      if (method === "GET") {
        const top = Number(q.get("$top") || 200);
        const skip = Number(q.get("$skiptoken") || 0);
        const page = list.items.slice(skip, skip + top);
        const res: any = { value: page.map((i) => ({ id: i.id, fields: { ...i.fields, id: i.id } })) };
        if (skip + top < list.items.length) {
          const nq = new URLSearchParams(q);
          nq.set("$skiptoken", String(skip + top));
          res["@odata.nextLink"] = `https://graph.microsoft.com/v1.0${path}?${nq}`;
        }
        return res;
      }
      if (method === "POST") {
        const known = new Set(list.columns.map((c) => c.name));
        for (const k of Object.keys(body.fields || {})) {
          if (!known.has(k)) throw new GraphError(400, `Field '${k}' is not recognized`);
        }
        const item: Item = {
          id: String(list.nextItem++),
          fields: { ...body.fields, Modified: new Date().toISOString(), Created: new Date().toISOString() },
        };
        list.items.push(item);
        this.save();
        return { id: item.id, fields: item.fields };
      }
    }
    if ((m = path.match(/^\/sites\/site-1\/lists\/([^/]+)\/items\/([^/]+)$/)) && method === "GET") {
      const list = this.list(m[1]);
      const item = list.items.find((x) => x.id === m![2]);
      if (!item) throw new GraphError(404, "Item not found");
      return { id: item.id, fields: { ...item.fields, id: item.id } };
    }
    if ((m = path.match(/^\/sites\/site-1\/lists\/([^/]+)\/items\/([^/]+)$/)) && method === "DELETE") {
      const list = this.list(m[1]);
      const i = list.items.findIndex((x) => x.id === m![2]);
      if (i < 0) throw new GraphError(404, "Item not found");
      list.items.splice(i, 1);
      this.save();
      return undefined;
    }
    if ((m = path.match(/^\/sites\/site-1\/lists\/([^/]+)\/items\/([^/]+)\/fields$/)) && method === "PATCH") {
      const list = this.list(m[1]);
      const item = list.items.find((i) => i.id === m![2]);
      if (!item) throw new GraphError(404, "Item not found");
      for (const [k, v] of Object.entries(body)) {
        if (v === null) delete item.fields[k];
        else item.fields[k] = v;
      }
      item.fields.Modified = new Date().toISOString();
      this.save();
      return item.fields;
    }
    throw new GraphError(400, `FakeGraph doesn't handle ${method} ${path}`);
  }
}
