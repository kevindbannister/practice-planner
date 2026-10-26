// The SharePoint lists the app keeps its data in, and their columns.
// Every list has a Title (SharePoint's built-in column) and an indexed Key that the app
// uses to identify and link records. Dates are stored as text in ISO form (2026-10-31):
// SharePoint shifts date-only values by time zone, and text sorts correctly as-is.

export type ColType = "text" | "note" | "number" | "bool";
export type Column = { name: string; type: ColType; indexed?: boolean };
export type ListDef = { key: ListKey; displayName: string; description: string; columns: Column[] };

const t = (name: string, indexed = false): Column => ({ name, type: "text", indexed });
const n = (name: string): Column => ({ name, type: "number" });
const b = (name: string): Column => ({ name, type: "bool" });
const note = (name: string): Column => ({ name, type: "note" });

export type ListKey =
  | "Clients" | "Contacts" | "Groups" | "GroupMembers" | "Services" | "StageTemplates"
  | "ClientServices" | "ClientServiceStages" | "Jobs" | "JobHistory" | "Tasks"
  | "Authorisations" | "Settings" | "CHFlags" | "Communications" | "TaxPayments" | "Meetings" | "WorkingPapers" | "PaperLines" | "Projects" | "DocTemplates" | "DocVersions" | "Documents" | "Activities"
  | "ChecklistTemplates" | "ChecklistVersions" | "Checklists" | "ChecklistItems" | "ChecklistNotes" | "ChecklistLog"
  | "PortalUsers" | "PortalAccess" | "PortalAudit" | "PortalInvites" | "PortalDocuments" | "PortalSigning" | "PortalIdentity" | "PortalRequests" | "PortalMessages" | "PortalChanges" | "PortalNotices" | "PortalReminders";

