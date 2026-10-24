// Shared by letters and emails, meetings and payment reminders: the AI client, your sign-off
// settings, Outlook drafts, the communications tabs.
import { useMemo } from "react";
import { getAccessToken, hasExtraScope } from "../lib/auth";
import { AiApi, FakeAi, HttpAi } from "../lib/ai";
import { CommsPrefs, readCommsPrefs } from "../lib/comms";
import { Graph } from "../lib/graph";
import { toHtml } from "../lib/richText";
import { useData } from "./data";

declare const __DEMO__: boolean;

export const MAIL_SCOPE = "Mail.ReadWrite";
export const isDemo = () => typeof __DEMO__ !== "undefined" && __DEMO__;
export const mailAllowed = () => isDemo() || hasExtraScope(MAIL_SCOPE);

let aiApi: AiApi | null = null;
export function useAi(): AiApi {
  if (!aiApi) aiApi = isDemo() ? new FakeAi() : new HttpAi(getAccessToken);
  return aiApi;
}

export function useCommsPrefs(): CommsPrefs {
  const { data } = useData();
  return useMemo(() => readCommsPrefs(data.settings), [data.settings]);
}

export function downloadFile(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Puts an email in your Outlook drafts. Body is the planner's plain text (paragraphs, "- " bullets, **bold**). */
export async function outlookDraft(graph: Graph, o: { to: string; subject: string; body: string; signature?: string }): Promise<{ id: string; webLink?: string }> {
  return graph.post<{ id: string; webLink?: string }>("/me/messages", {
    subject: o.subject,
    body: { contentType: "HTML", content: toHtml(o.body, o.signature || "") },
    toRecipients: o.to.split(/[;,]\s*/).filter(Boolean).map((address) => ({ emailAddress: { address: address.trim() } })),
  });
}

export function CommsTabs({ current }: { current: "letters" | "meetings" | "payments" | "mail" | "documents" }) {
  return (
    <nav className="subtabs" aria-label="Communication">
      <a href="#/comms" aria-current={current === "letters" ? "page" : undefined}>Letters and emails</a>
      <a href="#/comms/documents" aria-current={current === "documents" ? "page" : undefined}>Documents</a>
      <a href="#/comms/mail" aria-current={current === "mail" ? "page" : undefined}>Mail</a>
      <a href="#/comms/meetings" aria-current={current === "meetings" ? "page" : undefined}>Meetings and calls</a>
      <a href="#/comms/payments" aria-current={current === "payments" ? "page" : undefined}>
        Payment reminders
      </a>
    </nav>
  );
}
