// Documents: templates. A template is content (blocks with {{merge fields}}), a page layout, a category
// and a version number. Saving a template with changed content or layout makes a new version and keeps
// the old one, and every generated document keeps a copy of the version it was made from, so a letter
// sent last year can always be shown exactly as it went out.
//
// The starter templates are built in (they need no setup and can't be damaged); using one copies it
// into the practice's own library where it can be edited.
import { Block, DEFAULT_LAYOUT, DocContent, DocLayout, Run, emptyContent, readContent } from "./docModel";

export const CATEGORIES = [
  "General correspondence",
  "Engagement letters",
  "Information requests",
  "Accounts approval letters",
  "Tax correspondence",
  "Fee proposals",
  "Payment reminders",
  "Client onboarding",
  "Custom documents",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type DocTemplate = {
  id: string;
  name: string;
  category: Category;
  description: string;
  content: DocContent;
  layout: DocLayout;
  version: number;
  archived: boolean;
  isDefault: boolean; // the template offered first for its category
  brandingId?: string; // a branding profile this template always uses (otherwise the practice default)
  updated?: string;
  starter?: boolean; // built in: not stored
};
/** One saved version of a template. */
export type TemplateVersion = { templateId: string; version: number; name: string; content: DocContent; layout: DocLayout; saved: string; note?: string };

// ------------------------------------------------------------------ building starters

const r = (t: string, o: Partial<Run> = {}): Run => ({ t, ...o });
const P = (t: string, o: Partial<Run> = {}, align?: "left" | "right" | "center" | "justify"): Block => ({ type: "p", runs: t ? [r(t, o)] : [], ...(align ? { align } : {}) }) as Block;
const B = (t: string): Block => P(t, { b: true });
const H = (t: string, level: 1 | 2 | 3 = 2): Block => ({ type: "h", level, runs: [r(t)] });
const L = (items: string[], ordered = false): Block => ({ type: "list", ordered, items: items.map((t) => [r(t)]) });
const T = (rows: string[][], header = true): Block => ({ type: "table", header, rows: rows.map((row) => row.map((t) => ({ runs: [r(t)] }))) });
const gap = (): Block => P("");

/** The opening every letter shares: addressee, date, salutation. */
const opening = (subject: string): Block[] => [
  P("{{client.address_block}}"),
  gap(),
  P("{{doc.date}}"),
  gap(),
  P("{{client.salutation}}"),
  gap(),
  B(subject),
];
const closing = (): Block[] => [gap(), P("Yours sincerely,"), gap(), gap(), P("{{practice.signatory_name}}", { b: true }), P("{{practice.signatory_title}}"), P("{{practice.name}}")];

const starter = (id: string, name: string, category: Category, description: string, blocks: Block[], layout: Partial<DocLayout> = {}): DocTemplate => ({
  id: `starter:${id}`,
  name,
  category,
  description,
  content: { blocks },
  layout: { ...DEFAULT_LAYOUT, ...layout, margins: { ...DEFAULT_LAYOUT.margins, ...(layout.margins || {}) } },
  version: 1,
  archived: false,
  isDefault: false,
  starter: true,
});

export const STARTERS: DocTemplate[] = [
  starter("letter", "General letter", "General correspondence", "A plain letter on the practice letterhead.", [
    ...opening("{{job.type}}"),
    gap(),
    P("I am writing to you regarding "),
    gap(),
    P("Please do not hesitate to contact me if you have any questions."),
    ...closing(),
  ]),

  starter("engagement", "Engagement letter: accounts and tax", "Engagement letters", "Sets out the work we will do, your responsibilities and the basis of our fees.", [
    ...opening("Engagement letter: {{client.name}}"),
    gap(),
    P("Thank you for choosing {{practice.name}} to act for {{client.name}}. This letter confirms the work we have agreed to carry out, and the responsibilities of both of us."),
    H("Our services"),
    P("We will prepare the annual accounts and the corporation tax return of {{client.name}} for the period {{job.period}}, from the records you provide. We will also file them with Companies House and HM Revenue & Customs by the due dates."),
    H("Your responsibilities"),
    L([
      "To keep proper accounting records and give us complete and accurate information on time.",
      "To tell us promptly about any changes in the business, including new bank accounts, loans and significant transactions.",
      "To review the accounts and returns we prepare, and approve them before we file.",
    ]),
    H("Our responsibilities"),
    P("We will carry out the work with reasonable skill and care, keep your information confidential, and tell you if we believe anything you have asked for is unlawful or inappropriate."),
    H("Fees"),
    P("Our fees are based on the time spent and the seniority of the staff involved. We will agree any fixed fee with you in writing before we start."),
    H("Next steps"),
    P("Please sign and return a copy of this letter to confirm that you agree to these terms."),
    ...closing(),
    gap(),
    P("I confirm that I have read and agree to the terms of this letter."),
    gap(),
    P("Signed ______________________________     Date ______________________"),
    P("For and on behalf of {{client.name}}"),
  ]),

  starter("information", "Information request", "Information requests", "Asks the client for the records needed to start a job, with a checklist.", [
    ...opening("Information needed: {{job.type}}, {{job.period}}"),
    gap(),
    P("To prepare the {{job.type}} for {{client.name}}, I need the following information. If you can send it to us by {{job.deadline}} we will be able to meet the filing deadline."),
    gap(),
    T([
      ["Item", "Notes", "Received"],
      ["Bank statements for the whole period", "All business accounts", ""],
      ["Sales invoices", "Issued in the period", ""],
      ["Purchase invoices and receipts", "Paid in the period", ""],
      ["Loan and finance agreements", "New or settled in the year", ""],
      ["Payroll summaries and P60s", "If applicable", ""],
    ]),
    gap(),
    P("You can upload the documents to the client portal or reply to this letter with copies. Please let me know if anything is not available and we will agree how to proceed."),
    ...closing(),
  ]),

  starter("accounts-approval", "Accounts approval letter", "Accounts approval letters", "Sends the draft accounts for approval before filing.", [
    ...opening("Annual accounts for the year ended {{job.year_end}}"),
    gap(),
    P("I enclose the draft accounts of {{client.name}} for the year ended {{job.year_end}}, for your review."),
    gap(),
    P("As a director you are responsible for the accounts giving a true and fair view. Please read them carefully, and check in particular that:"),
    L([
      "the figures for sales, costs and bank balances agree with your own records;",
      "all loans, assets and liabilities of the company are included; and",
      "the directors' details and shareholdings are correct.",
    ]),
    P("When you are happy, please reply to confirm your approval, and we will file the accounts with Companies House. The filing deadline is {{job.statutory_deadline}}."),
    ...closing(),
  ]),

  starter("tax", "Tax return ready to approve", "Tax correspondence", "Tells the client their return is ready, with the tax due and how to pay.", [
    ...opening("Corporation tax return, period ended {{job.year_end}}"),
    gap(),
    P("The corporation tax return of {{client.name}} for the period ended {{job.year_end}} is ready for your approval."),
    gap(),
    T([
      ["Item", "Amount"],
      ["Taxable profit", "£"],
      ["Corporation tax due", "£"],
      ["Payment due by", "{{job.statutory_deadline}}"],
    ]),
    gap(),
    P("Please confirm that you approve the return so that we can submit it to HM Revenue & Customs. Payment must reach HMRC by the due date to avoid interest."),
    ...closing(),
  ]),

  starter("fee-proposal", "Fee proposal", "Fee proposals", "Proposes services and fees to a prospective or existing client.", [
    ...opening("Our proposal for {{client.name}}"),
    gap(),
    P("Thank you for the opportunity to discuss your needs. I set out below the services we propose and our fees."),
    H("Proposed services and fees"),
    T([
      ["Service", "Frequency", "Fee (excluding VAT)"],
      ["Annual accounts and corporation tax return", "Yearly", "£"],
      ["VAT returns", "Quarterly", "£"],
      ["Payroll", "Monthly", "£"],
      ["Bookkeeping", "Monthly", "£"],
    ]),
    gap(),
    P("Fees are invoiced monthly in advance and are payable within 14 days. This proposal is valid for 30 days from the date of this letter."),
    P("If you would like to go ahead I will send you our engagement letter to sign."),
    ...closing(),
  ]),

  starter("payment-reminder", "Payment reminder", "Payment reminders", "A polite reminder that an invoice is overdue.", [
    ...opening("Reminder: outstanding invoice"),
    gap(),
    P("Our records show that the invoice below is now overdue for payment."),
    gap(),
    T([
      ["Invoice", "Date", "Amount due"],
      ["", "", "£"],
    ]),
    gap(),
    P("If you have already paid, please accept our thanks and ignore this reminder. Otherwise please arrange payment within seven days. If there is a problem, or you would like to agree a payment plan, please contact me."),
    ...closing(),
  ]),

  starter("welcome", "New client welcome", "Client onboarding", "Welcomes a new client and explains what happens next.", [
    ...opening("Welcome to {{practice.name}}"),
    gap(),
    P("It is a pleasure to welcome {{client.name}} as a client. This letter explains what happens in the first few weeks."),
    H("What we will do"),
    L([
      "Complete our client identification checks and register you with HM Revenue & Customs as your agent.",
      "Contact your previous accountant to arrange a smooth handover.",
      "Agree the key dates for your accounts, tax and VAT, and add them to our diary.",
    ], true),
    H("What we need from you"),
    L(["A signed engagement letter.", "Proof of identity and address for each director.", "Your authorisation to act as your agent, which we will send separately."]),
    H("Getting in touch"),
    P("You can reach us on {{practice.phone}} or at {{practice.email}}."),
    ...closing(),
  ]),
];

// ------------------------------------------------------------------ working with templates

const stamp = () => new Date().toISOString();
export const templateId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function blankTemplate(name = "New template", category: Category = "Custom documents"): DocTemplate {
  return { id: templateId(), name, category, description: "", content: emptyContent(), layout: { ...DEFAULT_LAYOUT }, version: 1, archived: false, isDefault: false, updated: stamp() };
}

/** A copy of a template (a starter or one of the practice's own) as a new library template. */
export function copyTemplate(t: DocTemplate, name?: string): DocTemplate {
  return { ...t, id: templateId(), name: name || (t.starter ? t.name : `${t.name} (copy)`), version: 1, archived: false, isDefault: false, starter: undefined, updated: stamp(), content: JSON.parse(JSON.stringify(t.content)), layout: JSON.parse(JSON.stringify(t.layout)) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The result of saving edits: the new template, and the old version to keep when the content or layout changed. */
export function saveEdit(prev: DocTemplate, edit: Partial<Pick<DocTemplate, "name" | "category" | "description" | "content" | "layout" | "brandingId">>): { next: DocTemplate; keep?: TemplateVersion } {
  const content = edit.content ?? prev.content, layout = edit.layout ?? prev.layout;
  const changed = !same(content, prev.content) || !same(layout, prev.layout);
  const next: DocTemplate = { ...prev, ...edit, content, layout, version: changed ? prev.version + 1 : prev.version, updated: stamp() };
  const keep: TemplateVersion | undefined = changed ? { templateId: prev.id, version: prev.version, name: prev.name, content: prev.content, layout: prev.layout, saved: prev.updated || stamp() } : undefined;
  return { next, keep };
}

/** Restores an earlier version as a new version (history is never rewritten). */
export function restoreVersion(current: DocTemplate, old: TemplateVersion): { next: DocTemplate; keep: TemplateVersion } {
  return saveEdit(current, { content: old.content, layout: old.layout, name: old.name }) as { next: DocTemplate; keep: TemplateVersion };
}

export const live = (ts: DocTemplate[]) => ts.filter((t) => !t.archived);

/** The template offered first for a category: the one marked default, else the first live one, else a starter. */
export function defaultFor(category: Category, ts: DocTemplate[]): DocTemplate | undefined {
  const mine = live(ts).filter((t) => t.category === category);
  return mine.find((t) => t.isDefault) || mine[0] || STARTERS.find((s) => s.category === category);
}

/** Marks one template as its category's default. Returns just the templates that change (the new default and the one it replaces). */
export function setDefault(ts: DocTemplate[], id: string): DocTemplate[] {
  const target = ts.find((t) => t.id === id);
  if (!target) return ts;
  return ts.filter((t) => t.category === target.category && t.isDefault !== (t.id === id)).map((t) => ({ ...t, isDefault: t.id === id }));
}

/** The library as shown: the practice's templates, then the starters it hasn't copied. */
export function library(ts: DocTemplate[], includeArchived = false): DocTemplate[] {
  const own = includeArchived ? ts : live(ts);
  return [...own, ...STARTERS];
}

// ------------------------------------------------------------------ storage (one SharePoint list row holds a body)

export type Body = { content: DocContent; layout: DocLayout };
export const encodeBody = (b: Body) => JSON.stringify(b);
export function decodeBody(s: string | undefined): Body {
  try {
    const j = JSON.parse(s || "{}");
    const layout = { ...DEFAULT_LAYOUT, ...(j.layout || {}), margins: { ...DEFAULT_LAYOUT.margins, ...(j.layout?.margins || {}) } } as DocLayout;
    return { content: readContent(j.content), layout };
  } catch {
    return { content: emptyContent(), layout: { ...DEFAULT_LAYOUT } };
  }
}
export const asCategory = (s: string | undefined): Category => (CATEGORIES as readonly string[]).includes(s || "") ? (s as Category) : "Custom documents";
