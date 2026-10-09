// Small shared pieces: routing, client badge, deadline chips, icons.
import { CSSProperties, useEffect, useState } from "react";
import { Client, Job, badgeColours, deadlineLabel, initials, jobState, todayIso } from "../lib/domain";

/** The current hash route, split into path parts and query. "#/clients/C1?x=1" -> ["clients","C1"], {x:"1"} */
export function useRoute(): { parts: string[]; query: URLSearchParams } {
  const read = () => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [path, q = ""] = raw.split("?");
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const href = (...parts: string[]) => "#/" + parts.map(encodeURIComponent).join("/");

export function go(path: string): void {
  window.location.hash = path;
}

export function ClientBadge({ client, size }: { client: Client; size?: "lg" }) {
  if (client.LogoUrl) {
    return <img className="logo" src={client.LogoUrl} alt="" />;
  }
  const [bg, fg] = badgeColours(client.Key);
  return (
    <span aria-hidden="true" className={`badge${size ? " " + size : ""}`} style={{ "--b": bg, "--f": fg } as CSSProperties}>
      {initials(client.Title)}
    </span>
  );
}

/** "Tight · 23 days", "12 days late", or the plain day count. */
export function DeadlineChip({ job, today = todayIso() }: { job: Job; today?: string }) {
  const { state, days } = jobState(job, today);
  if (state === "overdue") return <span className="chip red">{deadlineLabel(days)}</span>;
  if (state === "tight") return <span className="chip amber">{deadlineLabel(days)}</span>;
  if (state === "ok") return <span className="muted" style={{ fontSize: 12 }}>{deadlineLabel(days)}</span>;
  return null;
}

export type IconName =
  | "check" | "close" | "search" | "left" | "right" | "alert" | "plan" | "clients" | "groups" | "settings" | "sun" | "moon"
  | "plus" | "grip" | "mail" | "print" | "download";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (name) {
    case "check":
      return <svg {...common}><path d="M3 8.5l3 3 7-7" {...stroke} /></svg>;
    case "close":
      return <svg {...common}><path d="M4 4l8 8M12 4l-8 8" {...stroke} /></svg>;
    case "search":
      return <svg {...common}><circle cx="7" cy="7" r="4.5" {...stroke} /><path d="M10.5 10.5L14 14" {...stroke} /></svg>;
    case "left":
      return <svg {...common}><path d="M10 3L5 8l5 5" {...stroke} /></svg>;
    case "right":
      return <svg {...common}><path d="M6 3l5 5-5 5" {...stroke} /></svg>;
    case "alert":
      return <svg {...common}><path d="M8 2l6.5 11.5h-13L8 2z" {...stroke} /><path d="M8 7v3M8 12v.01" {...stroke} /></svg>;
    case "plan":
      return <svg {...common}><rect x="2" y="3" width="12" height="11" rx="2" {...stroke} /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" {...stroke} /></svg>;
    case "clients":
      return <svg {...common}><circle cx="6" cy="5.5" r="2.5" {...stroke} /><path d="M1.5 14c.4-2.6 2.2-4 4.5-4s4.1 1.4 4.5 4M11 3.2a2.4 2.4 0 010 4.6M12.5 10.3c1.2.5 1.9 1.7 2 3.7" {...stroke} /></svg>;
    case "groups":
      return <svg {...common}><rect x="1.5" y="2" width="5.5" height="5.5" rx="1.5" {...stroke} /><rect x="9" y="2" width="5.5" height="5.5" rx="1.5" {...stroke} /><rect x="5.25" y="9" width="5.5" height="5.5" rx="1.5" {...stroke} /></svg>;
    case "settings":
      return <svg {...common}><circle cx="8" cy="8" r="2.2" {...stroke} /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" {...stroke} /></svg>;
    case "sun":
      return <svg {...common}><circle cx="8" cy="8" r="3" {...stroke} /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" {...stroke} /></svg>;
    case "moon":
      return <svg {...common}><path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z" {...stroke} /></svg>;
    case "mail":
      return <svg {...common}><rect x="1.5" y="3" width="13" height="10" rx="2" {...stroke} /><path d="M2 4.5l6 4.5 6-4.5" {...stroke} /></svg>;
    case "print":
      return <svg {...common}><path d="M4 6V1.5h8V6M4 12H2.5a1 1 0 01-1-1V7a1 1 0 011-1h11a1 1 0 011 1v4a1 1 0 01-1 1H12" {...stroke} /><rect x="4" y="9.5" width="8" height="5" rx="0.5" {...stroke} /></svg>;
    case "download":
      return <svg {...common}><path d="M8 2v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11" {...stroke} /></svg>;
    case "plus":
      return <svg {...common}><path d="M8 3v10M3 8h10" {...stroke} /></svg>;
    case "grip":
      return <svg {...common}><g fill="currentColor"><circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" /><circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" /><circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" /></g></svg>;
  }
}

export function Brand() {
  return (
    <a className="brand" href="#/plan">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="24" height="24" rx="6" style={{ fill: "var(--ink)" }} />
        <path d="M7 9h12M7 13h8M7 17h5" style={{ stroke: "var(--ground)" }} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="brand-name">Practice Planner</span>
    </a>
  );
}

export function companiesHouseUrl(number?: string): string | undefined {
  return number ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(number)}` : undefined;
}

/** The Plan section's heading and its three views. */
export function PlanTabs({ current }: { current: "week" | "months" | "deadlines" }) {
  const tabs: [string, string, string][] = [["week", "Week", "#/plan"], ["months", "Months ahead", "#/plan/months"], ["deadlines", "Deadlines", "#/plan/deadlines"]];
  return (
    <div className="plan-title">
      <h1>Plan</h1>
      <nav className="subtabs" aria-label="Plan views">
        {tabs.map(([k, label, to]) => (
          <a key={k} href={to} aria-current={current === k ? "page" : undefined}>{label}</a>
        ))}
      </nav>
    </div>
  );
}
