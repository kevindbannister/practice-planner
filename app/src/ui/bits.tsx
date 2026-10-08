// Small shared pieces: routing, client badge, deadline chips, icons.
import { useEffect, useState } from "react";
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
    <span aria-hidden="true" className={`badge${size ? " " + size : ""}`} style={{ background: bg, color: fg }}>
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

export function Icon({ name, size = 16 }: { name: "check" | "close" | "search" | "left" | "right" | "alert"; size?: number }) {
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
  }
}

export function Brand() {
  return (
    <a className="brand" href="#/clients">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="24" height="24" rx="6" fill="#17191C" />
        <path d="M7 9h12M7 13h8M7 17h5" stroke="#F4F3EF" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Practice Planner
    </a>
  );
}

export function companiesHouseUrl(number?: string): string | undefined {
  return number ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(number)}` : undefined;
}
