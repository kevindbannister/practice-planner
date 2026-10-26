// The public page behind a proposal link. No sign-in: the link's token is the only credential, and it
// is read from the address, never stored. Everything from the server is put on the page as text.
type Run = { t: string; b?: boolean; i?: boolean };
type Block =
  | { type: "p"; runs: Run[] } | { type: "h"; level: 1 | 2 | 3; runs: Run[] }
  | { type: "list"; ordered?: boolean; items: Run[][] } | { type: "table"; header: boolean; rows: { runs: Run[]; align?: string }[][] } | { type: "break" };
type View = { status: "open" | "accepted" | "declined"; practiceName: string; title: string; ref: string; recipientName: string; validUntil: string; blocks?: Block[]; optional?: { id: string; label: string; price: string }[]; consent?: string; answeredAt?: string };

const root = document.getElementById("root") as HTMLElement;
const token = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}
const runs = (rs: Run[]) => rs.map((r) => { const s = el(r.b ? "strong" : "span", {}, r.t); if (r.i) s.style.fontStyle = "italic"; return s; });
const date = (d: string) => { const x = new Date(d + "T00:00:00"); return Number.isNaN(+x) ? d : x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };

function render(blocks: Block[]): HTMLElement {
  const doc = el("div", { class: "doc" });
  for (const b of blocks) {
    if (b.type === "h") doc.append(el(("h" + b.level) as "h1", {}, ...runs(b.runs)));
    else if (b.type === "p") doc.append(el("p", {}, ...runs(b.runs)));
    else if (b.type === "list") doc.append(el(b.ordered ? "ol" : "ul", {}, ...b.items.map((it) => el("li", {}, ...runs(it)))));
    else if (b.type === "break") doc.append(el("hr"));
    else if (b.type === "table") {
      const t = el("table");
      b.rows.forEach((row, i) => {
        const tr = el("tr");
        for (const c of row) { const td = el(b.header && i === 0 ? "th" : "td", {}, ...runs(c.runs)); if (c.align === "right") td.style.textAlign = "right"; tr.append(td); }
        t.append(tr);
      });
      doc.append(el("div", { class: "scroll" }, t));
    }
  }
  return doc;
}

function page(...kids: (Node | string)[]) { root.replaceChildren(el("main", {}, ...kids)); }
function notice(title: string, text: string) { page(el("h1", {}, title), el("p", {}, text)); }

async function load() {
  let res: Response;
  try { res = await fetch(`/api/portal/accept/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" } }); }
  catch { return notice("We couldn't load this", "Please check your internet connection and try again."); }
  let json: any = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !json) return notice(res.status === 410 ? "This link has stopped working" : "We couldn't open this", json?.error || "This link isn't valid. Please contact the practice that sent it.");
  show(json as View);
}

function show(v: View) {
  if (v.status !== "open") {
    return page(el("p", { class: "from" }, v.practiceName), el("h1", {}, v.title),
      el("p", {}, v.status === "accepted" ? "Thank you. This proposal has been accepted." : "This proposal has been declined."),
      el("p", { class: "muted" }, "If this wasn't you, or you'd like to change anything, please contact the practice."));
  }
  const box = el("section", { class: "answer", "aria-label": "Your answer" });
  const msg = el("p", { role: "alert", class: "err" });
  const name = el("input", { type: "text", id: "nm", autocomplete: "name", maxlength: "120" });
  const consent = el("input", { type: "checkbox", id: "cs" });
  const picks = (v.optional || []).map((o) => ({ o, box: el("input", { type: "checkbox" }) }));
  const accept = el("button", { type: "button", class: "primary" }, "Accept this proposal");
  const decline = el("button", { type: "button" }, "Decline");
  const reasonBox = el("textarea", { rows: "3", maxlength: "500", "aria-label": "Reason (optional)" });

  const send = async (decision: "accept" | "decline") => {
    msg.textContent = "";
    accept.disabled = decline.disabled = true;
    try {
      const res = await fetch(`/api/portal/accept/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ decision, name: name.value, consent: consent.checked, optional: picks.filter((p) => p.box.checked).map((p) => p.o.id), reason: reasonBox.value }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { msg.textContent = json?.error || "That didn't go through. Please try again."; accept.disabled = decline.disabled = false; return; }
      page(el("p", { class: "from" }, v.practiceName), el("h1", {}, decision === "accept" ? "Thank you" : "Thank you for letting us know"),
        el("p", {}, decision === "accept" ? "Your acceptance is recorded and we've emailed you a confirmation. We'll be in touch about the next steps: our identity checks and the engagement letter, which are needed before we start work." : "We've recorded your answer. If you change your mind, please contact us."));
    } catch { msg.textContent = "We couldn't reach the server. Please try again."; accept.disabled = decline.disabled = false; }
  };
  accept.addEventListener("click", () => void send("accept"));
  decline.addEventListener("click", () => {
    if (reasonBox.parentElement?.hidden === false) return void send("decline");
    const wrap = reasonBox.parentElement as HTMLElement; wrap.hidden = false; decline.textContent = "Confirm: decline this proposal"; reasonBox.focus();
  });

  box.append(el("h2", {}, "Your answer"));
  if (picks.length) box.append(el("fieldset", {}, el("legend", {}, "Optional services you'd like to add"), ...picks.map((p) => el("label", { class: "check" }, p.box, ` ${p.o.label} (${p.o.price})`))));
  box.append(
    el("label", { for: "nm" }, "Your full name"), name,
    el("label", { class: "check" }, consent, ` ${v.consent || ""}`), msg,
    el("div", { class: "row" }, accept, decline),
    (() => { const w = el("div", { hidden: "" }, el("p", { class: "muted" }, "You don't have to give a reason, but it helps us."), reasonBox); return w; })(),
  );
  page(el("p", { class: "from" }, v.practiceName), el("p", { class: "muted" }, `Prepared for ${v.recipientName} · valid until ${date(v.validUntil)}`), render(v.blocks || []), box);
}

if (!token) notice("This link isn't valid", "Please check the link, or ask the practice to send it again."); else void load();
