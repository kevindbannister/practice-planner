// Shared pieces of the Advisory section: money and percentage formatting, a number box that
// doesn't jump while you type, and the hook that keeps a client's Freedom Plan saved.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plan, readPlan, writePlan } from "../lib/advisory";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { useData } from "./data";

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
/** £1,234 (whole pounds, as the workbook shows them). Negative amounts keep their minus sign. */
export const gbp = (n: number): string => GBP.format(Math.round(n) === 0 ? 0 : n);
/** Accountants' brackets: a shortfall shows as £1,234 and an excess as (£1,234). */
export const gbpBr = (n: number): string => (Math.round(n) < 0 ? `(${GBP.format(-n)})` : GBP.format(Math.round(n) === 0 ? 0 : n));
export const pct = (n?: number, digits = 0): string => (n === undefined || !Number.isFinite(n) ? "–" : `${(n * 100).toFixed(digits)}%`);
/** +£200 or −£8, for how far a lever has moved. */
export const signed = (n: number, fmt: (x: number) => string = gbp): string => (Math.round(n * 100) === 0 ? fmt(0) : n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`);

/** A number box. It keeps what you type until you leave it, so a half-typed "1." isn't rewritten under your cursor. */
export function Num({ value, onChange, label, min = 0, max, prefix, suffix, width = 110, className = "" }: {
  value: number; onChange: (n: number) => void; label: string; min?: number; max?: number; prefix?: string; suffix?: string; width?: number; className?: string;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => {
    setText((t) => (Number(t || 0) === value ? t : value ? String(value) : ""));
  }, [value]);
  return (
    <span className={`adv-num ${className}`} style={{ width }}>
      {prefix && <span className="adv-affix" aria-hidden="true">{prefix}</span>}
      <input
        className="input" type="text" inputMode="decimal" aria-label={label} value={text} placeholder="0"
        onChange={(e) => {
          const raw = e.target.value;
          if (!/^-?\d*\.?\d*$/.test(raw)) return;
          setText(raw);
          const n = raw === "" || raw === "-" || raw === "." ? 0 : Number(raw);
          if (Number.isFinite(n)) onChange(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, n)));
        }}
        onBlur={() => setText(value ? String(value) : "")}
      />
      {suffix && <span className="adv-affix" aria-hidden="true">{suffix}</span>}
    </span>
  );
}

export type PlanState = {
  plan: Plan;
  /** Change the plan. It is saved a moment after you stop typing. */
  edit: (change: (p: Plan) => Plan) => void;
  /** idle: nothing to save · saving: waiting or writing · saved · error */
  state: "idle" | "saving" | "saved" | "error";
  error?: string;
  hasRow: boolean;
};

const SAVE_AFTER_MS = 700;

/**
 * One client's Freedom Plan. It is read once when the screen opens and then kept here while you work;
 * changes are saved to SharePoint shortly after you stop typing, and once more if you leave the screen first.
 * A plan the client doesn't have yet is created by the first change.
 */
export function usePlan(clientKey: string): PlanState {
  const { data, create, update, user } = useData();
  const found = data.advisoryPlans.find((r) => r.ClientKey === clientKey && r.Kind === "plan");
  const row = useRef<Row | undefined>(found);
  if (found) row.current = found;
  const [plan, setPlan] = useState<Plan>(() => readPlan(found?.Json));
  const latest = useRef(plan);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<PlanState["state"]>("idle");
  const [error, setError] = useState<string>();

  const write = useCallback(() => {
    // one write at a time, so a first save finishes (and gives us its row) before the next one starts
    writing.current = writing.current.then(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      const json = writePlan(latest.current);
      const now = new Date().toISOString();
      try {
        if (row.current) {
          await update("AdvisoryPlans", row.current, { Json: json, Updated: now, UpdatedBy: user || "" });
        } else {
          row.current = await create("AdvisoryPlans", { Key: newKey("AP"), PracticeId: "", ClientKey: clientKey, Kind: "plan", Json: json, Created: now, Updated: now, UpdatedBy: user || "" });
        }
        setError(undefined);
        setState(dirty.current ? "saving" : "saved");
      } catch (e) {
        dirty.current = true;
        setError(e instanceof Error ? e.message : "The plan couldn't be saved.");
        setState("error");
      }
    });
    return writing.current;
  }, [clientKey, create, update, user]);

  const flush = useRef(write);
  flush.current = write;

  const edit = useCallback((change: (p: Plan) => Plan) => {
    const next = change(latest.current);
    latest.current = next;
    dirty.current = true;
    setPlan(next);
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), SAVE_AFTER_MS);
  }, []);

  // leaving the screen with something unsaved: save it now
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) void flush.current();
    },
    [],
  );

  return { plan, edit, state, error, hasRow: !!found };
}

export function SaveNote({ s }: { s: PlanState }) {
  if (s.state === "error") return <span className="chip red" role="alert">Not saved: {s.error}</span>;
  if (s.state === "saving") return <span className="muted" style={{ fontSize: 13 }}>Saving…</span>;
  if (s.state === "saved") return <span className="muted" style={{ fontSize: 13 }}>Saved</span>;
  return null;
}
