// Browser side of the HMRC bridge (api/hmrc). The agent's HMRC sign-in is a sealed copy only the
// server can open; while testing it is kept in the app's settings (HMRC_TOKEN_STORE=sealed).
export class HmrcError extends Error {
  constructor(public code: string, message: string, public retryAfter?: number) { super(message); }
}
export type HmrcStatus = { configured: boolean; env?: "sandbox" | "production"; storeConfigured?: boolean; sealedStore?: boolean; connected?: boolean; arn?: string; since?: string; redirectUri?: string };
export type Invitation = { id: string; status: string; expiresOn: string; created?: string; updated?: string; clientActionUrl: string; note?: string };
export type VatBody = { service: "MTD-VAT"; clientType: string; clientIdType: "vrn"; clientId: string; knownFact: string };
export type SealedStore = { read: () => string | undefined; write: (sealed: string | undefined) => Promise<void> | void };

export class HttpHmrc {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private token: () => Promise<string>, private sealed: SealedStore) {}

  private async post(action: string, body: Record<string, unknown> = {}): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/hmrc/${action}`, { method: "POST", headers: { "X-PP-Token": await this.token(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sealed: this.sealed.read() }) });
    } catch {
      throw new HmrcError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let json: any = null;
    try { json = await res.json(); } catch { /* the bridge isn't deployed */ }
    if (json && typeof json.sealed === "string") await this.sealed.write(json.sealed || undefined);
    if (res.ok && json) return json;
    if (!json || !json.error) throw new HmrcError("no-bridge", "The HMRC connection isn't on the server yet. It arrives when this branch is deployed.");
    if (json.error === "reconnect") await this.sealed.write(undefined);
    throw new HmrcError(json.error, json.message || "HMRC didn't answer. Try again.", json.retryAfter);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async status(): Promise<HmrcStatus> {
    try { return await this.serial(() => this.post("status", { origin: location.origin })); } catch (e) { if (e instanceof HmrcError && e.code === "sign-in") throw e; return { configured: false }; }
  }
  start() { return this.serial(async () => (await this.post("start", { origin: location.origin })).url as string); }
  setArn(arn: string) { return this.serial(async () => void (await this.post("arn", { arn }))); }
  disconnect() { return this.serial(async () => { await this.post("disconnect"); await this.sealed.write(undefined); }); }
  invite(body: VatBody): Promise<Invitation> { return this.serial(() => this.post("invitation", { body })); }
  check(id: string): Promise<Invitation> { return this.serial(() => this.post("invitation/status", { id })); }
  cancel(id: string) { return this.serial(async () => void (await this.post("invitation/cancel", { id }))); }
  relationship(body: VatBody): Promise<boolean> { return this.serial(async () => !!(await this.post("relationship", { body })).active); }
  sandboxAccept(id: string) { return this.serial(async () => void (await this.post("sandbox/accept", { id }))); }
}
