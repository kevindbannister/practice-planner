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
  | "Authorisations" | "HmrcAuthorisations" | "HmrcAuthEvents" | "Settings" | "CHFlags" | "Communications" | "TaxPayments" | "Meetings" | "WorkingPapers" | "PaperLines" | "Projects" | "DocTemplates" | "DocVersions" | "Documents" | "Activities"
  | "ChecklistTemplates" | "ChecklistVersions" | "Checklists" | "ChecklistItems" | "ChecklistNotes" | "ChecklistLog"
  | "Leads" | "Opportunities" | "SalesLog" | "Proposals" | "ProposalVersions" | "Engagements" | "Onboardings" | "FeeHistory" | "FeeCharges" | "ClientCosts" | "Actions"
  | "CoSecEvents" | "CoSecTransactions" | "CoSecOfficers" | "CoSecPscs" | "CoSecShares" | "CoSecShareClasses" | "Clearances" | "AmlAssessments" | "FormTemplates" | "FormRequests" | "CoSecProfiles" | "CoSecLedger"
  | "PortalUsers" | "PortalAccess" | "PortalAudit" | "PortalInvites" | "PortalDocuments" | "PortalSigning" | "PortalIdentity" | "PortalRequests" | "PortalMessages" | "PortalChanges" | "PortalNotices" | "PortalReminders" | "PortalSettings" | "PortalProposals";

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
      t("TradingName"), note("BusinessActivity"),
      t("CISStatus"), t("CISRegistered"), t("CISFirstPayment"),
      note("CorrespondenceAddress"), note("CHVerified"),
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
      // the commercial side (Services & pricing): what a proposal can offer
      t("Code"), t("Category"), note("Description"), note("ClientDescription"), t("ClientTypes"), n("Price"), t("PriceFrequency"), t("VatTreatment"), n("SetupFee"),
      note("Scope"), note("Exclusions"), note("ClientResp"), note("PracticeResp"), note("Clauses"), note("Schedule"), note("Pricing"), b("Offered"), b("Active"), b("RequiresAuth"), t("Statutory"),
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
      n("ListFee"), note("DiscountNote"), t("VatTreatment"), t("EffectiveFrom"), t("NextReview"), t("EndedOn"), t("ProposalKey"),
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
    key: "HmrcAuthorisations", displayName: "PP HMRC Authorisation Requests", description: "Practice Planner: one record per client and tax service (VAT, Corporation Tax, PAYE). Holds no tokens, passwords or codes.",
    columns: [t("Key", true), t("ClientKey", true), t("Service"), t("TaxRef"), t("Method"), t("HmrcId"), t("Status"), t("StatusSource"), t("Requested"), t("Expires"), t("AuthorisedOn"), t("LastChecked"), t("Owner"), t("OnboardingKey"), t("Env"), note("Notes"), t("Created"), t("Updated")],
  },
  {
    key: "HmrcAuthEvents", displayName: "PP HMRC Authorisation History", description: "Practice Planner: append-only history of HMRC authorisation events. Facts only.",
    columns: [t("Key", true), t("ClientKey", true), t("Service"), t("Type"), note("Summary"), t("Status"), t("StatusSource"), t("HmrcId"), t("Actor"), t("At")],
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
      t("SentTo"), t("OutlookUrl"), note("Snapshot"), t("ProposalKey", true), t("OppKey"), t("LeadKey"),
    ],
  },
  {
    // Things with no record of their own: calls, notes and other manual entries, meaningful changes to jobs,
    // and which client an email belongs to (Type "email-link"). Everything else on the client timeline is read from the records that already exist.
    key: "Activities", displayName: "PP Activities", description: "Practice Planner: client timeline entries",
    columns: [
      t("Key", true), t("ClientKey", true), t("JobKey"), t("Type", true), t("Title"), note("Summary"), t("At", true), t("Actor"), t("Source"),
      t("SourceKey", true), t("EventKey", true), t("Status"), t("Visibility"), t("FollowUp"), note("Meta"), t("Created"), t("PracticeId"), t("OppKey", true), t("LeadKey", true),
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
  {
    // People and businesses that are not clients yet. A lead links to a Client once it becomes one; clients are never duplicated here.
    key: "Leads", displayName: "PP Leads", description: "Practice Planner: sales leads (prospects who are not clients yet)",
    columns: [
      t("Key", true), t("PracticeId", true), t("Title", true), t("Kind"), t("ContactName"), t("Email", true), t("Phone"), t("Website"), t("Source"), t("Owner"),
      t("Received"), note("Notes"), t("Status", true), t("ClientKey", true), t("Created"), t("Updated"),
    ],
  },
  {
    // One piece of potential work. Belongs to a lead or to an existing client (a client can have several at once).
    key: "Opportunities", displayName: "PP Opportunities", description: "Practice Planner: sales opportunities and their pipeline stage",
    columns: [
      t("Key", true), t("PracticeId", true), t("Title"), t("LeadKey", true), t("ClientKey", true), t("Stage", true), t("StageSince"), note("Services"), n("Value"), t("Owner"),
      note("NextAction"), t("FollowUp"), t("LastContact"), t("Outcome", true), t("LostReason"), t("DeferUntil"), n("Order"), note("Notes"), t("Created"), t("Updated"),
    ],
  },
  {
    key: "SalesLog", displayName: "PP Sales Audit Trail", description: "Practice Planner: what happened to each lead and opportunity",
    columns: [t("Key", true), t("PracticeId", true), t("At", true), t("Actor"), t("Action"), t("EntityType"), t("EntityKey", true), t("LeadKey"), t("ClientKey"), note("Detail")],
  },
  {
    // One commercial offer for one opportunity. The wording and prices live in its versions.
    key: "Proposals", displayName: "PP Proposals", description: "Practice Planner: proposals (one per offer; see versions)",
    columns: [
      t("Key", true), t("PracticeId", true), t("Ref", true), t("Title"), t("OppKey", true), t("LeadKey", true), t("ClientKey", true), n("CurrentVersion"), t("Status", true),
      n("AcceptedVersion"), t("Created"), t("CreatedBy"), t("Updated"),
    ],
  },
  {
    // Every version of a proposal, kept for good. A version that has gone out is never changed; the accepted one shows exactly what was agreed.
    key: "ProposalVersions", displayName: "PP Proposal Versions", description: "Practice Planner: the versions of each proposal, as sent and as accepted",
    columns: [
      t("Key", true), t("PracticeId", true), t("ProposalKey", true), n("Version"), t("Status", true), note("Body"), t("Hash"), t("ValidUntil", true), t("Created"), t("CreatedBy"), t("Updated"),
      t("ReviewedBy"), t("ReviewedOn"), t("ApprovedBy"), t("ApprovedOn"), note("ReturnNote"), t("SentOn"), t("SentBy"), t("SentTo"), t("DocKey"),
      t("AcceptedBy"), t("AcceptedEmail"), t("AcceptedAt"), t("AcceptMethod"), note("AcceptEvidence"), t("AcceptIp"), note("Agreed"), note("RejectedReason"), t("RejectedAt"),
      n("FirstYearNet"), n("FirstYearGross"), n("OngoingNet"), n("OngoingGross"),
    ],
  },
  {
    // One engagement letter: made from an accepted proposal, or filed from outside. A client can have several. Nothing is overwritten:
    // a renewal is a new row that supersedes the old one, and every decision is kept.
    key: "Engagements", displayName: "PP Engagements", description: "Practice Planner: engagement letters and their review dates",
    columns: [
      t("Key", true), t("PracticeId", true), t("Ref", true), t("ClientKey", true), t("ProposalKey", true), n("ProposalVersion"), t("OppKey"), t("Title"), t("Source"), t("Status", true), t("ClientType"),
      note("ServiceKeys"), note("ServiceNames"), t("DocumentDate"), t("EffectiveDate"), t("ReviewYears"), t("ReviewDate", true), note("Body"), t("Hash"), t("DocKey"), t("FileUrl"), t("PortalDocId"), t("SigningId"), t("SealedDocId"),
      note("Signatories"), t("ApprovedBy"), t("ApprovedOn"), t("SentOn"), t("SentBy"), t("SignedAt"), t("SignedBy"), t("SignMethod"), note("SignEvidence"), t("PreviousKey"), t("SupersededBy"), t("EndedOn"),
      note("ReviewRequest"), note("Decisions"), note("Notes"), t("Created"), t("CreatedBy"), t("Updated"), t("SignProgress"),
      t("Basis"), note("Agreed"),
    ],
  },
  {
    // One client being taken on: its stages, AML record and activation. Not a job. See lib/onboarding.ts.
    key: "Onboardings", displayName: "PP Onboardings", description: "Practice Planner: clients being onboarded",
    columns: [
      t("Key", true), t("PracticeId", true), t("Ref", true), t("ClientKey", true), t("LeadKey"), t("OppKey"), t("ProposalKey", true), n("ProposalVersion"), t("Status", true), t("Takeover"), note("Stages"), note("Aml"),
      t("StartDate"), t("Owner"), note("Notes"), t("ApprovedBy"), t("ApprovedOn"), t("ActivatedBy"), t("ActivatedOn"), note("ActivationSummary"), t("Created"), t("CreatedBy"), t("Updated"),
    ],
  },
  {
    // Every change to what a client is charged, with who and why. See lib/fees.ts.
    key: "FeeHistory", displayName: "PP Fee History", description: "Practice Planner: changes to client fees",
    columns: [t("Key", true), t("PracticeId", true), t("ClientKey", true), t("ServiceKey"), t("At", true), t("Actor"), t("Action"), note("Old"), note("New"), note("Reason"), t("Source")],
  },
  {
    // One-off agreed charges (set-up fees and the like), kept apart from recurring fees.
    key: "FeeCharges", displayName: "PP Fee Charges", description: "Practice Planner: one-off agreed charges",
    columns: [t("Key", true), t("PracticeId", true), t("ClientKey", true), t("ServiceKey"), t("Label"), n("Amount"), t("Vat"), t("AgreedOn"), t("Status", true), t("ProposalKey"), note("Notes"), t("Created"), t("CreatedBy")],
  },
  {
    // Direct costs entered by hand, to estimate contribution. Not time recording.
    key: "ClientCosts", displayName: "PP Client Costs", description: "Practice Planner: direct costs for each client",
    columns: [t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Kind", true), t("Label"), n("Amount"), t("Period"), b("Estimate"), b("Active"), note("Notes"), t("Created"), t("CreatedBy"), t("Updated")],
  },
  {
    // What needs doing, kept so resolutions and dismissals have an audit trail. See lib/actions.ts.
    key: "Actions", displayName: "PP Actions", description: "Practice Planner: Action Centre items and their history",
    columns: [
      t("Key", true), t("PracticeId", true), t("Category", true), t("Title"), t("ClientKey", true), t("ClientName"), note("Detail"), t("Assignee"), t("Due"), t("Priority"), b("Dismissible"), t("Href"),
      t("Status", true), t("FirstSeen"), t("ResolvedAt"), t("ResolvedBy"), t("DismissedBy"), note("History"), t("Updated"),
    ],
  },
  {
    // Company secretarial (lib/cosec.ts). What changed, the filings prepared from it, and the internal statutory registers.
    key: "CoSecEvents", displayName: "PP CoSec Events", description: "Practice Planner: changes that may affect statutory records",
    columns: [t("Key", true), t("PracticeId", true), t("EventKey", true), t("ClientKey", true), t("Entity"), t("EntityKey"), t("Field"), note("Before"), note("After"), t("Source"), t("SourceKey"), t("Actor"), t("At"), t("Outcome"), t("TxKey"), note("Note")],
  },
  {
    key: "CoSecTransactions", displayName: "PP CoSec Transactions", description: "Practice Planner: statutory filings prepared, reviewed and submitted",
    columns: [
      t("Key", true), t("PracticeId", true), t("Ref", true), t("ClientKey", true), t("Form", true), t("Title"), t("Status", true), t("Target", true), t("Source"), t("SourceKey"),
      note("Before"), note("After"), note("Payload"), t("Assignee"), note("EventKeys"), note("Clarification"), t("Due"),
      t("EditedBy"), t("ApprovedBy"), t("ApprovedAt"), t("SubmittedBy"), t("SubmittedAt"), t("GatewayRef"), t("GatewayStatus"), note("GatewayNote"), t("ChRef"), t("AcceptedAt"), note("RejectReason"),
      note("History"), t("Created"), t("CreatedBy"), t("Updated"),
    ],
  },
  {
    key: "CoSecOfficers", displayName: "PP CoSec Officers", description: "Practice Planner: directors, secretaries and LLP members (internal register)",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Role"), t("Kind"), t("Status", true), t("Title"), t("First"), t("Last"), t("CorporateName"), t("DOB"), t("Nationality"), t("Occupation"), t("CountryOfResidence"),
      note("ServiceAddress"), note("ResidentialAddress"), t("AppointedOn"), t("ResignedOn"), t("PersonClientKey"), t("ChId"), t("Source"), note("Notes"), t("Created"), t("Updated"),
    ],
  },
  {
    key: "CoSecPscs", displayName: "PP CoSec PSCs", description: "Practice Planner: persons with significant control (internal register)",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Kind"), t("Status", true), t("Title"), t("First"), t("Last"), t("CorporateName"), t("DOB"), t("Nationality"), t("CountryOfResidence"),
      note("ServiceAddress"), note("ResidentialAddress"), note("Natures"), t("NotifiedOn"), t("CeasedOn"), t("PersonClientKey"), t("ChId"), t("Source"), note("Notes"), t("Created"), t("Updated"),
    ],
  },
  {
    key: "CoSecShares", displayName: "PP CoSec Shares", description: "Practice Planner: share holdings and share transactions (internal register)",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Holder"), t("HolderKey"), t("Class"), n("Number"), t("Currency"), n("NominalValue"), n("PaidPerShare"), t("Status", true), t("From"), t("To"),
      t("Event"), t("CertificateNo"), t("Source"), note("Notes"), t("Created"), t("Updated"),
    ],
  },
  {
    key: "CoSecShareClasses", displayName: "PP CoSec Share Classes", description: "Practice Planner: classes of share each company has set up",
    columns: [t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Name"), t("Currency"), n("NominalValue"), note("Rights"), t("Status", true), t("Created"), t("Updated")],
  },
  {
    key: "CoSecProfiles", displayName: "PP CoSec Profiles", description: "Practice Planner: how the practice relates to each company (service level and overrides)",
    columns: [t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Level"), t("Responsible"), t("FilesCS01"), note("Notes"), t("Created"), t("CreatedBy"), t("Updated")],
  },
  {
    // Share transaction ledger: entries are not edited, only superseded by a correction. Holdings are replayed from it. See lib/shareLedger.ts.
    key: "CoSecLedger", displayName: "PP CoSec Share Ledger", description: "Practice Planner: share transaction ledger (immutable entries; corrections supersede)",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Type"), t("EffectiveDate", true), t("Class"), n("Number"), t("FromHolder"), t("FromKey"), t("ToHolder"), t("ToKey"), t("Currency"),
      n("Nominal"), n("PaidPerShare"), n("Premium"), note("Consideration"), t("TxKey"), t("IdemKey"), t("Supersedes"), note("Reason"), t("Status", true), note("Notes"), t("Created"), t("CreatedBy"),
    ],
  },
  {
    // A request to a client's previous accountant for professional clearance and records. See lib/clearance.ts.
    key: "Clearances", displayName: "PP Clearances", description: "Practice Planner: professional clearance requests to previous accountants",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Status", true), t("PrevFirm"), t("PrevContact"), t("PrevEmail"), note("PrevAddress"), note("Items"), note("Letter"),
      t("GeneratedOn"), t("SentOn"), t("SentBy"), t("ReceivedOn"), note("Reply"), note("Notes"), t("Created"), t("CreatedBy"), t("Updated"),
    ],
  },
  {
    // A client's own AML risk assessment, kept apart from onboarding so existing clients can have one and be reviewed. See lib/amlAssessment.ts.
    key: "AmlAssessments", displayName: "PP AML Assessments", description: "Practice Planner: AML risk assessments and their reviews",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("Status", true), t("Risk"), note("RiskBasis"), note("Owners"), note("NoOwnerNote"), note("Checks"), note("Evidence"),
      t("PreparedBy"), t("ApprovedBy"), t("ApprovedAt"), t("DoneOn"), t("ReviewDate", true), note("DeclinedReason"), t("Source"), t("OnboardingKey"), note("Notes"), t("Created"), t("CreatedBy"), t("Updated"),
    ],
  },
  {
    key: "FormTemplates", displayName: "PP Form Templates", description: "Practice Planner: reusable forms and questionnaires",
    columns: [t("Key", true), t("PracticeId", true), t("Category"), note("Description"), n("Version"), b("Archived"), note("Fields"), t("Created"), t("CreatedBy"), t("Updated")],
  },
  {
    key: "FormRequests", displayName: "PP Form Requests", description: "Practice Planner: forms put to clients, with their answers",
    columns: [
      t("Key", true), t("PracticeId", true), t("ClientKey", true), t("TemplateKey", true), n("TemplateVersion"), t("Status", true), t("DueDate"), note("Fields"), note("Answers"), note("Written"),
      t("CompletedOn"), t("CompletedBy"), t("Created"), t("CreatedBy"), t("Updated"),
    ],
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
    ["PortalNotices", "PP Portal Notices", "client notifications"], ["PortalReminders", "PP Portal Reminders", "reminder schedules and history"], ["PortalSettings", "PP Portal Settings", "portal branding"], ["PortalProposals", "PP Portal Proposals", "proposal links and the answers given through them"],
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

/** SharePoint fills these in itself and refuses writes to them ("Field 'Created' is read-only"). The app still
 *  reads them back, so a row's Created is the time SharePoint made the item. */
export const READ_ONLY_FIELDS = new Set(["Created"]);

/** Keep only this list's columns (plus Title), dropping empty values and coercing types. */
export function toFields(list: ListDef, row: Row): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (row.Title !== undefined && row.Title !== "") out.Title = String(row.Title);
  for (const c of list.columns) {
    if (READ_ONLY_FIELDS.has(c.name)) continue;
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
