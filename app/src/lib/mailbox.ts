// The Mail screen: your Outlook folders and messages, with the emails from your clients picked out.
// Who counts as a client is the same rule everywhere (see matchClient in emailTasks): their own
// address, a contact linked to them, or a company email domain only one client uses. The planner
// never guesses from a name and never treats a public address like gmail as a company. Reading
// and marking mail uses the Outlook permission the app already asks for (Mail.ReadWrite).
import { Client } from "./domain";
import { Graph } from "./graph";
import { Mail, clientOf, emailsOf, matchClient } from "./emailTasks";
import { Row } from "./schema";

export type MailFolder = { id: string; name: string; total: number; unread: number; depth: number; parentId?: string };

export type MailItem = Mail & {
  /** Who it was sent to (addresses and names), for Sent Items and Drafts. */
  to: string[];
  toNames: string[];
  hasAttachments: boolean;
  folderId: string;
};

const FOLDER_SELECT = "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount";
const MESSAGE_SELECT = "id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,flag,webLink,hasAttachments";
export const PAGE_SIZE = 50;

// Outlook's own folders first, in the order people expect, then the rest alphabetically.
const ORDER = ["inbox", "drafts", "sent items", "archive", "deleted items", "junk email", "outbox", "conversation history"];
const rank = (name: string) => {
  const i = ORDER.indexOf(name.toLowerCase());
  return i < 0 ? ORDER.length : i;
};

export const isInboxName = (name: string) => name.toLowerCase() === "inbox";
/** Folders holding mail you wrote: their messages show who they went to, not who they're from. */
export const isOutgoing = (name: string) => /^(sent( items)?|drafts|outbox)$/i.test(name.trim());

type RawFolder = { id: string; displayName?: string; parentFolderId?: string; childFolderCount?: number; totalItemCount?: number; unreadItemCount?: number };

/** Every folder, with the sub-folders under their parent (down three levels). */
export async function fetchFolders(graph: Graph): Promise<MailFolder[]> {
  const q = `$top=100&$select=${FOLDER_SELECT}`;
  const out: MailFolder[] = [];
  const add = async (raw: RawFolder[], depth: number, parentId?: string) => {
    const sorted = [...raw].sort((a, b) => (depth === 0 ? rank(String(a.displayName || "")) - rank(String(b.displayName || "")) : 0) || String(a.displayName || "").localeCompare(String(b.displayName || "")));
    for (const f of sorted) {
      out.push({ id: f.id, name: String(f.displayName || "Folder"), total: f.totalItemCount || 0, unread: f.unreadItemCount || 0, depth, parentId });
      if ((f.childFolderCount || 0) > 0 && depth < 3) {
        await add(await graph.getAll<RawFolder>(`/me/mailFolders/${encodeURIComponent(f.id)}/childFolders?${q}`), depth + 1, f.id);
      }
    }
  };
  await add(await graph.getAll<RawFolder>(`/me/mailFolders?${q}`), 0);
  return out;
}

const person = (r: any) => ({ address: String(r?.emailAddress?.address || "").toLowerCase(), name: String(r?.emailAddress?.name || r?.emailAddress?.address || "") });

export function toMailItem(m: any, folderId: string): MailItem {
  const to = (m.toRecipients || []).map(person);
  return {
    id: m.id, subject: String(m.subject || "(no subject)"),
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "",
    address: String(m.from?.emailAddress?.address || "").toLowerCase(),
    received: String(m.receivedDateTime || m.sentDateTime || ""),
    preview: String(m.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 300),
    isRead: !!m.isRead, flagged: m.flag?.flagStatus === "flagged", link: m.webLink,
    to: to.map((p: { address: string }) => p.address).filter(Boolean), toNames: to.map((p: { name: string }) => p.name).filter(Boolean),
    hasAttachments: !!m.hasAttachments, folderId,
  };
}

export type Page = { items: MailItem[]; next?: string };

