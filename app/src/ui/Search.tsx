// Search everything: clients, jobs, tasks, letters and emails, meetings. Opens from the top bar
// or with Ctrl+K (⌘K on a Mac). Arrow keys to move, Enter to open, Esc to close.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate } from "../lib/domain";
import { templateFor } from "../lib/meetings";
import { plainText } from "../lib/richText";
import { Icon, IconName, go } from "./bits";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { matchScore } from "./searchScore";

type Hit = { key: string; group: string; icon: IconName; title: string; sub: string; score: number; open: () => void };

const norm = (s: unknown) => String(s ?? "").toLowerCase();

export function SearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" className="iconbtn search-btn" aria-label="Search" title="Search (Ctrl+K)" onClick={() => setOpen(true)}>
        <Icon name="search" />
        <span className="search-btn-text">Search</span>
        <kbd className="search-kbd">Ctrl K</kbd>
      </button>
      {open && createPortal(<SearchDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const { data } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo((): Hit[] => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const client = (k?: unknown) => idx.clientByKey.get(String(k || ""))?.Title || "";
    const out: Hit[] = [];
    const add = (h: Omit<Hit, "score">, other: string) => {
      const score = matchScore(words, h.title, other);
      if (score) out.push({ ...h, score });
    };
    for (const c of data.clients) {
      add({ key: `c-${c.Key}`, group: "Clients", icon: "clients", title: c.Title, sub: [c.Kind, c.CompanyNumber, [c.ContactFirst, c.ContactLast].filter(Boolean).join(" "), c.Email].filter(Boolean).join(" · "),
        open: () => go(`/clients/${encodeURIComponent(c.Key)}`) },
        `${c.CompanyNumber || ""} ${c.ContactFirst || ""} ${c.ContactPreferred || ""} ${c.ContactLast || ""} ${c.Email || ""} ${c.Phone || ""} ${c.Mobile || ""}`);
    }
    for (const j of idx.openJobs) {
      const name = client(j.ClientKey) || String(j.ClientName || "");
      add({ key: `j-${j.Key}`, group: "Jobs", icon: "list", title: `${name}: ${idx.serviceName.get(j.ServiceKey || "") || j.Title}`,
        sub: [j.PeriodEnd ? `period to ${fmtDate(j.PeriodEnd)}` : "", j.Deadline ? `due ${fmtDate(j.Deadline)}` : "", j.StageName].filter(Boolean).join(" · "),
        open: () => open({ kind: "job", key: j.Key }) }, `${j.Title} ${j.CardNote || ""} ${j.Notes || ""}`);
    }
    for (const t of idx.openTasks) {
      add({ key: `t-${t.Key}`, group: "Tasks", icon: "check", title: t.Title, sub: [client(t.ClientKey), t.DueDate ? `due ${fmtDate(t.DueDate)}` : ""].filter(Boolean).join(" · "),
        open: () => open({ kind: "task", key: t.Key }) }, `${client(t.ClientKey)} ${t.Notes || ""}`);
    }
    for (const m of data.comms) {
      add({ key: `m-${m.Key}`, group: "Letters and emails", icon: m.Kind === "email" ? "mail" : "letter", title: String(m.Subject || "(no subject)"),
        sub: [client(m.ClientKey), m.Kind === "email" ? "Email" : "Letter", fmtDate(String(m.Updated || m.Created || "").slice(0, 10))].filter(Boolean).join(" · "),
        open: () => go(`/comms/${encodeURIComponent(String(m.Key))}`) }, `${client(m.ClientKey)} ${plainText(String(m.Body || ""))}`);
    }
    for (const m of data.meetings) {
      const name = client(m.ClientKey);
      add({ key: `g-${m.Key}`, group: "Meetings and calls", icon: "groups", title: `${templateFor(String(m.Template)).name}${name ? `: ${name}` : ""}`,
        sub: fmtDate(String(m.When || "").slice(0, 10), { weekday: true }),
        open: () => go(`/comms/meetings/${encodeURIComponent(String(m.Key))}`) }, `${name} ${m.Summary || ""} ${m.Notes || ""} ${m.Agenda || ""} ${m.Decisions || ""} ${m.Actions || ""}`);
    }
    const order = ["Clients", "Jobs", "Tasks", "Letters and emails", "Meetings and calls"];
    // best matches first within each group, a few per group
    return order.flatMap((g) => out.filter((h) => h.group === g).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, g === "Clients" ? 8 : 6));
  }, [q, data, idx, open]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const choose = (h?: Hit) => {
    if (!h) return;
    onClose();
    h.open();
  };

  return (
    <div className="search-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <label className="search search-big">
          <Icon name="search" />
          <span className="sr-only">Search clients, jobs, tasks, letters and meetings</span>
          <input
            ref={input}
            type="search"
            placeholder="Search clients, jobs, tasks, letters, meetings"
            value={q}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-results"
            aria-activedescendant={hits[at] ? `sr-${at}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(hits.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") choose(hits[at]);
            }}
          />
          <button type="button" className="linkbtn" onClick={onClose} style={{ minHeight: 0 }}>Close</button>
        </label>
        <ul id="search-results" className="search-results" role="listbox" ref={listRef}>
          {hits.map((h, i) => (
            <li key={h.key} role="presentation">
              {(i === 0 || hits[i - 1].group !== h.group) && <div className="search-group" role="presentation">{h.group}</div>}
              <button type="button" id={`sr-${i}`} data-i={i} role="option" aria-selected={i === at} className={`search-hit${i === at ? " on" : ""}`}
                onMouseEnter={() => setAt(i)} onClick={() => choose(h)}>
                <span className="search-icon" aria-hidden="true"><Icon name={h.icon} size={15} /></span>
                <span className="stack" style={{ gap: 1, minWidth: 0 }}>
                  <span className="search-title">{h.title}</span>
                  {h.sub && <span className="search-sub">{h.sub}</span>}
                </span>
              </button>
            </li>
          ))}
          {q.trim() && !hits.length && <li className="muted" style={{ padding: 16 }}>Nothing matches "{q}".</li>}
          {!q.trim() && <li className="muted" style={{ padding: 16, fontSize: 13 }}>Type a client's name, a company number, a contact, or words from a letter or meeting notes.</li>}
        </ul>
      </div>
    </div>
  );
}
