// The four steps of a client's Freedom Plan: Freedom Number, Where you are now, Levers, Freedom Gap.
import { DEFAULT_RANGES, LIVING, Lever, Plan, YEARS, change, clampTo, freedomNumber, gap, groupMonthly, livingMonthly, livingYearly, longTerm, positionLevers, positionNow } from "../lib/advisory";
import { Num, gbp, gbpBr, pct, signed } from "./advisoryKit";

type Tab = { plan: Plan; edit: (change: (p: Plan) => Plan) => void };
const yearLabels = Array.from({ length: YEARS }, (_, i) => `Year ${i + 1}`);

// ---- 1. Freedom Number ----

export function FreedomTab({ plan, edit }: Tab) {
  const f = freedomNumber(plan);
  const lt = longTerm(plan);
  const hasLater = f.later.spend > 0;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Day to day living">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Day to day living</h2>
            <p className="muted tip" style={{ margin: "2px 0 0", fontSize: 13 }}>What their life costs each month. Rows left at nothing are ignored.</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong className="mono" style={{ fontSize: 18 }}>{gbp(livingMonthly(plan))}</strong> <span className="muted" style={{ fontSize: 13 }}>a month</span>
            <div className="muted mono" style={{ fontSize: 13 }}>{gbp(livingYearly(plan))} a year</div>
          </div>
        </div>
        <div className="adv-groups">
          {LIVING.map((g) => (
            <details key={g.key} className="adv-group" open>
              <summary>
                <span>{g.title}</span>
                <span className="mono">{gbp(groupMonthly(plan, g))}<span className="muted"> a month</span></span>
              </summary>
              <table className="grid lines">
                <thead><tr><th scope="col">Cost</th><th scope="col" className="num">Monthly</th><th scope="col" className="num">Yearly</th></tr></thead>
                <tbody>
                  {g.items.map((it) => (
                    <tr key={it.key}>
                      <td>
                        {it.other ? (
                          <input className="input cell" aria-label={`Name for ${g.title} ${it.label.toLowerCase()}`} placeholder={it.label} value={plan.names[it.key] ?? ""}
                            onChange={(e) => edit((p) => ({ ...p, names: { ...p.names, [it.key]: e.target.value } }))} />
                        ) : it.label}
                      </td>
                      <td className="num"><Num label={`${g.title}: ${plan.names[it.key] || it.label}, monthly`} prefix="£" width={120} value={plan.living[it.key] || 0} onChange={(n) => edit((p) => ({ ...p, living: { ...p.living, [it.key]: n } }))} /></td>
                      <td className="num mono muted">{gbp((plan.living[it.key] || 0) * 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      </section>

      <section className="card pad stack" aria-label="Long-term planning">
        <div>
          <h2>Long-term planning</h2>
          <p className="muted tip" style={{ margin: "2px 0 0", fontSize: 13 }}>One-off goals, spread evenly over the years they are paid off in. Anything past year five is shown under Later.</p>
        </div>
        <div className="table-wrap">
          <table className="grid lines">
            <thead>
              <tr>
                <th scope="col">Plan</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Over (years)</th>
                {yearLabels.map((y) => <th key={y} scope="col" className="num">{y}</th>)}<th scope="col" className="num">Later</th>
              </tr>
            </thead>
            <tbody>
              {plan.long.map((l, i) => {
                const later = l.amount > 0 && l.years > YEARS ? l.amount - (YEARS * l.amount) / l.years : 0;
                return (
                  <tr key={i}>
                    <td><input className="input cell" aria-label={`Long-term plan ${i + 1} name`} value={l.label} onChange={(e) => edit((p) => ({ ...p, long: p.long.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} /></td>
                    <td className="num"><Num label={`${l.label}: amount`} prefix="£" width={120} value={l.amount} onChange={(n) => edit((p) => ({ ...p, long: p.long.map((x, j) => (j === i ? { ...x, amount: n } : x)) }))} /></td>
                    <td className="num"><Num label={`${l.label}: years`} width={70} min={1} max={60} value={l.years} onChange={(n) => edit((p) => ({ ...p, long: p.long.map((x, j) => (j === i ? { ...x, years: Math.max(1, Math.round(n)) } : x)) }))} /></td>
                    {lt.rows[i].map((v, n) => <td key={n} className="num mono muted">{v ? gbp(v) : "–"}</td>)}
                    <td className="num mono muted">{later ? gbp(later) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="lead-sub"><td>Total</td><td className="num mono">{gbp(lt.total)}</td><td />{lt.years.map((v, n) => <td key={n} className="num mono">{gbp(v)}</td>)}<td className="num mono">{gbp(lt.later)}</td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card pad stack" aria-label="Tax and growth">
        <div>
          <h2>Tax and growth</h2>
          <p className="muted tip" style={{ margin: "2px 0 0", fontSize: 13 }}>
            To take home £1 after personal tax the client needs £1 ÷ (1 − personal rate) of income, and the business must earn £1 ÷ (1 − business rate) of that before its own tax.
            These are effective rates (20% means they keep 80p in the pound). A calculation by tax band and tax year is still to come.
          </p>
        </div>
        <div className="row-wrap" style={{ gap: 20 }}>
          <label className="field"><span className="muted" style={{ fontSize: 12 }}>Personal tax rate</span><Num label="Personal tax rate" suffix="%" max={90} width={110} value={plan.personalTax} onChange={(n) => edit((p) => ({ ...p, personalTax: n }))} /></label>
          <label className="field"><span className="muted" style={{ fontSize: 12 }}>Business tax rate</span><Num label="Business tax rate" suffix="%" max={90} width={110} value={plan.businessTax} onChange={(n) => edit((p) => ({ ...p, businessTax: n }))} /></label>
          <label className="field"><span className="muted" style={{ fontSize: 12 }}>Cost of living rises each year by</span><Num label="Cost of living rise each year" suffix="%" max={50} width={110} value={plan.inflation} onChange={(n) => edit((p) => ({ ...p, inflation: n }))} /></label>
        </div>
      </section>

      <section className="card pad stack" aria-label="Your true Freedom Number">
        <div>
          <h2>Your True Freedom Number</h2>
          <p className="muted tip" style={{ margin: "2px 0 0", fontSize: 13 }}>What the business has to earn, before its own tax, to pay for the life above.</p>
        </div>
        <div className="table-wrap">
          <table className="grid lines">
            <thead>
              <tr><th scope="col"> </th>{yearLabels.map((y) => <th key={y} scope="col" className="num">{y}</th>)}{hasLater && <th scope="col" className="num">Later</th>}<th scope="col" className="num">Total</th></tr>
            </thead>
            <tbody>
              {([
                ["Spending (living and plans)", "spend"],
                ["Personal tax", "personalTax"],
                ["Personal income needed", "personal"],
                ["Business tax", "businessTax"],
              ] as const).map(([label, k]) => (
                <tr key={k}>
                  <th scope="row" style={{ fontWeight: k === "personal" ? 700 : 500 }}>{label}</th>
                  {f.years.map((y, i) => <td key={i} className="num mono">{gbp(y[k])}</td>)}
                  {hasLater && <td className="num mono">{gbp(f.later[k])}</td>}
                  <td className="num mono">{gbp(f.total[k])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="lead-sub">
                <th scope="row">True Freedom Number</th>
                {f.years.map((y, i) => <td key={i} className="num mono">{gbp(y.business)}</td>)}
                {hasLater && <td className="num mono">{gbp(f.later.business)}</td>}
                <td className="num mono">{gbp(f.total.business)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---- 2. Where you are now ----

export function NowTab({ plan, edit }: Tab) {
  const now = positionNow(plan);
  const baseMonthly = plan.base.revenue - plan.base.costs;
  const sumKind = (k: "recurring" | "oneoff") => now.products.filter((p) => p.kind === k).reduce((a, p) => a + p.years[0], 0);
  /** A change to today's number moves the lever with it if the lever was still at the old number. */
  const setNow = (i: number, field: "sales" | "price" | "variable", n: number) =>
    edit((p) => {
      const old = p.products[i][field];
      return {
        ...p,
        products: p.products.map((x, j) => (j === i ? { ...x, [field]: n } : x)),
        levers: p.levers.map((l, j) => (j === i && l[field] === old ? { ...l, [field]: n } : l)),
      };
    });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Current recurring income">
        <div>
          <h2>Current recurring income</h2>
          <p className="muted tip" style={{ margin: "2px 0 0", fontSize: 13 }}>Income the business already has coming in every month, such as retainers and subscriptions. It carries on at the same level in every year.</p>
        </div>
        <div className="row-wrap" style={{ gap: 20, alignItems: "flex-end" }}>
          <label className="field"><span className="muted" style={{ fontSize: 12 }}>Monthly recurring revenue</span><Num label="Monthly recurring revenue" prefix="£" width={140} value={plan.base.revenue} onChange={(n) => edit((p) => ({ ...p, base: { ...p.base, revenue: n } }))} /></label>
          <span className="muted" aria-hidden="true">−</span>
          <label className="field"><span className="muted" style={{ fontSize: 12 }}>Monthly recurring costs</span><Num label="Monthly recurring costs" prefix="£" width={140} value={plan.base.costs} onChange={(n) => edit((p) => ({ ...p, base: { ...p.base, costs: n } }))} /></label>
          <span className="muted" aria-hidden="true">=</span>
          <div className="adv-result"><span className="muted" style={{ fontSize: 12 }}>Monthly recurring profit</span><strong className="mono">{gbp(baseMonthly)}</strong></div>
          <div className="adv-result"><span className="muted" style={{ fontSize: 12 }}>Yearly profit</span><strong className="mono">{gbp(now.base)}</strong></div>
        </div>
      </section>

      <section className="card pad stack" aria-label="Products and services">
        <div>
          <h2>Products and services</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            <strong>Recurring</strong> products keep paying: each month's new sales are still there the next month, so the first year builds up (10 new sales a month is 10 + 20 + … + 120 customer-months, which is 780).
            <strong> One-off</strong> products sell the same each month, every month. Leave unused rows empty.
          </p>
        </div>
        <div className="table-wrap">
          <table className="grid lines">
            <thead>
              <tr>
                <th scope="col">Product or service</th><th scope="col">Type</th><th scope="col" className="num">New sales a month</th><th scope="col" className="num">Average price</th>
                <th scope="col" className="num">Variable cost per sale</th><th scope="col" className="num">Profit per sale</th><th scope="col" className="num">First 12 months</th>
              </tr>
            </thead>
            <tbody>
              {plan.products.map((pr, i) => (
                <tr key={i}>
                  <td><input className="input cell" aria-label={`Product ${i + 1} name`} value={pr.name} onChange={(e) => edit((p) => ({ ...p, products: p.products.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))} /></td>
                  <td>
                    <select className="input cell" aria-label={`${pr.name}: type`} value={pr.kind} onChange={(e) => edit((p) => ({ ...p, products: p.products.map((x, j) => (j === i ? { ...x, kind: e.target.value === "oneoff" ? "oneoff" : "recurring" } : x)) }))}>
                      <option value="recurring">Recurring</option><option value="oneoff">One-off</option>
                    </select>
                  </td>
                  <td className="num"><Num label={`${pr.name}: new sales a month`} width={90} value={pr.sales} onChange={(n) => setNow(i, "sales", n)} /></td>
                  <td className="num"><Num label={`${pr.name}: average price`} prefix="£" width={110} value={pr.price} onChange={(n) => setNow(i, "price", n)} /></td>
                  <td className="num"><Num label={`${pr.name}: variable cost per sale`} prefix="£" width={110} value={pr.variable} onChange={(n) => setNow(i, "variable", n)} /></td>
                  <td className="num mono">{gbp(pr.price - pr.variable)}</td>
                  <td className="num mono">{gbp(now.products[i].years[0])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-wrap" style={{ gap: 10 }}>
          <label className="field"><span className="muted" style={{ fontSize: 12 }}>Recurring customers lost each month</span><Num label="Recurring customers lost each month" suffix="%" max={100} width={110} value={plan.churn} onChange={(n) => edit((p) => ({ ...p, churn: n }))} /></label>
          <span className="muted" style={{ fontSize: 13, maxWidth: 520 }}>Leave at 0% if nobody leaves. At 100% a recurring product behaves like a one-off.</span>
        </div>
      </section>

      <section className="card pad stack" aria-label="Initial 12 months profits">
        <h2>Initial 12 months profits</h2>
        <div className="adv-stats">
          <Stat label="Current recurring" value={gbp(now.base)} />
          <Stat label="Other recurring" value={gbp(sumKind("recurring"))} />
          <Stat label="One-off" value={gbp(sumKind("oneoff"))} />
          <Stat label="Total, first 12 months" value={gbp(now.years[0])} strong />
        </div>
        <div className="table-wrap">
          <table className="grid lines">
            <thead><tr><th scope="col">Profit by year</th>{yearLabels.map((y) => <th key={y} scope="col" className="num">{y}</th>)}</tr></thead>
            <tbody><tr><th scope="row">Business profit at today's numbers</th>{now.years.map((v, i) => <td key={i} className="num mono">{gbp(v)}</td>)}</tr></tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---- 3. Levers ----

const LEVER_FIELDS = [
  { key: "sales", label: "Number of sales a month", unit: "", prefix: "" },
  { key: "price", label: "Average price", unit: "", prefix: "£" },
  { key: "variable", label: "Variable costs per sale", unit: "", prefix: "£" },
] as const;

export function LeversTab({ plan, edit }: Tab) {
  const now = positionNow(plan);
  const lev = positionLevers(plan);
  const moved = plan.levers.some((l, i) => LEVER_FIELDS.some((f) => l[f.key] !== plan.products[i][f.key]));
  const setLever = (i: number, field: keyof Lever, n: number) => edit((p) => ({ ...p, levers: p.levers.map((l, j) => (j === i ? { ...l, [field]: n } : l)) }));
  const setRange = (i: number, field: keyof Lever, part: "min" | "max" | "step", n: number) =>
    edit((p) => ({ ...p, ranges: p.ranges.map((r, j) => (j === i ? { ...r, [field]: { ...r[field], [part]: n } } : r)) }));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad adv-lever-head" aria-label="Levers summary">
        <div>
          <h2>Levers</h2>
          <p className="muted tip" style={{ margin: "2px 0 0", fontSize: 13 }}>Move the sliders to try new numbers of sales, prices and costs. Everything below and the Freedom Gap update as you go. Today's numbers stay as they are on Where you are now.</p>
        </div>
        <div className="adv-stats">
          <Stat label="First 12 months now" value={gbp(now.years[0])} />
          <Stat label="With the levers" value={gbp(lev.years[0])} />
          <Stat label="Difference" value={signed(lev.years[0] - now.years[0])} strong tone={lev.years[0] - now.years[0] >= 0 ? "good" : "bad"} />
        </div>
        <div><button type="button" className="btn small" disabled={!moved} onClick={() => edit((p) => ({ ...p, levers: p.products.map((x) => ({ sales: x.sales, price: x.price, variable: x.variable })) }))}>Back to today's numbers</button></div>
      </section>

      <div className="adv-products">
        {plan.products.map((pr, i) => {
          const l = plan.levers[i];
          const r = plan.ranges[i];
          const idle = !pr.sales && !pr.price && !pr.variable;
          const yearNow = now.products[i].years[0];
          const yearLev = lev.products[i].years[0];
          return (
            <section key={i} className="card pad stack adv-product" aria-label={pr.name}>
              <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3>{pr.name} <span className={`chip ${pr.kind === "recurring" ? "blue" : ""}`}>{pr.kind === "recurring" ? "Recurring" : "One-off"}</span></h3>
                <div style={{ textAlign: "right" }}>
                  <span className="muted" style={{ fontSize: 12 }}>Profit, first 12 months</span>
                  <div><strong className="mono" style={{ fontSize: 18 }}>{gbp(yearLev)}</strong> <span className={`mono ${yearLev - yearNow >= 0 ? "adv-up" : "adv-down"}`} style={{ fontSize: 13 }}>{signed(yearLev - yearNow)}</span></div>
                </div>
              </div>
              {idle && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing set up here yet. Move a slider to try a new idea, or fill it in on Where you are now.</p>}
              {LEVER_FIELDS.map((f) => {
                const cur = pr[f.key];
                const val = l[f.key];
                const rg = r[f.key];
                const c = change(cur, val);
                const hi = Math.max(rg.max, val, cur);
                return (
                  <div key={f.key} className="adv-lever">
                    <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                      <label htmlFor={`lv-${i}-${f.key}`}>{f.label}</label>
                      <Num label={`${pr.name}: ${f.label}`} prefix={f.prefix} width={110} value={val} onChange={(n) => setLever(i, f.key, n)} />
                    </div>
                    <input id={`lv-${i}-${f.key}`} type="range" className="adv-range" min={rg.min} max={hi} step={rg.step} value={val}
                      aria-valuetext={f.prefix ? gbp(val) : String(val)} onChange={(e) => setLever(i, f.key, clampTo(Number(e.target.value), { ...rg, max: hi }))} />
                    <div className="adv-lever-foot">
                      <span className="muted">Now {f.prefix ? gbp(cur) : cur}</span>
                      {c.add !== 0 && <span className={`mono ${(f.key === "variable" ? c.add <= 0 : c.add >= 0) ? "adv-up" : "adv-down"}`}>{signed(c.add, (x) => (f.prefix ? gbp(x) : String(Math.round(x * 100) / 100)))}{c.pct !== undefined ? ` (${signed(c.pct * 100, (x) => `${Math.round(x)}%`)})` : ""}</span>}
                    </div>
                  </div>
                );
              })}
              <div className="adv-profit-line">
                <span>Profit per sale</span>
                <span className="mono"><strong>{gbp(l.price - l.variable)}</strong> <span className="muted">was {gbp(pr.price - pr.variable)}</span></span>
              </div>
              <details className="adv-settings">
                <summary>Slider settings</summary>
                <table className="grid lines">
                  <thead><tr><th scope="col">Slider</th><th scope="col" className="num">Smallest</th><th scope="col" className="num">Largest</th><th scope="col" className="num">Step</th></tr></thead>
                  <tbody>
                    {LEVER_FIELDS.map((f) => (
                      <tr key={f.key}>
                        <td>{f.label}</td>
                        {(["min", "max", "step"] as const).map((part) => (
                          <td key={part} className="num"><Num label={`${pr.name}: ${f.label}, ${part === "min" ? "smallest" : part === "max" ? "largest" : "step"}`} width={90} value={r[f.key][part]} onChange={(n) => setRange(i, f.key, part, part === "step" ? Math.max(0.01, n) : n)} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="linkbtn" onClick={() => edit((p) => ({ ...p, ranges: p.ranges.map((x, j) => (j === i ? { sales: { ...DEFAULT_RANGES.sales }, price: { ...DEFAULT_RANGES.price }, variable: { ...DEFAULT_RANGES.variable } } : x)) }))}>Use the standard settings</button>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---- 4. Freedom Gap ----

export function GapTab({ plan }: { plan: Plan }) {
  const g = gap(plan);
  const none = g.total.need <= 0;
  const top = Math.max(1, ...g.years.flatMap((y) => [y.need, y.now, y.levers]));
  const h = (n: number) => `${Math.max(0, Math.min(100, (Math.max(0, n) / top) * 100))}%`;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {none && (
        <div className="alert amber"><strong>No Freedom Number yet</strong><span>Enter the client's living costs and long-term plans on the Freedom Number step, and the gap appears here.</span></div>
      )}
      <section className="card pad stack" aria-label="Freedom progress">
        <h2>Freedom progress, over five years</h2>
        <Progress label="With the business as it is now" met={g.total.metNow} amount={g.total.now} need={g.total.need} tone="now" />
        <Progress label="With the levers" met={g.total.metLevers} amount={g.total.levers} need={g.total.need} tone="levers" />
        {g.later > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>A further {gbp(g.later)} of long-term plans falls after year five and isn't counted here.</p>}
      </section>

      <section className="card pad stack" aria-label="Year by year">
        <h2>Year by year</h2>
        <div className="adv-chart" role="img" aria-label={`Freedom Number against profit now and with the levers, years 1 to ${YEARS}`}>
          {g.years.map((y, i) => (
            <div key={i} className="adv-chart-year">
              <div className="adv-chart-bars">
                <span className="adv-bar-need" style={{ height: h(y.need) }} title={`Freedom Number ${gbp(y.need)}`} />
                <span className="adv-bar-now" style={{ height: h(y.now) }} title={`Now ${gbp(y.now)}`} />
                <span className="adv-bar-levers" style={{ height: h(y.levers) }} title={`With levers ${gbp(y.levers)}`} />
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{yearLabels[i]}</span>
            </div>
          ))}
        </div>
        <div className="adv-legend"><span><i className="adv-bar-need" /> Freedom Number</span><span><i className="adv-bar-now" /> Business now</span><span><i className="adv-bar-levers" /> With the levers</span></div>
        <div className="table-wrap">
          <table className="grid lines">
            <thead>
              <tr>
                <th scope="col"> </th>{yearLabels.map((y) => <th key={y} scope="col" className="num">{y}</th>)}<th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">True Freedom Number</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{gbp(y.need)}</td>)}</tr>
              <tr className="adv-section-row"><th scope="row" colSpan={YEARS + 2}>With the business as it is now</th></tr>
              <tr><th scope="row">Business profit</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{gbp(y.now)}</td>)}</tr>
              <tr><th scope="row">Target achieved</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{pct(y.metNow)}</td>)}</tr>
              <tr><th scope="row">Shortfall / (excess)</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{gbpBr(y.shortNow)}</td>)}</tr>
              <tr className="adv-section-row"><th scope="row" colSpan={YEARS + 2}>With the levers</th></tr>
              <tr><th scope="row">Business profit</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{gbp(y.levers)}</td>)}</tr>
              <tr><th scope="row">Target achieved</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{pct(y.metLevers)}</td>)}</tr>
              <tr className="lead-sub"><th scope="row">Shortfall / (excess)</th>{[...g.years, g.total].map((y, i) => <td key={i} className="num mono">{gbpBr(y.shortLevers)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Progress({ label, met, amount, need, tone }: { label: string; met?: number; amount: number; need: number; tone: "now" | "levers" }) {
  const w = met === undefined ? 0 : Math.max(0, Math.min(1, met));
  return (
    <div className="adv-progress">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <span>{label}</span>
        <span className="mono"><strong>{pct(met)}</strong> <span className="muted">{gbp(amount)} of {gbp(need)}</span></span>
      </div>
      <div className="adv-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w * 100)}><div className={`adv-fill ${tone}`} style={{ width: `${w * 100}%` }} /></div>
    </div>
  );
}

export function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className="adv-stat">
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <strong className={`mono ${tone === "good" ? "adv-up" : tone === "bad" ? "adv-down" : ""}`} style={{ fontSize: strong ? 20 : 18 }}>{value}</strong>
    </div>
  );
}
