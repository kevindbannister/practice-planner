// Portal branding, per practice. A practice sets its own logo, colours, welcome message, contact
// details, support address and email styling in xproflow; nobody edits source code.
//
// Stored as one settings record per practice (the store is already bound to a practice, so one
// practice can never read or change another's). Everything is checked on the way in: colours must be
// plain #rrggbb, logos must be small PNG/JPEG/WebP/SVG pictures, text is length-limited and only ever
// shown as text. Colour pairs that would be hard to read are refused, not just warned about, so the
// portal can't be published unreadable.

const DEFAULT_COLOURS = {
  primary: "#0f4c81", secondary: "#3b6ea5", accent: "#c2410c", background: "#f4f6f9",
  button: "#0f4c81", buttonInk: "#ffffff", headerBg: "#ffffff", headerInk: "#1b2430",
};
// Fixed by the portal's stylesheet: text colours and the white card surface are not editable.
const FIXED = { text: "#1b2430", muted: "#566271", surface: "#ffffff" };
const COLOUR_LABELS = { primary: "Primary colour", secondary: "Secondary colour", accent: "Accent colour", background: "Page background", button: "Button colour", buttonInk: "Button text", headerBg: "Header background", headerInk: "Header text" };
const TEXT_LIMITS = { practiceName: 80, welcome: 600, phone: 40, address: 300, hours: 120, supportEmail: 120, emailFooter: 300 };
const LOGO_MAX = 60000;

class BrandingError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const LOGO = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

// ---- WCAG contrast
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Black or white, whichever reads better on this colour. */
const inkFor = (hex) => (ratio("#ffffff", hex) >= ratio("#000000", hex) ? "#ffffff" : "#000000");

/** Every pair the portal actually puts together, with the minimum it must reach (WCAG AA). */
function contrastChecks(c) {
  const pair = (id, label, fg, bg, min) => { const r = Math.round(ratio(fg, bg) * 100) / 100; return { id, label, ratio: r, min, pass: r >= min }; };
  return [
    pair("text", "Main text on the page background", FIXED.text, c.background, 4.5),
    pair("muted", "Secondary text on the page background", FIXED.muted, c.background, 4.5),
    pair("link", "Links and headings (primary) on white cards", c.primary, FIXED.surface, 4.5),
    pair("link-bg", "Links (primary) on the page background", c.primary, c.background, 4.5),
    pair("button", "Button text on the button colour", c.buttonInk, c.button, 4.5),
    pair("header", "Header text on the header background", c.headerInk, c.headerBg, 4.5),
    pair("focus", "Keyboard focus outline (accent) on white", c.accent, FIXED.surface, 3),
    pair("focus-bg", "Keyboard focus outline (accent) on the page background", c.accent, c.background, 3),
    pair("secondary", "Secondary colour on white", c.secondary, FIXED.surface, 3),
  ];
}

