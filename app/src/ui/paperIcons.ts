// An icon for each section of the working papers menu. Sections added by hand fall back to a list icon.
import { IconName } from "./bits";

export const SECTION_ICON: Record<string, IconName> = {
  info: "book", kyc: "user", budget: "coins", disclosure: "check",
  "draft-accounts": "letter", "review-accounts": "letter", "final-accounts": "letter",
  "draft-tax": "calc", "review-tax": "calc", "final-tax": "calc",
  queries: "flag", "review-notes": "flag", "client-notes": "mail",
  goodwill: "spark", fixed: "building", investments: "chart", stock: "box", debtors: "clients", bank: "bank", creditors: "coins", loans: "scale", provisions: "alert", capital: "groups", statutory: "book",
  income: "up", expenditure: "down", taxation: "calc",
  vat: "scale", workings: "list", wages: "user", "creditors-ca": "coins", "debtors-ca": "clients",
  summary: "chart", tb: "list", openbal: "clock", accwp: "book", journals: "letter", opening: "clock", "final-tb": "check",
};
export const sectionIcon = (key: string): IconName => SECTION_ICON[key] || "list";
