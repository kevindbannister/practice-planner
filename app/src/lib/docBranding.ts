// Practice branding for documents: name, logo, colours, font, addresses, contact details, default
// header, footer and signatory. Several profiles are allowed (a second brand, a trading name).
// Saved in the Settings list under "docs.branding", with a practiceId so that, when the app serves
// more than one practice, each can keep its own set.
import { Row } from "./schema";

export type DocFont = "sans" | "serif" | "mono";
export const FONT_NAMES: Record<DocFont, string> = { sans: "Sans serif (Helvetica)", serif: "Serif (Times)", mono: "Typewriter (Courier)" };

export type CustomField = { key: string; label: string; value: string };
export type Branding = {
  id: string;
  profileName: string;
  practiceName: string;
  tradingName: string;
  logo: string; // PNG or JPEG data, kept small
  primary: string;
  secondary: string;
  font: DocFont;
  registeredAddress: string;
  correspondenceAddress: string;
  phone: string;
  email: string;
  website: string;
  registration: string; // company registration details, e.g. "Registered in England No. 01234567"
  header: string;
  footer: string;
  signatoryName: string;
  signatoryTitle: string;
  customFields: CustomField[];
};
export type BrandingSet = { practiceId: string; defaultId: string; profiles: Branding[] };

export const SETTING_KEY = "docs.branding";

export const DEFAULT_BRANDING: Branding = {
  id: "default", profileName: "Main", practiceName: "", tradingName: "", logo: "", primary: "#1f4e79", secondary: "#2a9d8f", font: "sans",
  registeredAddress: "", correspondenceAddress: "", phone: "", email: "", website: "", registration: "", header: "", footer: "",
  signatoryName: "", signatoryTitle: "", customFields: [],
};

const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const colour = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback);

/** A profile read from saved JSON, with every field checked (a logo must be PNG or JPEG data). */
export function cleanBranding(o: unknown, fallbackId = "default"): Branding {
  const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const logo = text(x.logo, 400000);
  const cf = Array.isArray(x.customFields) ? x.customFields : [];
  return {
    id: text(x.id, 40) || fallbackId,
    profileName: text(x.profileName, 60) || "Main",
    practiceName: text(x.practiceName, 120), tradingName: text(x.tradingName, 120),
    logo: /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(logo) ? logo : "",
    primary: colour(x.primary, DEFAULT_BRANDING.primary), secondary: colour(x.secondary, DEFAULT_BRANDING.secondary),
    font: x.font === "serif" || x.font === "mono" ? x.font : "sans",
    registeredAddress: text(x.registeredAddress), correspondenceAddress: text(x.correspondenceAddress),
    phone: text(x.phone, 40), email: text(x.email, 120), website: text(x.website, 200), registration: text(x.registration, 300),
    header: text(x.header, 500), footer: text(x.footer, 500), signatoryName: text(x.signatoryName, 120), signatoryTitle: text(x.signatoryTitle, 120),
    customFields: cf.filter((c): c is Record<string, unknown> => !!c && typeof c === "object").slice(0, 30).map((c) => ({
      key: text(c.key, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""), label: text(c.label, 80), value: text(c.value, 1000),
    })).filter((c) => c.key),
  };
}

export function readBranding(settings: Row[]): BrandingSet {
  const row = settings.find((s) => s.Key === SETTING_KEY);
  let o: Record<string, unknown> = {};
  try {
    o = row ? JSON.parse(String(row.Value || "{}")) : {};
  } catch {
    o = {};
  }
  const profiles = (Array.isArray(o.profiles) ? o.profiles : []).slice(0, 12).map((p, i) => cleanBranding(p, i ? `p${i}` : "default"));
  const seen = new Set<string>();
  const unique = profiles.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  if (!unique.length) unique.push({ ...DEFAULT_BRANDING });
  const defaultId = unique.some((p) => p.id === o.defaultId) ? String(o.defaultId) : unique[0].id;
  return { practiceId: text(o.practiceId, 40) || "default", defaultId, profiles: unique };
}

export const brandOf = (set: BrandingSet, id?: string): Branding => set.profiles.find((p) => p.id === id) || set.profiles.find((p) => p.id === set.defaultId) || set.profiles[0];

/** The practice's name as it appears on documents: the trading name if there is one. */
export const displayName = (b: Branding) => b.tradingName || b.practiceName;
/** Whether enough has been set up to make a letter that looks like it came from the practice. */
export const brandingGaps = (b: Branding): string[] => [!displayName(b) && "practice name", !b.correspondenceAddress && !b.registeredAddress && "address", !b.signatoryName && "signatory"].filter(Boolean) as string[];
