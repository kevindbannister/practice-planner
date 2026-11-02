// The accounts as a scrollable page in the app: the same pages as the PDF, one after another, with every figure that
// comes from the working papers a link to the paper it comes from. For working on and reviewing the accounts without
// making a PDF each time.
import { Fragment, ReactNode } from "react";
import { Block, Cell, Run } from "../lib/docModel";
import { Section } from "../lib/accounts";

const numeric = (s: string) => /^[-(]?\s*[£$€]?\s*[-(]?\d[\d,]*(\.\d+)?\)?%?$/.test(s.trim()) || s.trim() === "-";
const text = (runs: Run[]) => runs.map((r) => r.t).join("");

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const style = { fontWeight: r.b ? 700 : undefined, fontStyle: r.i ? "italic" : undefined, textDecoration: r.u ? "underline" : undefined, color: r.color, fontSize: r.size ? `${r.size}pt` : undefined } as const;
        return <span key={i} style={style}>{r.t}</span>;
      })}
    </>
  );
}

function CellView({ cell, head }: { cell: Cell; head?: boolean }) {
  const align = cell.align || (numeric(text(cell.runs)) ? "right" : undefined);
  const style = { textAlign: align, borderTop: cell.rule === "top" ? "1px solid currentColor" : undefined, borderBottom: cell.rule === "double" ? "3px double currentColor" : undefined } as const;
  const inner: ReactNode = cell.link ? <a href={cell.link} title="Open the working paper this comes from"><Runs runs={cell.runs} /></a> : <Runs runs={cell.runs} />;
  return head ? <th style={style}>{inner}</th> : <td style={style}>{inner}</td>;
}

export function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "p": return <p style={{ textAlign: b.align }}>{b.runs.length ? <Runs runs={b.runs} /> : " "}</p>;
    case "h": {
      const style = { textAlign: b.align } as const;
      return b.level === 1 ? <h2 style={style}><Runs runs={b.runs} /></h2> : <h3 style={style}><Runs runs={b.runs} /></h3>;
    }
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return <L>{b.items.map((it, i) => <li key={i}><Runs runs={it} /></li>)}</L>;
    }
    case "table": {
      const total = (b.widths || []).reduce((a, x) => a + x, 0) || 1;
      return (
        <table className={`acc-table${b.plain ? " plain" : ""}`}>
          {b.widths && <colgroup>{b.widths.map((w, i) => <col key={i} style={{ width: `${(w / total) * 100}%` }} />)}</colgroup>}
          <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <CellView key={ci} cell={c} head={b.header && ri === 0} />)}</tr>)}</tbody>
        </table>
      );
    }
    case "img": return <img src={b.src} alt="" style={{ width: `${b.width}mm`, maxWidth: "100%" }} />;
    default: return null;
  }
}

/** Every section as a sheet, with a row of jump links above. */
export function AccountsReview({ sections, draft }: { sections: Section[]; draft: boolean }) {
  const jump = (key: string) => document.getElementById(`acc-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!sections.length) return <p className="muted">Nothing is switched on to show. Choose the pages to include under Contents.</p>;
  return (
    <div className="acc-review">
      <nav className="acc-jump" aria-label="Jump to a page of the accounts">
        {sections.map((s) => <button key={s.key} type="button" className="linkbtn" onClick={() => jump(s.key)}>{s.title}</button>)}
      </nav>
      {sections.map((s) => (
        <article key={s.key} id={`acc-${s.key}`} className={`acc-sheet${draft ? " draft" : ""}`} aria-label={s.title}>
          {s.blocks.map((b, i) => <Fragment key={i}><BlockView b={b} /></Fragment>)}
        </article>
      ))}
      <p className="muted" style={{ margin: 0 }}>Figures in blue open the working paper they come from. Use the back button there to return here.</p>
    </div>
  );
}
