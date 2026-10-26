// What Companies House publishes about a company, trimmed to what a client may be shown: officers and
// persons with significant control, their roles and dates. Never dates of birth, home or correspondence
// addresses or other personal data, even though some of it is on the public register. Read-only.

const CH_BASE = "https://api.company-information.service.gov.uk";
const NUMBER = /^[a-z0-9]{8}$/i;
const CACHE_MS = 10 * 60 * 1000;

function createCompanies({ key, fetch = globalThis.fetch, now = () => Date.now() }) {
  const cache = new Map();
  const get = async (path) => {
    const res = await fetch(`${CH_BASE}/${path}`, { headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64"), Accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Companies House answered ${res.status}`);
    return res.json();
  };
  const str = (v) => (typeof v === "string" ? v.slice(0, 200) : "");
  return {
    configured: Boolean(key),
    async official(number) {
      const n = String(number || "").trim().toUpperCase();
      if (!key || !NUMBER.test(n)) return null;
      const hit = cache.get(n);
      if (hit && now() - hit.at < CACHE_MS) return hit.data;
      const [profile, officers, pscs] = await Promise.all([get(`company/${n}`), get(`company/${n}/officers?items_per_page=100`), get(`company/${n}/persons-with-significant-control?items_per_page=100`)]);
      if (!profile) return null;
      const a = profile.registered_office_address || {};
      const data = {
        name: str(profile.company_name), number: n, status: str(profile.company_status), type: str(profile.type), incorporated: str(profile.date_of_creation),
        registeredOffice: [a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code].filter((x) => typeof x === "string" && x).join("\n"),
        sic: Array.isArray(profile.sic_codes) ? profile.sic_codes.slice(0, 10).map(str) : [],
        accountsDue: str(profile.accounts?.next_due), confirmationDue: str(profile.confirmation_statement?.next_due), accountingReferenceDate: profile.accounts?.accounting_reference_date ? `${profile.accounts.accounting_reference_date.day}/${profile.accounts.accounting_reference_date.month}` : "",
        officers: (officers?.items || []).filter((o) => !o.resigned_on).map((o) => ({ name: str(o.name), role: str(o.officer_role).replace(/-/g, " "), appointed: str(o.appointed_on) })),
        pscs: (pscs?.items || []).filter((p) => !p.ceased_on && !p.ceased).map((p) => ({ name: str(p.name), kind: str(p.kind).replace(/^.*?-(individual|corporate|legal)-.*$/, "$1"), control: Array.isArray(p.natures_of_control) ? p.natures_of_control.slice(0, 6).map((x) => str(x).replace(/-/g, " ")) : [], notified: str(p.notified_on) })),
      };
      cache.set(n, { at: now(), data });
      return data;
    },
  };
}

module.exports = { createCompanies };
