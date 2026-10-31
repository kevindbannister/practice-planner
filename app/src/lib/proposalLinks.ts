// What staff see about a proposal's secure links: sent to whom, opened or not, and what is still live.
import type { ProposalLinkInfo } from "./portalAdmin";

const STATUS_TEXT: Record<ProposalLinkInfo["status"], string> = { open: "Waiting for an answer", accepted: "Accepted", declined: "Declined", revoked: "Withdrawn", expired: "Expired" };
export const linkStatus = (l: ProposalLinkInfo) => STATUS_TEXT[l.status] || l.status;

/** "Not opened yet", "Opened once, 2 Nov 14:05" or "Opened 3 times, last 4 Nov 09:12". */
export function openedLine(l: ProposalLinkInfo, when: (iso: string) => string): string {
  const n = l.viewCount ?? (l.viewedAt ? 1 : 0);
  if (!l.viewedAt || n < 1) return "Not opened yet";
  if (n === 1) return `Opened once, ${when(l.viewedAt)}`;
  return `Opened ${n} times, first ${when(l.viewedAt)}, last ${when(l.lastViewedAt || l.viewedAt)}`;
}

/** Links that have gone out for the version being looked at, newest first. */
export const linksForVersion = (links: ProposalLinkInfo[], version: number) => links.filter((l) => l.version === version).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** One line for the top of the page: has anyone opened what was sent? */
export function interest(links: ProposalLinkInfo[]): { opened: boolean; line: string } {
  const live = links.filter((l) => l.status !== "revoked");
  if (!live.length) return { opened: false, line: "" };
  const o = live.filter((l) => (l.viewCount ?? (l.viewedAt ? 1 : 0)) > 0);
  return o.length ? { opened: true, line: "The link has been opened" } : { opened: false, line: "Link sent, not opened yet" };
}
