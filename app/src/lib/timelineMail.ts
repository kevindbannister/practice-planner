// Reads a client's mail from Outlook for the timeline. It searches by the client's own addresses
// (never by name), keeps only what the timeline shows (subject, a short preview, who, when, a link,
// whether there are attachments) and never the message body.
import { Graph } from "./graph";
import { MailMsg } from "./timeline";

type Raw = {
  id: string; subject?: string; bodyPreview?: string; receivedDateTime?: string; sentDateTime?: string; isDraft?: boolean; hasAttachments?: boolean; webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } }; toRecipients?: { emailAddress?: { address?: string } }[];
};
const SELECT = "id,subject,bodyPreview,receivedDateTime,sentDateTime,isDraft,hasAttachments,webLink,from,toRecipients";

export const MAX_ADDRESSES = 6;

/** Messages to or from any of these addresses, newest first (up to about 50 for each address). */
export async function fetchClientMail(graph: Graph, addresses: string[]): Promise<MailMsg[]> {
  const mine = new Set(addresses.map((a) => a.toLowerCase()));
  const byId = new Map<string, MailMsg>();
  for (const addr of addresses.slice(0, MAX_ADDRESSES)) {
    const res = await graph.get<{ value?: Raw[] }>(`/me/messages?$search=${encodeURIComponent(`"participants:${addr}"`)}&$top=50&$select=${SELECT}`);
    for (const r of res.value || []) {
      if (!r.id || byId.has(r.id)) continue;
      const from = (r.from?.emailAddress?.address || "").toLowerCase();
      byId.set(r.id, {
        id: r.id, subject: r.subject || "", preview: (r.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 200), at: r.receivedDateTime || r.sentDateTime || "",
        folder: r.isDraft ? "draft" : mine.has(from) ? "inbox" : "sent", fromName: r.from?.emailAddress?.name || "", fromAddress: from,
        to: (r.toRecipients || []).map((t) => (t.emailAddress?.address || "").toLowerCase()).filter(Boolean), webLink: r.webLink, hasAttachments: !!r.hasAttachments,
      });
    }
  }
  return [...byId.values()].filter((m) => m.at).sort((a, b) => b.at.localeCompare(a.at));
}