export const LISTS: ListDef[] = [
  {
    key: "Clients", displayName: "PP Clients", description: "Practice Planner: clients",
    columns: [
      t("Key", true), t("Kind"), t("Status"), t("CompanyNumber", true), t("CHAuthCode"), t("SIC"),
      t("Incorporated"), t("Engaged"), t("DateOfBirth"), t("YearEnd"),
      t("ContactTitle"), t("ContactFirst"), t("ContactPreferred"), t("ContactLast"),
      t("Email"), t("Mobile"), t("Phone"), t("ContactPreference"),
      note("HomeAddress"), note("TradingAddress"), note("RegisteredOffice"),
      t("Partner"), t("Manager"), t("UTR"), t("CTUTR"), t("NINumber"), t("VATNumber"), t("VATRegistered"),
      t("MTDServices"), t("PAYERef"), t("AccountsOfficeRef"), t("XeroId"), t("XamaId"), t("XamaStatus"),
      t("AMLReview"), t("LoEStatus"), t("LoESent"), t("LoEDecided"),
      t("Importance"), n("AnnualFees"), n("PaymentDays"), n("LatePaymentPct"), n("RetentionYears"),
      t("EngagerId"), t("LogoUrl"), t("Website"), t("ElementsLink"), b("CHChecked"), t("CHStatus"), note("Notes"), note("LogoData"),
    ],
  },
  {
    key: "Contacts", displayName: "PP Contacts", description: "Practice Planner: people linked to clients",
    columns: [t("Key", true), t("ContactTitle"), t("Email"), t("Mobile"), t("Phone"), note("Relationships"), t("EngagerId")],
  },
  {
    key: "Groups", displayName: "PP Groups", description: "Practice Planner: client groups",
    columns: [t("Key", true), note("Notes")],
  },
  {
    key: "GroupMembers", displayName: "PP Group Members", description: "Practice Planner: who is in each group",
    columns: [t("Key", true), t("GroupKey", true), t("MemberKey", true), t("Kind"), t("Role")],
  },
  {
    key: "Services", displayName: "PP Services", description: "Practice Planner: types of work",
    columns: [
      t("Key", true), t("Recurrence"), t("DeadlineRule"), n("DefaultHours"), n("RepeatMonths"), t("DeadlineMode"),
      n("DeadlineMonths"), n("DeadlineDays"), t("DeadlineFixed"), b("KeepMonthEnd"), t("RecordsNeeded"), n("RecordsLeadDays"), n("FinaliseHours"),
    ],
  },
  {
    key: "StageTemplates", displayName: "PP Stage Templates", description: "Practice Planner: default stages per type of work",
    columns: [t("Key", true), t("ServiceKey", true), n("StageNo"), t("DefaultWho"), n("DefaultBudget"), b("BillingPoint"), b("WaitClient")],
  },
  {
    key: "ClientServices", displayName: "PP Client Services", description: "Practice Planner: which work each client has",
    columns: [
      t("Key", true), t("ClientKey", true), t("ServiceKey"), n("Fee"), t("FeePeriod"), b("OneOff"),
      n("AnnualFee"), t("NextDeadline"), b("Off"), t("OffSince"),
    ],
  },
  {
    key: "ClientServiceStages", displayName: "PP Client Service Stages", description: "Practice Planner: who does each stage, per client",
    columns: [
      t("Key", true), t("ClientKey", true), t("ServiceKey"), n("StageNo"), t("Who"), n("BudgetHours"), b("BillingPoint"),
    ],
  },
  {
    key: "Jobs", displayName: "PP Jobs", description: "Practice Planner: open jobs",
    columns: [
      t("Key", true), t("ClientKey", true), t("ClientName"), t("ServiceKey"), t("PeriodEnd"),
      n("StageNo"), t("StageName"), t("RecordsExpected"), t("RecordsReceived"), t("PlannedDate", true),
      n("EstimateHours"), t("InternalDeadline"), t("Deadline", true), t("DeadlineSource"), t("CHDeadline"),
      t("SuggestedSlot"), t("LastCompleted"), t("Priority"), t("Status"), t("CompletedDate"),
      n("ActualHours"), n("Fee"), t("FeePeriod"), t("Source"), t("EngagerClient"), note("Notes"),
      t("HoldReason"), t("HoldUntil"), t("HeldOn"), t("HoldKind"), t("LastChased"), n("ChaseCount"), note("ChaseLog"), note("CardNote"),
      t("WaitingSince"), t("SpeakOn"), n("FinaliseHours"), t("PreparedOn"), n("PreparedHours"), n("DayOrder"), t("StartTime"), t("TimeSkipped"),
    ],
  },
  {
    key: "JobHistory", displayName: "PP Job History", description: "Practice Planner: completed and closed jobs",
    columns: [
      t("Key", true), t("ClientKey", true), t("EngagerClient"), t("ServiceKey"), t("StatutoryDeadline"),
      t("InternalDeadline"), t("Completed"), t("OnTime"), n("BudgetHours"), n("ActualHours"), note("ClosedNote"),
    ],
  },
  {
    key: "Tasks", displayName: "PP Tasks", description: "Practice Planner: advisory and practice tasks",
    columns: [
      t("Key", true), t("ClientKey", true), t("GroupKey"), t("Type"), t("PlannedDate", true), n("EstimateHours"),
      t("DueDate"), t("Status"), t("CompletedDate"), note("Notes"), t("HoldReason"), t("HoldUntil"), t("HeldOn"), t("HoldKind"), note("CardNote"),
      n("DayOrder"), note("Subtasks"), t("StartTime"), n("ActualHours"), t("TimeSkipped"), t("ProjectKey"), t("RoutineKey"), t("RoutineDate"),
    ],
  },
  {
    // Work on the practice itself (marketing, systems, recruiting). Its tasks are Tasks with a ProjectKey.
    key: "Projects", displayName: "PP Projects", description: "Practice Planner: business projects",
    columns: [t("Key", true), t("Category"), note("Outcome"), t("Status"), t("TargetDate"), t("Touched"), note("Notes")],
  },
  {
    key: "Authorisations", displayName: "PP HMRC Authorisations", description: "Practice Planner: HMRC agent authorisations",
    columns: [t("Key", true), t("ClientKey", true), t("Service"), t("Status"), t("LinkSent"), t("Expiry"), note("Notes")],
  },
  {
    key: "Settings", displayName: "PP Settings", description: "Practice Planner: settings",
    columns: [t("Key", true), note("Value")],
  },
  {
    // One row per thing Companies House disagrees with the planner about. Status is Open until
    // you apply or ignore it; it's Resolved if the difference goes away by itself.
    key: "CHFlags", displayName: "PP Companies House Changes", description: "Practice Planner: changes found at Companies House",
    columns: [
      t("Key", true), t("ClientKey", true), t("JobKey"), t("Type"), t("Severity"), note("Detail"), note("Current"),
      note("Proposed"), t("Status", true), t("Found"), t("Resolved"),
    ],
  },
  {
    key: "Communications", displayName: "PP Communications", description: "Practice Planner: letters and emails to clients",
    columns: [
      t("Key", true), t("ClientKey", true), t("JobKey"), t("Kind"), t("Status"), t("Subject"), note("Body"), note("Brief"),
      t("ToEmail"), note("Address"), t("Salutation"), t("SignOff"), t("LetterDate"), t("Created"), t("Updated", true),
      t("FileUrl"), t("FileName"), t("OutlookUrl"), t("SentOn"),
    ],
  },
  {
    key: "TaxPayments", displayName: "PP Tax Payments", description: "Practice Planner: Self Assessment and corporation tax payments per client",
    columns: [
      t("Key", true), t("ClientKey", true), t("Tax"), t("Kind"), t("EntryYear"), t("TaxYear"), t("Label"), n("Amount"), t("DueDate", true),
      t("PaidOn"), t("RemindedOn"), n("Bill"), n("OtherTax"), n("PoaPaid"), b("MostlyAtSource"), note("Notes"),
    ],
  },
  {
    key: "Meetings", displayName: "PP Meetings", description: "Practice Planner: meetings and calls with clients",
    columns: [
      t("Key", true), t("ClientKey", true), t("JobKey"), t("Kind"), t("Template"), t("Status"), t("When", true), n("Minutes"),
      t("Location"), t("Attendees"), note("Agenda"), note("Notes"), note("Summary"), note("Decisions"), note("Actions"), t("FollowUp"),
      t("SummaryCommKey"), t("Updated"),
    ],
  },
  {
    // The practice's own letter and document templates. Body holds the content and page layout as JSON.
    key: "DocTemplates", displayName: "PP Document Templates", description: "Practice Planner: letter and document templates",
    columns: [t("Key", true), t("Category"), note("Description"), n("Version"), b("Archived"), b("IsDefault"), t("BrandingId"), t("Updated"), note("Body")],
  },
  {
    // Earlier versions of a template, kept each time the content or layout changes.
    key: "DocVersions", displayName: "PP Document Template Versions", description: "Practice Planner: earlier versions of document templates",
    columns: [t("Key", true), t("TemplateKey", true), n("Version"), t("Saved"), note("Body")],
  },
  {
    // A document made for a client: which template and version, the saved PDF, and a copy of exactly what was produced.
    key: "Documents", displayName: "PP Documents", description: "Practice Planner: documents and letters generated for clients",
    columns: [
      t("Key", true), t("ClientKey", true), t("JobKey"), t("TemplateKey"), n("TemplateVersion"), t("TemplateName"), t("Category"), t("Title"),
      t("Reference"), t("Created", true), t("CreatedBy"), t("BrandingId"), t("FileUrl"), t("FileName"), n("Pages"), t("Status"), t("SentOn"),
      t("SentTo"), t("OutlookUrl"), note("Snapshot"),
    ],
  },
  {
    // Things with no record of their own: calls, notes and other manual entries, meaningful changes to jobs,
    // and which client an email belongs to (Type "email-link"). Everything else on the client timeline is read from the records that already exist.
    key: "Activities", displayName: "PP Activities", description: "Practice Planner: client timeline entries",
    columns: [
      t("Key", true), t("ClientKey", true), t("JobKey"), t("Type", true), t("Title"), note("Summary"), t("At", true), t("Actor"), t("Source"),
      t("SourceKey", true), t("EventKey", true), t("Status"), t("Visibility"), t("FollowUp"), note("Meta"), t("Created"), t("PracticeId"),
    ],
  },
  {
    key: "WorkingPapers", displayName: "PP Working Papers", description: "Practice Planner: status and notes for each section of a company's working papers",
    columns: [
      t("Key", true), t("ClientKey", true), t("PeriodEnd", true), t("ItemKey"), t("Status"), note("Note"), t("Updated"),
      t("PreparedBy"), t("PreparedOn"), t("ReviewedBy"), t("ReviewedOn"), note("Setup"),
    ],
  },
  {
    key: "PaperLines", displayName: "PP Paper Lines", description: "Practice Planner: the lines of each schedule in a company's working papers",
    columns: [
      t("Key", true), t("ClientKey", true), t("PeriodEnd", true), t("SectionKey", true), t("SubKey"), t("Code"), t("Detail"),
      n("Amount"), note("Remark"), b("Done"), n("Seq"), t("Updated"), note("Figures"),
    ],
  },
  {
    key: "ChecklistTemplates", displayName: "PP Checklist Templates", description: "Practice Planner: job checklist templates",
    columns: [
      t("Key", true), t("JobType", true), note("Description"), t("ClientKinds"), note("Rules"), n("Version"), b("Active"), b("IsDefault"), n("Hours"),
      note("Body"), t("Starter"), t("Created"), t("Updated"), t("PracticeId"),
    ],
  },
  {
    key: "ChecklistVersions", displayName: "PP Checklist Template Versions", description: "Practice Planner: earlier versions of checklist templates",
    columns: [t("Key", true), t("TemplateKey", true), n("Version"), t("Saved"), note("Body"), t("PracticeId")],
  },
  {
    key: "Checklists", displayName: "PP Checklists", description: "Practice Planner: the checklist on each job",
    columns: [
      t("Key", true), t("JobKey", true), t("ClientKey", true), t("PeriodEnd"), t("JobType"), t("TemplateKey"), n("TemplateVersion"), t("TemplateName"), t("Status", true),
      note("Answers"), t("PreparedBy"), t("PreparedOn"), t("ReviewedBy"), t("ReviewedOn"), t("ApprovedBy"), t("ApprovedOn"), t("CreatedBy"), t("Created"), t("Updated"), n("Rev"), t("PracticeId"),
    ],
  },
  {
    key: "ChecklistItems", displayName: "PP Checklist Items", description: "Practice Planner: the steps of each job's checklist",
    columns: [
      t("Key", true), t("ChecklistKey", true), t("JobKey", true), t("ItemId"), t("Section"), n("Seq"), t("Status", true), b("Mandatory"), t("Assignee"), t("Role"), n("Hours"), t("Due"),
      note("Notes"), t("CompletedBy"), t("CompletedOn"), note("NaReason"), note("Override"), note("After"), note("Detail"), b("Gone"), note("History"), n("Rev"), t("PracticeId"),
    ],
  },
  {
    key: "ChecklistNotes", displayName: "PP Checklist Review Notes", description: "Practice Planner: review points raised on a checklist",
    columns: [
      t("Key", true), t("ChecklistKey", true), t("ItemKey"), note("Text"), t("RaisedBy"), t("RaisedOn"), t("Status", true), note("Response"), t("RespondedBy"),
      t("ResolvedBy"), t("ResolvedOn"), note("History"), n("Rev"), t("PracticeId"),
    ],
  },
  {
    key: "ChecklistLog", displayName: "PP Checklist Audit Trail", description: "Practice Planner: what happened on each checklist",
    columns: [t("Key", true), t("ChecklistKey", true), t("JobKey"), t("ClientKey"), t("ItemKey"), t("At", true), t("Actor"), t("Action"), note("Detail"), t("PracticeId")],
  },
  ...portalLists(),
];