/** One page of a folder, newest first. Pass the previous page's `next` to get the following one. */
export async function fetchPage(graph: Graph, folderId: string, next?: string): Promise<Page> {
  const url = next || `/me/mailFolders/${encodeURIComponent(folderId)}/messages?${new URLSearchParams({ $top: String(PAGE_SIZE), $orderby: "receivedDateTime desc", $select: MESSAGE_SELECT })}`;
  const page = await graph.get<any>(url);
  return { items: (page.value || []).map((m: any) => toMailItem(m, folderId)), next: page["@odata.nextLink"] };
}

export type Body = { html: boolean; content: string; cc: string[] };

export async function fetchBody(graph: Graph, id: string): Promise<Body> {
  const m = await graph.get<any>(`/me/messages/${encodeURIComponent(id)}?$select=body,ccRecipients`);
  return { html: m.body?.contentType === "html", content: String(m.body?.content || ""), cc: (m.ccRecipients || []).map((r: any) => person(r).name).filter(Boolean) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A message body as a small page for a locked-down frame: no scripts, nothing fetched from the
 * internet (so no tracking pictures), links open in a new tab. Plain-text mail is shown as written.
 */
export function bodyDoc(body: Body): string {
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  const head = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{font:14px/1.55 system-ui,sans-serif;margin:14px;color:#1c1c1e;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit;margin:0}a{color:#0a64d8}blockquote{margin:8px 0 8px 4px;padding-left:10px;border-left:3px solid #d1d1d6;color:#555}</style>`;
  return head + (body.html ? body.content : `<pre>${esc(body.content)}</pre>`);
}

// ------------------------------------------------------------------ clients

export type Origin = { clientKey?: string; by?: "address" | "contact" | "domain" };

/**
 * Which client a message belongs to. In your own folders (Sent, Drafts) it is the first
 * recipient who is a client; elsewhere it is the sender.
 */
export function originOf(m: MailItem, outgoing: boolean, clients: Client[], contacts: Row[], links: Row[]): Origin {
  for (const a of outgoing ? m.to : [m.address]) {
    const key = clientOf(a, clients, contacts, links);
    if (!key) continue;
    const c = clients.find((x) => x.Key === key);
    if (c && emailsOf(c.Email).includes(a)) return { clientKey: key, by: "address" };
    const dom = matchClient(a, clients);
    return { clientKey: key, by: dom && dom.by === "domain" && dom.key === key ? "domain" : "contact" };
  }
  return {};
}

export const WHY = { address: "their email address", contact: "a contact linked to them", domain: "their company's email domain" } as const;

export type Filter = "all" | "clients" | "unread" | "flagged";

export function applyFilter(items: MailItem[], origins: Map<string, Origin>, filter: Filter, text: string): MailItem[] {
  const t = text.trim().toLowerCase();
  return items.filter((m) => {
    if (filter === "clients" && !origins.get(m.id)?.clientKey) return false;
    if (filter === "unread" && m.isRead) return false;
    if (filter === "flagged" && !m.flagged) return false;
    return !t || `${m.subject} ${m.from} ${m.address} ${m.preview} ${m.toNames.join(" ")}`.toLowerCase().includes(t);
  });
}

// ------------------------------------------------------------------ changing mail

export async function setRead(graph: Graph, id: string, isRead: boolean): Promise<void> {
  await graph.patch(`/me/messages/${encodeURIComponent(id)}`, { isRead });
}

export async function setFlag(graph: Graph, id: string, flagged: boolean): Promise<void> {
  await graph.patch(`/me/messages/${encodeURIComponent(id)}`, { flag: { flagStatus: flagged ? "flagged" : "notFlagged" } });
}

/** Flag several messages in Outlook at once. Returns the ids that couldn't be flagged. */
export async function flagMany(graph: Graph, ids: string[], flagged = true): Promise<string[]> {
  if (!ids.length) return [];
  const res = await graph.batch(ids.map((id) => ({ method: "PATCH" as const, url: `/me/messages/${encodeURIComponent(id)}`, body: { flag: { flagStatus: flagged ? "flagged" : "notFlagged" } } })));
  return ids.filter((_, i) => !(res[i] && res[i].status >= 200 && res[i].status < 300));
}