/** Validate what a person typed. Throws BrandingError with a field-by-field list; returns the clean record. */
function validate(input, { ignoreContrast = false } = {}) {
  const i = input && typeof input === "object" ? input : {};
  const problems = [];
  const colours = {};
  for (const k of Object.keys(DEFAULT_COLOURS)) {
    const v = String(i.colours?.[k] ?? DEFAULT_COLOURS[k]).trim();
    if (!HEX.test(v)) problems.push({ field: k, message: `${COLOUR_LABELS[k]} must be a colour like #0f4c81` });
    colours[k] = v.toLowerCase();
  }
  const out = { colours };
  for (const [k, max] of Object.entries(TEXT_LIMITS)) out[k] = clean(i[k], max);
  if (out.supportEmail && !EMAIL.test(out.supportEmail)) problems.push({ field: "supportEmail", message: "The support email doesn't look like an email address" });
  for (const k of ["logo", "loginLogo"]) {
    const v = String(i[k] ?? "");
    if (v && (!LOGO.test(v) || v.length > LOGO_MAX)) problems.push({ field: k, message: v.length > LOGO_MAX ? "That logo is too large. Use a smaller picture." : "The logo must be a PNG, JPEG, WebP or SVG picture" });
    out[k] = v;
  }
  if (!problems.length && !ignoreContrast) for (const c of contrastChecks(colours)) if (!c.pass) problems.push({ field: "colours", message: `${c.label}: contrast is ${c.ratio}:1 and needs at least ${c.min}:1`, check: c.id });
  if (problems.length) throw new BrandingError(400, "invalid-branding", problems[0].message, problems);
  return out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const linkify = (escaped, colour) => escaped.replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:${colour}">${u}</a>`);

/** The email wrapper: a header in the practice's header colours, the message, and a footer with contact details. */
function emailHtml({ text, branding, inlineLogo = false }) {
  const c = branding.colours;
  const paras = String(text || "").trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.5">${linkify(esc(p), c.primary).replace(/\n/g, "<br>")}</p>`).join("");
  const contact = [branding.address && esc(branding.address).replace(/\n/g, "<br>"), branding.phone && `Tel ${esc(branding.phone)}`, branding.hours && esc(branding.hours), branding.supportEmail && `Questions? <a href="mailto:${esc(branding.supportEmail)}" style="color:${c.primary}">${esc(branding.supportEmail)}</a>`].filter(Boolean).join("<br>");
  return `<!doctype html><html><body style="margin:0;padding:0;background:${c.background}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.background};padding:16px 8px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:${FIXED.text}">`
    + `<tr><td style="background:${c.headerBg};color:${c.headerInk};padding:16px 24px;border-bottom:4px solid ${c.primary}">${inlineLogo ? `<img src="cid:logo" alt="" style="max-height:48px;max-width:240px;display:block;margin-bottom:6px">` : ""}<span style="font-size:20px;font-weight:bold;color:${c.headerInk}">${esc(branding.practiceName)}</span></td></tr>`
    + `<tr><td style="padding:24px">${paras}</td></tr>`
    + `<tr><td style="padding:16px 24px;background:#f4f6f9;color:${FIXED.muted};font-size:13px;line-height:1.5">${branding.emailFooter ? `${esc(branding.emailFooter)}<br><br>` : ""}${contact}</td></tr>`
    + `</table></td></tr></table></body></html>`;
}

function createBranding({ audit, store, now = () => Date.now(), practiceName = "Your accountant" }) {
  let cache = null; // { at, value }
  const defaults = () => ({ colours: { ...DEFAULT_COLOURS }, practiceName, welcome: "", phone: "", address: "", hours: "", supportEmail: "", emailFooter: "", logo: "", loginLogo: "" });

  async function saved() {
    const r = await store.get("settings", "branding");
    return r || null;
  }
  const withDefaults = (r) => {
    const d = defaults();
    if (!r) return d;
    return { ...d, ...Object.fromEntries(Object.entries(r).filter(([k]) => k in d)), colours: { ...d.colours, ...(r.colours || {}) }, practiceName: r.practiceName || d.practiceName };
  };

  /** What's in effect now (saved values over defaults). Cached briefly: it's read on every page load. */
  async function effective() {
    if (cache && now() - cache.at < 30000) return cache.value;
    const value = withDefaults(await saved());
    cache = { at: now(), value };
    return value;
  }
  /** What the sign-in page and portal need: no email footer, nothing else private. */
  const publicView = (b) => ({ practiceName: b.practiceName, logo: b.logo, loginLogo: b.loginLogo || b.logo, colours: b.colours, welcome: b.welcome, contact: { phone: b.phone, address: b.address, hours: b.hours }, supportEmail: b.supportEmail });

  async function overview() {
    const r = await saved();
    const eff = withDefaults(r);
    return { saved: Boolean(r), updatedAt: r?.updatedAt || "", updatedBy: r?.updatedBy || "", branding: eff, defaults: defaults(), checks: contrastChecks(eff.colours) };
  }

  async function save(staff, input) {
    const next = validate(input);
    const cur = await saved();
    const prev = withDefaults(cur);
    const changed = [...Object.keys(TEXT_LIMITS), "logo", "loginLogo"].filter((k) => next[k] !== prev[k]).concat(Object.keys(DEFAULT_COLOURS).filter((k) => next.colours[k] !== prev.colours[k]).map((k) => `colour:${k}`));
    const doc = { ...next, updatedAt: new Date(now()).toISOString(), updatedBy: staff.name };
    if (cur) await store.update("settings", "branding", doc, cur.rev);
    else await store.insert("settings", { id: "branding", ...doc });
    cache = null;
    await audit.record(store, { type: "branding.updated", source: "staff", actor: staff.name, meta: { changed } });
    return overview();
  }

  async function reset(staff) {
    const cur = await saved();
    if (cur) await store.remove("settings", "branding");
    cache = null;
    await audit.record(store, { type: "branding.reset", source: "staff", actor: staff.name });
    return overview();
  }

  /** A draft's email, for the preview. Not saved, not validated for contrast (the preview shows the checks). */
  function previewEmail(input) {
    const b = validate(input, { ignoreContrast: true });
    const raster = /^data:image\/(png|jpeg|webp);base64,/.test(b.logo);
    const html = emailHtml({ text: `Hello Alex,\n\nYou have a new message in your secure portal: https://portal.example/\n\nFor your security the message itself isn't included in this email.`, branding: { ...b, practiceName: b.practiceName || practiceName }, inlineLogo: raster });
    return raster ? html.replace("cid:logo", b.logo) : html; // a real email carries the logo as an attachment; the preview inlines it
  }

  return { effective, publicView, overview, save, reset, previewEmail, defaults };
}

/** Wraps a mailer so every portal email carries the practice's email branding and reply address. */
function brandedMailer(inner, getBranding) {
  return {
    get configured() { return inner.configured; },
    get sent() { return inner.sent; },
    async send(m) {
      if (m.html) return inner.send(m);
      let b = null;
      try { b = await getBranding(); } catch { /* unbranded is better than undelivered */ }
      if (!b) return inner.send(m);
      const logo = /^data:image\/(png|jpeg|webp);base64,/.test(b.logo || "") ? b.logo : "";
      return inner.send({ ...m, html: emailHtml({ text: m.text, branding: b, inlineLogo: Boolean(logo) }), replyTo: b.supportEmail || undefined, inlineLogo: logo || undefined });
    },
  };
}

module.exports = { createBranding, brandedMailer, BrandingError, validate, contrastChecks, emailHtml, ratio, inkFor, DEFAULT_COLOURS, TEXT_LIMITS };