/**
 * The client portal's lists. Only the portal's server (api/portal) reads and writes these, with its
 * own credentials: clients never reach SharePoint, and staff use the portal screens rather than
 * these lists. Every record is one row: Key (its id), PracticeId, two handy lookup columns, Rev
 * (for change checks) and Json (the record). The list names must match api/portal/lib/graphStore.js.
 */
function portalLists(): ListDef[] {
  const defs: [ListKey, string, string][] = [
    ["PortalUsers", "PP Portal Users", "portal logins"], ["PortalAccess", "PP Portal Access", "which person can see which business"],
    ["PortalAudit", "PP Portal Audit", "the portal audit trail"], ["PortalInvites", "PP Portal Invites", "portal invitations"],
    ["PortalDocuments", "PP Portal Documents", "documents shared with clients"], ["PortalSigning", "PP Portal Signing", "signing requests and evidence"],
    ["PortalIdentity", "PP Portal Identity", "identity document requests and records"], ["PortalRequests", "PP Portal Requests", "information requests"],
    ["PortalMessages", "PP Portal Messages", "secure messages"], ["PortalChanges", "PP Portal Changes", "business detail change requests"],
    ["PortalNotices", "PP Portal Notices", "client notifications"], ["PortalReminders", "PP Portal Reminders", "reminder schedules and history"],
  ];
  return defs.map(([key, displayName, what]) => ({
    key, displayName, description: `Practice Planner client portal: ${what}. Written only by the portal server.`,
    columns: [t("Key", true), t("PracticeId", true), t("Ref1"), t("Ref2"), t("Rev"), note("Json")],
  }));
}

