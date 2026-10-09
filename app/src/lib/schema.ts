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
  | "Authorisations" | "Settings" | "CHFlags";

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
      n("AnnualFees"), n("PaymentDays"), n("LatePaymentPct"), n("RetentionYears"),
      t("EngagerId"), t("LogoUrl"), t("Website"), b("CHChecked"), t("CHStatus"), note("Notes"),
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
      n("DeadlineMonths"), n("DeadlineDays"), t("DeadlineFixed"), b("KeepMonthEnd"), t("RecordsNeeded"), n("RecordsLeadDays"),
    ],
  },
  {
    key: "StageTemplates", displayName: "PP Stage Templates", description: "Practice Planner: default stages per type of work",
    columns: [t("Key", true), t("ServiceKey", true), n("StageNo"), t("DefaultWho"), n("DefaultBudget"), b("BillingPoint")],
  },
  {
    key: "ClientServices", displayName: "PP Client Services", description: "Practice Planner: which work each client has",
    columns: [
      t("Key", true), t("ClientKey", true), t("ServiceKey"), n("Fee"), t("FeePeriod"), b("OneOff"),
      n("AnnualFee"), t("NextDeadline"),
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
      t("HoldReason"), t("HoldUntil"), t("HeldOn"), t("LastChased"), n("ChaseCount"), note("ChaseLog"),
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
      t("DueDate"), t("Status"), t("CompletedDate"), note("Notes"), t("HoldReason"), t("HoldUntil"), t("HeldOn"),
    ],
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
];

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
