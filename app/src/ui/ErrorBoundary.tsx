// A safety net: if a screen fails to draw, show what happened and a way back, instead of a
// blank page. Problems are noted on this device (Settings › Your week › Problems) so they can
// be reported and fixed.
import React, { ReactNode } from "react";

export type Problem = { at: string; path: string; message: string; stack?: string; where?: string; browser: string };
const KEY = "pp.problems";

export function recordProblem(error: unknown, where?: string): Problem {
  const e = error instanceof Error ? error : new Error(String(error));
  const p: Problem = {
    at: new Date().toISOString(),
    path: window.location.hash || "#/",
    message: e.message || String(error),
    stack: (e.stack || "").split("\n").slice(0, 8).join("\n"),
    where: where ? where.split("\n").filter(Boolean).slice(0, 6).join("\n") : undefined,
    browser: navigator.userAgent,
  };
  try {
    const list: Problem[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.setItem(KEY, JSON.stringify([p, ...list].slice(0, 10)));
  } catch {
    /* nothing to keep it in */
  }
  return p;
}

export function readProblems(): Problem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function clearProblems(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export const problemText = (p: Problem) =>
  [`When: ${new Date(p.at).toLocaleString("en-GB")}`, `Page: ${p.path}`, `Problem: ${p.message}`, p.stack && `Code:\n${p.stack}`, p.where && `Screen:\n${p.where}`, `Browser: ${p.browser}`]
    .filter(Boolean)
    .join("\n");

type Props = { children: ReactNode; resetKey: string; onProblem?: (p: Problem) => void };
type State = { problem?: Problem };

export class PageBoundary extends React.Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(): State {
    return { problem: { at: new Date().toISOString(), path: window.location.hash, message: "", browser: "" } };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const p = recordProblem(error, info.componentStack || undefined);
    this.setState({ problem: p });
    try {
      this.props.onProblem?.(p);
    } catch {
      /* reporting must never cause another problem */
    }
  }

  componentDidUpdate(prev: Props) {
    // going to another screen gives it a fresh start
    if (prev.resetKey !== this.props.resetKey && this.state.problem) this.setState({ problem: undefined });
  }

  render() {
    const p = this.state.problem;
    if (!p) return this.props.children;
    return (
      <div className="center">
        <div className="panel" role="alert">
          <h1>This screen didn't load properly</h1>
          <p style={{ margin: 0 }}>Your data is safe; nothing was lost. Reloading usually sorts it out.</p>
          {p.message && <pre className="problem-text">{p.message}</pre>}
          <div className="row-wrap">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn" href="#/home" onClick={() => this.setState({ problem: undefined })}>Go to Home</a>
            {p.message && (
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(problemText(p)).catch(() => undefined)}>
                Copy details
              </button>
            )}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>It's also noted in Settings › Your week › Problems, so it can be fixed.</p>
        </div>
      </div>
    );
  }
}
