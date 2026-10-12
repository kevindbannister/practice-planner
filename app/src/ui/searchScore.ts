// Scoring for the search box (kept apart from the screen so it can be tested).
const norm = (s: unknown) => String(s ?? "").toLowerCase();

/** How well a record matches every word typed: 3 for a match at the start of the title, 2 in the title, 1 elsewhere. */
export function matchScore(words: string[], title: string, other: string): number {
  if (!words.length) return 0;
  const t = norm(title);
  const o = norm(other);
  let score = 0;
  for (const w of words) {
    if (t.startsWith(w) || t.includes(` ${w}`)) score += 3;
    else if (t.includes(w)) score += 2;
    else if (o.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

