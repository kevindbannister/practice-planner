// The business details a client may ask to change. Each maps to a column of the client's record in
// the planner, or to nothing ("noted" only: staff action it by hand, for example a change of director,
// which has to be filed at Companies House anyway). Anything not on this list can't be proposed.

const EDITABLE = [
  { key: "tradingName", label: "Trading name", column: "TradingName", max: 150 },
  { key: "email", label: "Business email", column: "Email", max: 200, check: "email" },
  { key: "phone", label: "Telephone", column: "Phone", max: 40 },
  { key: "mobile", label: "Mobile", column: "Mobile", max: 40 },
  { key: "website", label: "Website", column: "Website", max: 200 },
  { key: "tradingAddress", label: "Trading address", column: "TradingAddress", max: 400, multiline: true },
  { key: "registeredOffice", label: "Registered office", column: "RegisteredOffice", max: 400, multiline: true, statutory: "Companies House" },
  { key: "businessActivity", label: "What the business does", column: "BusinessActivity", max: 500, multiline: true },
  { key: "directors", label: "Directors or officers", column: null, max: 800, multiline: true, statutory: "Companies House" },
  { key: "other", label: "Something else", column: null, max: 800, multiline: true },
];
const BY_KEY = Object.fromEntries(EDITABLE.map((f) => [f.key, f]));
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Tidy a proposed value: no control characters, trimmed, and checked against the field's rules. Returns { ok, value, error }. */
function cleanValue(field, raw) {
  let v = String(raw ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim();
  if (!field.multiline) v = v.replace(/\s*\n\s*/g, " ");
  if (v.length > field.max) return { ok: false, error: `${field.label} is too long (up to ${field.max} characters)` };
  if (field.check === "email" && v && !EMAIL.test(v)) return { ok: false, error: `${field.label} doesn't look like an email address` };
  return { ok: true, value: v };
}

/** What the browser needs to draw the form: no columns, no internals. */
const meta = () => EDITABLE.map((f) => ({ key: f.key, label: f.label, multiline: Boolean(f.multiline), statutory: f.statutory || "", max: f.max, noted: !f.column }));

/** The columns the portal server is ever allowed to write on a client's record. */
const WRITABLE_COLUMNS = EDITABLE.filter((f) => f.column).map((f) => f.column);

module.exports = { EDITABLE, BY_KEY, cleanValue, meta, WRITABLE_COLUMNS };
