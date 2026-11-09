// Calls to the planner's own server for approvals (api/approve) and the morning email (api/digest). Each needs the signed-in
// person's Microsoft sign-in. "unavailable" means the server part isn't set up (or this is the demo build), so the screen can fall back.
import type { SealState } from "./amlSeal";

export type ServerAnswer<T> = { ok: true; data: T } | { ok: false; unavailable: boolean; message: string };

async function post<T>(path: string, token: () => Promise<string>, body: unknown = {}): Promise<ServerAnswer<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "X-PP-Token": await token(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { return { ok: false, unavailable: true, message: "Couldn't reach the app's server." }; }
  let j: any = null;
  try { j = await res.json(); } catch { /* not JSON: the function isn't deployed */ }
  if (!j) return { ok: false, unavailable: true, message: "That part of the server isn't deployed yet." };
  if (res.status === 503 || j.error === "not-configured") return { ok: false, unavailable: true, message: String(j.message || "Not set up on the server yet.") };
  if (!res.ok || j.error) return { ok: false, unavailable: false, message: String(j.message || "The server refused that.") };
  return { ok: true, data: j as T };
}

export const approveOnServer = (key: string, token: () => Promise<string>) => post<{ ok: true; by: string }>("/api/approve/aml", token, { key });
export const verifySeals = (token: () => Promise<string>) => post<{ results: Record<string, SealState> }>("/api/approve/verify", token);
export type DigestPreview = { to: string; name: string; subject: string; count: number; sections: { title: string; items: string[] }[] };
export const previewDigest = (token: () => Promise<string>) => post<{ digests: DigestPreview[] }>("/api/digest/preview", token);
export const testDigest = (token: () => Promise<string>) => post<{ ok: true; to: string; count: number }>("/api/digest/test", token);
