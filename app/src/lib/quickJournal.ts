// The quick journal: a journal keyed in from a panel over any working paper. Pure rules here; the panel is in ui/QuickJournal.tsx.
// After a debit or credit is typed, the first line still left alone takes the balance on the opposite side, until it's changed.

export type QLine = { code: string; account: string; dr: string; cr: string; narrative: string; touched: boolean };
export const blankLine = (): QLine => ({ code: "", account: "", dr: "", cr: "", narrative: "", touched: false });

const r2 = (n: number) => Math.round(n * 100) / 100;
export const amountOf = (s: string): number => {
  const n = Number(String(s || "").replace(/[£,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? r2(n) : 0;
};
export const fmtAmount = (n: number) => (n ? n.toFixed(2) : "");

/** Debits less credits over the lines the person has filled in (not the ones the balance was put on). */
export const imbalance = (lines: QLine[]) => r2(lines.reduce((a, l) => a + amountOf(l.dr) - amountOf(l.cr), 0));

/** Put the balance on the first untouched line (and clear the other untouched ones). */
export function rebalance(lines: QLine[]): QLine[] {
  const diff = r2(lines.filter((l) => l.touched).reduce((a, l) => a + amountOf(l.dr) - amountOf(l.cr), 0));
  let placed = false;
  return lines.map((l) => {
    if (l.touched) return l;
    if (!placed && diff) {
      placed = true;
      return { ...l, dr: diff < 0 ? fmtAmount(-diff) : "", cr: diff > 0 ? fmtAmount(diff) : "" };
    }
    return { ...l, dr: "", cr: "" };
  });
}

/** An amount was typed on a line: it counts as the person's, and the balance moves to the next line left alone. */
export function setAmount(lines: QLine[], i: number, side: "dr" | "cr", value: string): QLine[] {
  const next = lines.map((l, k) => {
    if (k !== i) return l;
    const typed = amountOf(value) !== 0 || value.trim() !== "";
    return { ...l, [side]: value, ...(side === "dr" ? { cr: amountOf(value) ? "" : l.cr } : { dr: amountOf(value) ? "" : l.dr }), touched: typed ? true : l.touched };
  });
  return rebalance(next);
}

export type QCheck = { ok: boolean; message?: string };
export function checkJournal(lines: QLine[]): QCheck {
  const used = lines.filter((l) => amountOf(l.dr) || amountOf(l.cr));
  if (used.length < 2) return { ok: false, message: "A journal needs at least two lines with an amount." };
  if (used.some((l) => !(l.account.trim() || l.code.trim()))) return { ok: false, message: "Every line with an amount needs a code or an account." };
  const d = imbalance(used);
  if (d) return { ok: false, message: `The journal is out by ${Math.abs(d).toFixed(2)}.` };
  return { ok: true };
}

/** The lines as saved in the Journals schedule. */
export function toPaperLines(lines: QLine[], no: number, narrative?: string) {
  return lines.filter((l) => amountOf(l.dr) || amountOf(l.cr)).map((l) => ({
    Code: l.code.trim() || undefined, Detail: l.account.trim() || undefined, Remark: l.narrative.trim() || narrative || undefined,
    f: { no, ...(amountOf(l.dr) ? { dr: amountOf(l.dr) } : {}), ...(amountOf(l.cr) ? { cr: amountOf(l.cr) } : {}) },
  }));
}
