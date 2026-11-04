// Settings › Detailed P&L: the order the headings show in on the detailed profit and loss account (cost of sales, employee costs,
// premises...), and how the accounts under each heading are ordered (by name, IRIS code or the software's account code).
import { useState } from "react";
import { DETAIL_HEADINGS, DetailOrder, headingOrder } from "../lib/accounts";
import { moveItem } from "../lib/stages";
import { Icon } from "./bits";
import { readSetting, useData } from "./data";

const ITEM_ORDERS: [NonNullable<DetailOrder["items"]>, string][] = [["name", "By IRIS line name"], ["iris", "By IRIS code"]];

export function DetailedPlSettings() {
  const { data, saveSetting } = useData();
  const saved = readSetting<DetailOrder>(data.settings, "detailedPl");
  const order = headingOrder(saved?.groups);
  const items = saved?.items || "name";
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const title = (k: string) => DETAIL_HEADINGS.find((h) => h.key === k)?.title || k;
  const bucket = (k: string) => DETAIL_HEADINGS.find((h) => h.key === k)?.bucket || "";
  const BUCKETS: [string, string][] = [["income", "Turnover"], ["costs", "Cost of sales"], ["expenses", "Administrative expenses"], ["other", "Other income"], ["tax", "Tax"]];

  const write = async (next: DetailOrder) => {
    setState("saving");
    try {
      await saveSetting("detailedPl", next);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  /** Move a heading up or down among those in its own part of the account (the parts keep their place; only the order within one changes). */
  const move = (k: string, dir: -1 | 1) => {
    const same = order.filter((x) => bucket(x) === bucket(k));
    const at = same.indexOf(k), to = at + dir;
    if (to < 0 || to >= same.length) return;
    const swapped = moveItem(same, at, to);
    let n = 0;
    void write({ groups: order.map((x) => (bucket(x) === bucket(k) ? swapped[n++] : x)), items });
  };

  return (
    <section className="card pad stack" aria-labelledby="dpl-h" style={{ maxWidth: 640 }}>
      <h2 id="dpl-h">Detailed profit and loss</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Choose the order the headings show in on the detailed profit and loss account (in the accounts, the client deck and the PDF). The parts of the account
        (turnover, cost of sales, administrative expenses) stay where they are; this orders the headings inside each part.
      </p>
      {BUCKETS.map(([b, label]) => {
        const list = order.filter((k) => bucket(k) === b);
        if (list.length < 2) return null;
        return (
          <div key={b} className="stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>{label}</h3>
            <ol className="dpl-order" style={{ margin: 0, paddingLeft: 20 }}>
              {list.map((k, i) => (
                <li key={k} style={{ padding: "4px 0" }}>
                  <span className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
                    <span style={{ minWidth: 220 }}>{title(k)}</span>
                    <button type="button" className="iconbtn" aria-label={`Move ${title(k)} up`} disabled={i === 0 || state === "saving"} onClick={() => move(k, -1)}><Icon name="up" size={14} /></button>
                    <button type="button" className="iconbtn" aria-label={`Move ${title(k)} down`} disabled={i === list.length - 1 || state === "saving"} onClick={() => move(k, 1)}><Icon name="down" size={14} /></button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      <div className="stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Accounts under each heading</h3>
        <div className="seg" role="group" aria-label="How accounts are ordered under a heading">
          {ITEM_ORDERS.map(([k, label]) => <button key={k} type="button" aria-pressed={items === k} onClick={() => void write({ groups: saved?.groups, items: k })}>{label}</button>)}
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={!saved || state === "saving"} onClick={() => void write({})}>Put back the standard order</button>
        <span className="muted" aria-live="polite" style={{ fontSize: 12 }}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved." : state === "error" ? "That didn't save. Try again." : ""}</span>
      </div>
    </section>
  );
}
