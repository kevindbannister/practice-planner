// The link from a client to their page in Iris Elements. It lives on the client, so every job
// for that client shows the same link. The import matches an Elements client list (Name, Elements
// Link) to your clients by name; nothing here ever leaves the browser except the save to SharePoint.
import { Client } from "./domain";

/** The link, if it's a safe web address (https only). */
export function elementsUrl(c?: object | null): string | undefined {
  const v = String((c as { ElementsLink?: unknown } | null | undefined)?.ElementsLink ?? "").trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : undefined;
}

/** Parse a CSV with quoted fields into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const TITLES = new Set(["mr", "mrs", "miss", "ms", "mx", "dr", "sir", "lady", "lord"]);
const words = (name: string) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/\blimited\b/g, "ltd").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
/** Same name whatever the case, punctuation, Mr/Mrs, "Ltd" or "Limited". */
export const nameKey = (name: string) => words(name).filter((w, i) => !(i === 0 && TITLES.has(w))).join("");
/** First and last name only, for people ("Max Frank Campbell" is "Max Campbell"). */
const personKey = (name: string) => {
  const w = words(name).filter((x, i) => !(i === 0 && TITLES.has(x)));
  return w.length >= 2 ? `${w[0]} ${w[w.length - 1]}` : "";
};

export type ElementsRow = { name: string; link: string };
export type ElementsMatch = {
  row: ElementsRow;
  clientKey: string; // "" = not matched
  how: "name" | "person" | "none";
  note?: string;
};

export function readElementsCsv(text: string): { rows: ElementsRow[]; error?: string } {
  const cells = parseCsv(text);
  if (!cells.length) return { rows: [], error: "That file is empty." };
  const head = cells[0].map((h) => h.trim().toLowerCase());
  const n = head.indexOf("name"), l = head.findIndex((h) => h.includes("link") || h.includes("url"));
  if (n < 0 || l < 0) return { rows: [], error: "I couldn't find the Name and Elements Link columns." };
  const rows = cells.slice(1).map((r) => ({ name: (r[n] || "").trim(), link: (r[l] || "").trim() })).filter((r) => r.name && r.link);
  return { rows };
}

/** Match each Elements client to one of yours. A client is only matched once; the second row for it is flagged. */
export function matchElements(rows: ElementsRow[], clients: Client[]): ElementsMatch[] {
  const byName = new Map<string, Client[]>();
  const byPerson = new Map<string, Client[]>();
  for (const c of clients) {
    const k = nameKey(c.Title);
    byName.set(k, [...(byName.get(k) || []), c]);
    if (c.Kind === "Individual") {
      const p = personKey(c.Title);
      if (p) byPerson.set(p, [...(byPerson.get(p) || []), c]);
    }
  }
  const taken = new Map<string, string>(); // client key -> Elements name that took it
  const linkSeen = new Map<string, string>();
  return rows.map((row) => {
    let c: Client | undefined, how: ElementsMatch["how"] = "none";
    const exact = byName.get(nameKey(row.name)) || [];
    if (exact.length === 1) { c = exact[0]; how = "name"; }
    else if (!exact.length) {
      const p = byPerson.get(personKey(row.name)) || [];
      if (p.length === 1 && words(row.name).filter((w) => !TITLES.has(w)).length <= 5) { c = p[0]; how = "person"; }
    }
    const notes: string[] = [];
    if (c && taken.has(c.Key)) {
      notes.push(`"${taken.get(c.Key)}" already matched ${c.Title}`);
      c = undefined; how = "none";
    } else if (c) taken.set(c.Key, row.name);
    const dup = linkSeen.get(row.link);
    if (dup) notes.push(`Same link as ${dup}`);
    else linkSeen.set(row.link, row.name);
    if (c && String(c.ElementsLink || "") === row.link) notes.push("Already saved");
    else if (c && c.ElementsLink) notes.push("Replaces the saved link");
    return { row, clientKey: c?.Key || "", how, note: notes.join(" · ") || undefined };
  });
}
