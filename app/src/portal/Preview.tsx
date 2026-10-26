// Branding preview. The staff Branding screen shows this page in a frame and sends it the draft look
// as the person edits. It is the real portal (same components, same stylesheet) fed with made-up data,
// so what they see is what clients will see. It makes no calls to the server and shows no real data.
import { useEffect, useMemo, useState } from "react";
import { Dashboard } from "./Dashboard";
import { Shell } from "./PortalApp";
import type { Ctx } from "./PortalApp";
import { SignInScreen } from "./SignIn";
import type { Config } from "./auth";
import { BLANK, PortalBranding, applyBranding } from "./brand";
import type { PortalClient } from "./api";

type Msg = { type: "px-brand-preview"; branding: PortalBranding; screen: "signin" | "home" };

const sample = {
  business: async () => ({ clientKey: "x", level: "administrator", can: {}, editable: [], details: { companyNumber: "01234567", yearEnd: "03-31", registeredOffice: "1 High Street, Anytown" } }),
  changes: async () => ({ requests: [], editable: [] }),
  documents: async () => ({ documents: [{ id: "1", title: "Accounts for the year ended 31 March", category: "Accounts", status: "published", createdAt: "2026-06-01T09:00:00Z", updatedAt: "2026-06-01T09:00:00Z", from: "practice", needsApproval: false, approval: null, message: "", assigned: false, previewable: true, versions: [], size: 1000, ext: "pdf" }, { id: "2", title: "VAT return, quarter to 30 September", category: "VAT", status: "awaiting-approval", createdAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:00:00Z", from: "practice", needsApproval: true, approval: null, message: "", assigned: false, previewable: true, versions: [], size: 1000, ext: "pdf" }], categories: [], canUpload: true, canApprove: true }),
  signing: async () => ({ requests: [] }),
  identity: async () => ({ items: [] }),
  infoRequests: async () => ({ requests: [{ id: "r", title: "March bank statements", details: "", dueDate: "", status: "open", createdAt: "2026-10-20T09:00:00Z", assigned: false, thread: [], completedAt: "" }], canUpload: true }),
  notices: async () => ({ notices: [{ id: "n", text: "New message from your accountant", link: "messages", at: "2026-10-22T09:00:00Z", read: false }], unread: 1 }),
  readNotices: async () => ({ notices: [], unread: 0 }),
  messages: async () => ({ threads: [], unread: 1 }),
} as unknown as PortalClient;

export function Preview() {
  const [state, setState] = useState<{ branding: PortalBranding; screen: "signin" | "home" }>({ branding: BLANK, screen: "home" });
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as Msg;
      if (d && d.type === "px-brand-preview" && d.branding) setState({ branding: d.branding, screen: d.screen === "signin" ? "signin" : "home" });
    };
    window.addEventListener("message", on);
    window.parent?.postMessage({ type: "px-brand-ready" }, window.location.origin);
    return () => window.removeEventListener("message", on);
  }, []);
  useEffect(() => { applyBranding(state.branding); }, [state.branding]);
  const cfg: Config = useMemo(() => ({ configured: true, clientId: "", authority: "", practiceName: state.branding.practiceName || "Your practice", branding: state.branding }), [state.branding]);
  if (state.screen === "signin") return <div aria-label="Sign-in preview"><SignInScreen cfg={cfg} message="" /></div>;
  const me = { user: { id: "u", name: "Alex Example", email: "alex@example.com", status: "active", mfa: false }, businesses: [], awaitingAccess: false };
  const biz = { clientKey: "x", name: "Example Trading Ltd", level: "administrator", levelLabel: "Administrator", can: { "documents.view": true, "documents.approve": true, "requests.respond": true, "messages.use": true, "business.details": true } };
  const ctx: Ctx = { cfg, api: sample, me, biz, go: () => undefined };
  const nav = ["Home", "Documents", "Messages", "Requests", "My business"].map((l, i) => <a key={l} href="#preview" aria-current={i === 0 ? "page" : undefined} onClick={(e) => e.preventDefault()}>{l}</a>);
  return (
    <Shell cfg={cfg} me={me} out={() => undefined} switcher={<span className="px-bizname">{biz.name}</span>} nav={nav}>
      <main className="px-main"><Dashboard ctx={ctx} /></main>
    </Shell>
  );
}