export const LIST_BY_KEY: Record<ListKey, ListDef> = Object.fromEntries(LISTS.map((l) => [l.key, l])) as Record<
  ListKey,
  ListDef
>;

/** Graph columnDefinition for creating a column. */
export function columnDefinition(c: Column): Record<string, unknown> {
  const base: Record<string, unknown> = { name: c.name, displayName: c.name };
  if (c.indexed) base.indexed = true;
  switch (c.type) {
    case "text":
      return { ...base, text: {} };
    case "note":
      return { ...base, text: { allowMultipleLines: true, linesForEditing: 6 } };
    case "number":
      return { ...base, number: {} };
    case "bool":
      return { ...base, boolean: {} };
  }
}

export type Row = Record<string, string | number | boolean | undefined> & { _id?: string; Title?: string; Key?: string };

/** Keep only this list's columns (plus Title), dropping empty values and coercing types. */
export function toFields(list: ListDef, row: Row): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (row.Title !== undefined && row.Title !== "") out.Title = String(row.Title);
  for (const c of list.columns) {
    const v = row[c.name];
    if (v === undefined || v === null || v === "") continue;
    if (c.type === "number") {
      const num = typeof v === "number" ? v : Number(v);
      if (!Number.isNaN(num)) out[c.name] = num;
    } else if (c.type === "bool") {
      out[c.name] = v === true || v === "true" || v === "True";
    } else {
      out[c.name] = String(v);
    }
  }
  return out;
}

/** Turn a SharePoint item's fields into an app row. */
export function fromFields(list: ListDef, itemId: string, fields: Record<string, unknown>): Row {
  const row: Row = { _id: itemId };
  if (typeof fields.Title === "string") row.Title = fields.Title;
  for (const c of list.columns) {
    const v = fields[c.name];
    if (v === undefined || v === null || v === "") continue;
    row[c.name] = c.type === "number" ? Number(v) : c.type === "bool" ? Boolean(v) : String(v);
  }
  if (typeof fields.Modified === "string") row.Modified = fields.Modified;
  return row;
}
