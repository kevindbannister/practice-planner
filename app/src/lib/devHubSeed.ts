// The starting content of the Development Hub: the feature inventory taken from an audit of the repository on 6 November 2026,
// the agreed roadmap, the external approvals and the architecture decisions.
//
// Honesty rules for this file:
//  - Nothing is "Complete". That needs a live check with realistic data, which only the practice can record in the Hub.
//  - "Ready for Testing" means the workflow is built and has automated tests; it is not live-ready.
//  - "In Development" means code exists but there are no automated tests or the workflow is unfinished.
//  - No completion percentages are given: none has been assessed.
// Files are written as short paths (see resolveFile in devHub.ts) and a test checks that every one exists.

import type { Decision, Feature, Integration, Issue, Milestone, Priority, RoadmapPriority, Status } from "./devHub";

const REVIEWED = "2026-11-06";
const ST: Record<string, Status> = { RT: "Ready for Testing", ID: "In Development", PL: "Planned", NS: "Not Started", BL: "Blocked", BR: "Broken", TE: "Testing", CO: "Complete" };
const ISSUE_FOR: Record<string, number[]> = { P1: [4], P2: [6], P3: [7], P4: [8], P5: [9], Access: [10], None: [] };

interface Opt { s?: keyof typeof ST; p?: Priority; i?: number[]; d?: string[]; b?: string[]; bugs?: string[]; n?: string[]; notes?: string }

const rows: Feature[] = [];
const prio = new Map<string, Priority>();

function node(id: string, parent: string, name: string, desc: string, files: string[], o: Opt = {}) {
  const p = o.p || prio.get(parent) || "None";
  prio.set(id, p);
  const tests = files.filter((x) => x.startsWith("test:") || x.startsWith("apitest:"));
  const src = files.filter((x) => !tests.includes(x));
  const status = ST[o.s || (tests.length ? "RT" : files.length ? "ID" : "PL")];
  rows.push({
    id, parent, name, desc, status, priority: p, files: src, tests, issues: o.i || (parent ? ISSUE_FOR[p] : []), deps: o.d || [], blockers: o.b || [],
    bugs: o.bugs || [], next: o.n || [], notes: o.notes || "", reviewed: REVIEWED,
  });
}
const area = (id: string, name: string, desc: string) => node(id, "", name, desc, []);
const mod = (id: string, parent: string, name: string, desc: string, p: Priority) => { prio.set(id, p); rows.push({ id, parent, name, desc, status: "Planned", priority: p, files: [], tests: [], issues: [], deps: [], blockers: [], bugs: [], next: [], notes: "", reviewed: REVIEWED }); };
const f = (id: string, parent: string, name: string, desc: string, files: string[], o?: Opt) => node(id, parent, name, desc, files, o);

// =================================================================== RUN PRACTICE
area("run", "Practise", "Planning, clients, communication, sales, billing and the running of the practice itself.");

mod("run.dash", "run", "Dashboard", "What needs doing today and how the practice is doing.", "P3");
f("run.dash.home", "run.dash", "Home dashboard", "The first screen: today's work, deadlines, alerts and shortcuts.", ["ui:HomePage", "ui:OverviewGrid", "lib:overviewLayout", "test:overviewLayout"]);
f("run.dash.today", "run.dash", "Today view", "What to do today and why, by plain rules.", ["ui:TodayView", "ui:useTodayModel.ts", "lib:today", "test:today"]);
f("run.dash.practice", "run.dash", "Practice at a glance", "One read-only summary of how the whole firm is doing.", ["ui:PracticePage", "lib:practice", "test:practice"]);
f("run.dash.grid", "run.dash.home", "Rearrangeable overview grid", "The client overview as a grid that can be dragged into a new layout.", ["ui:OverviewGrid", "lib:overviewLayout", "test:overviewLayout"]);

mod("run.plan", "run", "Planning", "Week board, months ahead, capacity and time.", "P3");
f("run.plan.board", "run.plan", "Week planning board", "Drag jobs onto days; three dates per job (records, planned, deadline).", ["ui:PlanPage", "lib:planning", "test:planning", "test:dayOrder"]);
f("run.plan.day", "run.plan.board", "Day grid and day order", "Hour-by-hour layout and order of work within a day.", ["lib:dayGrid", "lib:dayOrder", "test:dayGrid", "test:dayOrder", "test:detailOrder"]);
f("run.plan.daytypes", "run.plan.board", "Day types and capacity", "Client days, business days and the hours each gives.", ["lib:dayTypes", "test:dayTypes"]);
f("run.plan.auto", "run.plan", "Suggest a plan", "Fills the week from unplanned work by fixed rules.", ["lib:autoplan", "test:autoplan"]);
f("run.plan.months", "run.plan", "Months ahead", "Hours due against hours available, month by month.", ["ui:MonthsView", "lib:forecast", "test:forecast"]);
f("run.plan.deadlines", "run.plan", "Deadlines list", "A printable list of deadlines.", ["ui:DeadlinesView", "ui:DoneView"], { s: "ID" });
f("run.plan.hours", "run.plan", "Hours view", "Hours planned against capacity.", ["ui:HoursView"]);
f("run.plan.time", "run.plan", "Time spent and job time", "How long finished work took, stage by stage against budget.", ["ui:TimeSpent", "ui:JobTime", "lib:timeSpent", "lib:jobTime", "test:timeSpent", "test:jobTime"]);
f("run.plan.sessions", "run.plan", "Planning sessions and history", "Sessions of work on a job, moving work without losing the original, end of day review, permanent history and undo.", ["ui:EndOfDay", "ui:PlanningHistory", "ui:usePlanning", "lib:planSessions", "lib:planApply"]),
f("run.plan.timesheet", "run.plan", "Timesheets", "Week and day timesheets on the same time entries as the job timers: activity codes, billable split, planned-session link, unplanned time.", ["ui:Timesheet", "lib:timesheet", "test:timesheet"]),
  f("run.plan.overview", "run.plan", "Work overview and heatmaps", "Client work overview (jobs and tasks counted apart: to do, in progress, waiting on client, blocked, overdue, ready, completed) with a filterable work list and direct actions; practice heatmap of clients against Ready / In progress / Waiting / Blocked / Overdue / At risk with drill-down, sorting and filters, as a list on a phone; workload heatmap by measure (open tasks, remaining, planned now, planned as it stood, actual from timesheet entries, blocked, overdue) by day, week or month.", ["ui:WorkOverview", "ui:ClientWorkOverview", "ui:WorkList", "ui:overviewKit", "lib:work/overview", "test:workOverview"]),
  f("run.plan.risk", "run.plan", "Deadline risk and What can I unblock?", "Deadline risk (on track to overdue) from working days, remaining and actionable hours, outstanding prerequisites and their expected dates, with unknown dates escalated as the deadline nears and never invented. Blocker impact (direct and indirect, hours, deadlines, who has it, follow-up) ranked on the Unblock tab, Action Centre alerts naming the prerequisite, and the five dates shown separately. Statutory deadlines are never changed.", ["ui:Unblock", "ui:riskKit", "lib:work/risk", "test:workRisk"]),
  f("run.plan.deptemplates", "run.plan", "Dependency templates", "Standard relationships between kinds of work (records received → VAT, accounts approved → tax, partnership accounts → partners\u2019 returns, and so on), matched by service, client and period, never by title. Uncertain matches become review items. Applied to open jobs only, automatically when a recurring job is created and on a confirm-first screen for the rest.", ["ui:DependencyTemplates", "ui:templateKit", "lib:work/templates", "test:workTemplates"]),
  f("run.plan.readiness", "run.plan", "Dependencies and readiness", "Dependency panel on tasks and jobs: what the work is waiting on and why, ready / partly ready / blocked / waiting, stage-scoped holds, the chain behind it and the earliest step you can act on, add, override and remove with a reason, integrity checks. Verified-only for client information. Deadlines are never moved.", ["ui:DependencyPanel", "lib:work/readiness", "lib:work/dependencies", "test:workReadiness"]),
  f("run.plan.clientactions", "run.plan", "Client actions and meeting actions", "Share a client action through the portal (with confirmation), see what the client sent, check and accept it (nothing is Done until you do), chase with a logged history and a reminder limit, turn meeting actions into tasks after review, meeting progress, Action Centre items.", ["ui:ClientActionPanel", "lib:work/clientActions", "test:workClientActions", "ui:Meetings"]),
  f("run.plan.quickadd", "run.plan", "Quick Add, mobile capture and install", "Capture a task from anywhere with only a title (Alt+N, the top-bar plus, or the floating Add button on a phone). Files to the client you are on, quick dates, paste several lines, speak a task, share a link from a phone, offline-safe queue, installable app.", ["ui:QuickAdd", "lib:work/capture", "test:workCapture", "app/public/sw.js", "app/public/manifest.webmanifest"]),
  f("run.plan.inbox", "run.plan", "Task Inbox and client tasks", "Quick add with only a title, Inbox triage with bulk edits and undo, bulk paste, a client Tasks tab with filters and grouping, smaller tasks under a task, and client-owned actions with a request-and-verify status path.", ["ui:TaskInbox", "ui:ClientTasks", "ui:taskKit", "ui:TaskDetails", "lib:work/tasks", "test:workTasks"]),
  f("run.plan.work", "run.plan", "Unified task and dependency model (foundations)", "One task model for client, practice, project, personal and client-owned actions; dependency records with cycle checks and history; privacy rules; migration dry run. Pure rules, no screens yet.", ["lib:work/model", "lib:work/dependencies", "lib:work/privacy", "lib:work/migrate", "test:workModel"]),
  f("run.plan.rates", "run.plan", "Rates and value of time", "Effective-dated charge-out and cost rates in pence, with a documented precedence (job, client, person, activity, service, role); fixed-fee contribution.", ["ui:TimeSetup", "lib:rates", "test:timeFinance"]),
  f("run.plan.billing", "run.plan", "Billing recorded time", "Unbilled review, pending-invoice state so time can't be billed twice, billed, write-off and write-down with reasons, all in an append-only time log.", ["ui:TimeBilling", "lib:timeBilling", "test:timeFinance"]),
  f("run.plan.timereports", "run.plan", "Time reports and exports", "My time, planned against actual, rescheduling, utilisation, profitability and estimating accuracy, with CSV and Excel downloads.", ["ui:TimeFinance", "lib:timeReports", "test:timeFinance"]),
  f("run.plan.approval", "run.plan", "Timesheet approval and permissions", "Optional submit/approve/return with locked approved time, roles and permissions enforced in the data layer, and everyone's planned time.", ["lib:timeApproval", "lib:permissions", "ui:useTimeFinance", "test:timeFinance"]),
  f("run.plan.timecheck", "run.plan", "Time data check", "Read-only check for orphans, duplicates, broken links and typed-versus-recorded hours (dry run of the bring-in).", ["lib:timeCheck", "test:timeFinance"]),
f("run.plan.progress", "run.plan", "Job progress and readiness", "What is left (your own figure), partly ready work, blocked hours that take no planning time, over-budget prompts.", ["ui:ProgressSection", "lib:jobProgress", "test:jobProgress"]),
f("run.plan.reconcile", "run.plan", "End of day reconciliation and suggested sessions", "The day as planned and as it went, dates changed outside the review, waiting outcome, capacity-aware suggested sessions.", ["lib:planReconcile", "test:planReconcile"]),
f("run.plan.calendar", "run.plan", "Outlook calendar", "Meetings reduce each day's hours; planned work is kept in the calendar.", ["ui:Calendar", "lib:calendar", "test:calendar"]);
f("run.plan.routines", "run.plan", "Routine work", "Weekly and monthly routines that repeat.", ["ui:Routines", "lib:routines", "test:routines"]);
f("run.plan.projects", "run.plan", "Business projects", "Work on the practice itself (marketing, systems, recruiting).", ["ui:ProjectsView", "lib:projects", "test:projects"]);
f("run.plan.checks", "run.plan", "Planner checks", "Things that can be wrong in the planner itself.", ["lib:plannerChecks", "test:plannerChecks"]);
f("run.plan.waiting", "run.plan", "Waiting for the client", "Stages where the work is with the client.", ["lib:waiting", "test:waiting"]);

mod("run.actions", "run", "Action Centre", "Everything needing someone to act.", "P3");
f("run.actions.centre", "run.actions", "Action Centre", "Grouped list of what needs doing across modules.", ["ui:ActionCentre", "lib:actions", "test:actions"], { n: ["Check statuses and overdue actions match the planner on real data (first milestone)"] });
f("run.actions.alerts", "run.actions", "Alert notification delivery", "Sending alerts out (email or push). The screen records preferences; nothing is delivered yet.", [], { s: "PL", notes: "Preferences screen exists in ActionCentre.tsx; delivery is not built." });
f("run.actions.chase", "run.actions", "Chasing records", "Clients whose records are due or late, with an email and a log of each chase.", ["ui:ChasePage", "lib:chase", "test:chase"]);

mod("run.clients", "run", "Clients and groups", "The client list, client page and everything kept about a client.", "P3");
f("run.clients.list", "run.clients", "Client list and filters", "Search, saved views, export, email lists.", ["ui:ClientsPage", "ui:ClientFilters", "lib:clientFilter", "test:clientFilter"]);
f("run.clients.page", "run.clients", "Client page", "Work, papers, numbers, comms, tax, activity and timeline tabs for one client.", ["ui:ClientPage", "ui:ClientExtras", "lib:workGroups", "test:workGroups"]);
f("run.clients.groups", "run.clients", "Groups", "Clients grouped together, with roles.", ["ui:App"], { s: "ID", notes: "The groups screen lives in App.tsx; no separate tests." });
f("run.clients.fields", "run.clients", "Your own fields", "Practice-defined fields on clients and jobs.", ["ui:CustomFields", "lib:customFields", "test:customFields"]);
f("run.clients.bulk", "run.clients", "Bulk email and forms", "One email or form to many clients.", ["ui:ClientBulk", "lib:bulk", "test:bulk"]);
f("run.clients.ch", "run.clients", "Companies House checks", "Daily checks of accounts and CS01 due dates and officers.", ["ui:CompaniesHouse", "lib:companiesHouse", "api:ch", "test:companiesHouse", "apitest:ch"]);
f("run.clients.aml", "run.clients", "AML risk assessment", "A client's own AML risk rating and what it rests on.", ["ui:AmlTab", "lib:amlAssessment", "test:amlAssessment"]);
f("run.clients.xama", "run.clients", "Xama AML checks", "Create, verify and read AML results from Xama.", ["ui:XamaSettings", "ui:XamaClientPanel", "lib:xama", "lib:xamaActions", "lib:xamaSync", "api:xama", "test:xamaActions", "test:xamaSync", "apitest:xama"], { d: ["acc.xama"], notes: "Built against Xama's published guide; live entitlement and scopes not confirmed." });
f("run.clients.clearance", "run.clients", "Professional clearance", "Asking the previous accountant if there is any reason not to act.", ["ui:Clearance", "ui:ClearancePoints", "lib:clearance", "test:clearance"]);
f("run.clients.disengage", "run.clients", "Ceasing to act", "A letter ending an engagement.", ["ui:Disengage", "lib:disengage", "test:disengage"]);
f("run.clients.conflicts", "run.clients", "Conflict checks", "Checking for conflicts of interest.", ["ui:Conflicts"]);
f("run.clients.timeline", "run.clients", "Client timeline", "One timeline of letters, emails and events.", ["ui:Timeline", "lib:timeline", "lib:timelineMail", "test:timeline"]);
f("run.clients.engager", "run.clients", "Engager import", "One-off import of the old system's exports.", ["lib:importer", "root:scripts/import/import_engager.py"], { s: "ID", notes: "One-off tool; client data is never committed." });
f("run.clients.logo", "run.clients", "Client logos", "Logo stored with the client record.", ["lib:logo", "lib:logoSize", "test:logoSize"]);
f("run.clients.numbers", "run.clients", "Client numbers and tax references", "Tax references grouped by tax; key figures on the client page.", ["ui:ClientNumbers", "ui:TaxRefs", "lib:taxRefs", "test:taxRefs"]);

mod("run.jobs", "run", "Jobs", "Jobs, stages and roll-forward.", "P3");
f("run.jobs.model", "run.jobs", "Jobs and stages", "One open job per client service, stages with people and budgets.", ["lib:domain", "lib:stages", "lib:planning", "test:planning", "test:data"]);
f("run.jobs.roll", "run.jobs", "Roll-forward on completion", "Completing a job creates the next period's job and dates.", ["lib:planning", "test:planning"]);
f("run.jobs.stagemail", "run.jobs", "Stage emails to the client", "An email when a stage is finished.", ["ui:StageMail", "lib:stageMail", "test:stageMail"]);
f("run.jobs.subtasks", "run.jobs", "Subtasks", "A checklist kept on a task.", ["lib:subtasks"], { s: "ID" });
f("run.jobs.recurring", "run.jobs", "Recurring work rules", "Deadline rules and recurrence per type of work.", ["lib:planning", "ui:SettingsPage", "test:planning"]);

mod("run.checks", "run", "Checklists", "Job checklists and templates.", "P3");
f("run.checks.templates", "run.checks", "Checklist templates", "Templates and the rules that decide which items apply.", ["ui:ChecklistTemplates", "lib:checklist", "test:checklist", "test:checklistData"]);
f("run.checks.job", "run.checks", "Job checklist", "The checklist a job carries, with snapshot and rows.", ["ui:JobChecklist", "ui:Checklists", "lib:checklistRows", "test:checklistRows"]);
f("run.checks.starters", "run.checks", "Starter checklists", "Example workflows to edit or replace.", ["lib:checklistStarters", "test:checklist"]);

mod("run.comms", "run", "Communications", "Letters, email, meetings, forms and the assistant.", "P3");
f("run.comms.letters", "run.comms", "Letters and emails", "Merge details around text; templates; sending.", ["ui:Comms", "ui:commsKit", "lib:comms", "test:comms"]);
f("run.comms.timeline", "run.comms", "Communication timeline", "Everything said to or by the client.", ["lib:commsTimeline", "test:commsTimeline"]);
f("run.comms.mail", "run.comms", "Mail screen", "Outlook folders and messages with client emails picked out.", ["ui:MailPage", "lib:mailbox", "test:mailbox"]);
f("run.comms.suggest", "run.comms", "Email suggestions", "Picks out emails that probably need action.", ["ui:EmailSuggestions", "lib:emailTasks", "test:emailTasks"]);
f("run.comms.meetings", "run.comms", "Meetings and calls", "Agendas from a template; notes under each item.", ["ui:Meetings", "lib:meetings"], { s: "ID" });
f("run.comms.forms", "run.comms", "Forms and information requests", "Staff-side forms sent to clients.", ["ui:Forms", "lib:forms", "test:forms"]);
f("run.comms.ai", "run.comms", "AI writing and assistant", "Drafts and amends letters; chat assistant that sees only a snapshot.", ["ui:Assistant", "lib:ai", "lib:assist", "api:ai", "test:assist", "apitest:ai"]);
f("run.comms.richtext", "run.comms", "Rich text editor", "Bold, lists and headings in letters.", ["ui:RichField", "lib:richText"], { s: "ID" });

mod("run.portal", "run", "Client portal", "The client-facing portal and its staff side.", "P3");
f("run.portal.server", "run.portal", "Portal server", "Everything a portal user does goes through api/portal.", ["api:portal", "apitest:portal", "apitest:portalAcceptance", "doc:client-portal"], { notes: "Separate sign-in from the staff app; the Development Hub is not exposed through it." });
f("run.portal.admin", "run.portal", "Portal administration", "Staff side: invite users, see what is waiting.", ["ui:PortalAdmin", "lib:portalAdmin", "test:portalSchema", "apitest:portalIdentity"]);
f("run.portal.docs", "run.portal", "Portal documents and signing", "Document exchange and e-signing with sealed PDFs.", ["ui:PortalDocuments", "ui:SigningRequests", "lib:signingView", "api:portal/lib/signing.js", "apitest:portalSigning", "apitest:portalDocuments", "test:signingView"]);
f("run.portal.messages", "run.portal", "Portal messages and requests", "Messages and information requests with clients.", ["ui:PortalMessages", "ui:PortalRequests", "apitest:portalMessages"]);
f("run.portal.identity", "run.portal", "Identity checks", "ID documents with staff checking.", ["ui:PortalIdentity", "apitest:portalIdentity"], { notes: "Retention, deletion and virus scanning are not built." });
f("run.portal.brand", "run.portal", "Portal branding, offers and reminders", "Branding, offers, reminder schedules, change requests.", ["ui:PortalBranding", "apitest:portalBranding", "apitest:portalOffers", "apitest:portalReminders", "apitest:portalChanges", "test:portalBranding"]);
f("run.portal.retention", "run.portal", "Portal retention and deletion", "Removing old files and identity documents.", [], { s: "PL", notes: "Listed as 'not yet' in docs/client-portal.md." });

mod("run.sales", "run", "Sales and onboarding", "Lead to client.", "P3");
f("run.sales.pipeline", "run.sales", "Leads and pipeline", "Leads, opportunities and the pipeline.", ["ui:SalesPage", "ui:SalesSettings", "lib:sales", "test:sales"]);
f("run.sales.proposals", "run.sales", "Proposals", "Service catalogue, prices, proposal versions and secure links.", ["ui:ProposalsPage", "lib:proposals", "lib:proposalLinks", "test:proposals", "test:proposalLinks"]);
f("run.sales.letters", "run.sales", "Engagement letters", "Letter template, schedules of services, gaps for existing clients.", ["ui:EngagementsPage", "ui:EngagementSettings", "ui:LetterGaps", "lib:engagements", "lib:letterGaps", "lib:letterSections", "lib:letterDefaults", "test:engagements", "test:letterGaps", "test:letterTemplate", "test:letters"]);
f("run.sales.onboarding", "run.sales", "Onboarding", "Accepted prospect to active client, with AML.", ["ui:OnboardingPage", "ui:OnboardingSettings", "lib:onboarding", "test:onboarding", "test:lifecycle"]);
f("run.sales.reports", "run.sales", "Sales and onboarding reports", "Basic reporting over leads and onboarding.", ["ui:ReportsPage", "lib:reports", "test:reports"]);

mod("run.fees", "run", "Fees and billing", "Fees, pricing, billing and collections.", "P3");
f("run.fees.fees", "run.fees", "Fee schedules and costs", "Each client's fees, agreed revenue and direct costs.", ["ui:FeesPanel", "lib:fees", "test:fees"]);
f("run.fees.pricing", "run.fees", "Pricing rules", "Suggested fee from a client's own figures.", ["ui:Pricing", "ui:ServicesEditor", "lib:pricing", "test:pricing"]);
f("run.fees.catchup", "run.fees", "Catch-up fees", "Charging for a backlog when a client joins behind.", ["lib:catchup", "test:pricing"]);
f("run.fees.adfin", "run.fees", "Adfin recurring billing", "Recurring fee lines to Adfin invoices and direct debit.", ["ui:Billing", "lib:adfin", "lib:billing", "api:adfin", "test:billing", "apitest:adfin"], { d: ["acc.adfin"] });
f("run.fees.collections", "run.fees", "Collections", "From invoice to money in the bank.", ["ui:Collections", "lib:collections", "test:collections"]);

mod("run.ops", "run", "Practice operations", "Sign-in, data layer, backups, risk, settings and tooling.", "P1");
f("run.ops.auth", "run.ops", "Microsoft 365 sign-in", "Authorisation-code flow with PKCE, tokens in session storage.", ["lib:auth", "root:app/src/config.ts", "doc:setup-microsoft"], { s: "ID", notes: "No automated tests. Needs checking against the production tenant." , n: ["Verify Entra sign-in and permissions for the real tenant"] });
f("run.ops.sharepoint", "run.ops", "SharePoint data layer", "Lists read and written through Microsoft Graph; list creation.", ["lib:sharepoint", "lib:graph", "lib:schema", "ui:data", "test:data"], { n: ["Test create/update/delete, throttling, concurrency and failed-save handling on the real site", "Check cross-list consistency"] });
f("run.ops.save", "run.ops", "Saving and failed-write recovery", "Pending writes, retries and the message when a save fails.", ["ui:data", "ui:ErrorBoundary", "ui:SettingsPage"], { s: "ID", notes: "Issues #1 and #2 changed save diagnostics; no end-to-end failure test exists.", n: ["Demonstrate failure recovery without loss"] });
f("run.ops.backup", "run.ops", "Backups and restore", "Excel copy of every list to OneDrive daily and on demand.", ["ui:Backups", "lib:backup", "lib:xlsx", "lib:xlsxRead", "test:backup"], { n: ["Complete a restore rehearsal to an isolated test target (restore is not proven)"], notes: "Export is tested; restoring from a backup has not been rehearsed." });
f("run.ops.errors", "run.ops", "Error handling", "Error boundary and problem log.", ["ui:ErrorBoundary"], { s: "ID" });
f("run.ops.perms", "run.ops", "Permissions", "Who can do what in the app.", ["lib:sharepoint"], { s: "ID", notes: "Single-user practice; there is no role model. Portal permissions are separate and tested." });
f("run.ops.compliance", "run.ops", "Practice compliance and risk", "The firm's own recurring dates, data requests, breaches and complaints.", ["ui:CompliancePage", "lib:compliance", "test:compliance"]);
f("run.ops.settings", "run.ops", "Firm settings", "Week, firm details, types of work, services, document design.", ["ui:SettingsPage", "ui:FirmSettings", "ui:ServicesSettings"], { s: "ID" });
f("run.ops.mcp", "run.ops", "MCP server for bots", "Lets bots read and change planner data with their own keys.", ["api:mcp", "apitest:mcp", "test:mcpSchema"]);
f("run.ops.demo", "run.ops", "Demo build and fakes", "In-memory stand-ins for Graph, Companies House, Xero and Xama.", ["lib:fakeGraph", "lib:fakeCh", "lib:fakeXero", "lib:fakeXama"], { s: "ID" });
f("run.ops.search", "run.ops", "Global search", "Searching clients and work from anywhere.", ["ui:Search", "ui:searchScore.ts"], { s: "ID" });
f("run.ops.devhub", "run.ops", "Development Hub", "This section: inventory, mind map, board, roadmap, approvals and decisions.", ["ui:DevHub", "ui:DevHubMap", "ui:DevHubBoard", "ui:DevHubRegisters", "ui:devHubKit", "doc:development-hub", "lib:devHub", "lib:devHubSeed", "api:devhub", "test:devHub", "apitest:devhub"], { s: "TE", notes: "Built 6 November 2026. GitHub write access is untested against the real repository until a token is added to Azure.", p: "None" });

// =================================================================== DELIVER WORK
area("deliver", "Work", "Bookkeeping, working papers, accounts, tax, payroll, company secretarial, documents and filing.");

mod("deliver.book", "deliver", "Bookkeeping", "Bringing in and keeping clients' books.", "P2");
f("deliver.book.xero", "deliver.book", "Xero integration", "Read a client's books from Xero through the server bridge.", ["ui:XeroSettings", "ui:XeroImport", "lib:xero", "api:xero", "test:xero", "apitest:xero"], { d: ["acc.xero"], n: ["Confirm scopes, connection limits and tier"], notes: "Read-only by design. Needs the real Xero app credentials." });
f("deliver.book.ledger", "deliver.book", "Xero ledger and invoices", "Transactions with filters; the client's invoices tab.", ["ui:XeroLedger", "ui:XeroInvoices", "lib:xeroViews", "lib:xeroInvoices", "lib:xeroGlance", "test:xeroViews", "test:xeroInvoices", "test:xeroGlance"]);
f("deliver.book.bank", "deliver.book", "Bank statement import", "Reads a statement (text or PDF) for manual-records clients.", ["lib:bankStatement", "lib:pdfText", "test:bankStatement"]);
f("deliver.book.journal", "deliver.book", "Quick journal", "A journal keyed in from a panel over any working paper.", ["ui:QuickJournal", "lib:quickJournal", "test:quickJournal"]);
f("deliver.book.expense", "deliver.book", "Expense rules", "Rules for recognising expenses.", ["test:expenseRules"], { s: "ID" });

mod("deliver.recs", "deliver", "Monthly reconciliations", "Month-end bank, debtor and creditor control.", "P2");
f("deliver.recs.sections", "deliver.recs", "Reconcile sections to the trial balance", "Each working paper section tied back to the TB.", ["ui:PaperSchedules", "lib:paperRecon", "test:paperRecon", "test:paperReconPanel"]);
f("deliver.recs.checklist", "deliver.recs", "Reusable monthly reconciliation checklist", "A month-end checklist with carry-forward.", [], { s: "PL", notes: "Called for in issue #6; not built." });
f("deliver.recs.pack", "deliver.recs", "Month-end packs", "A monthly pack for monthly clients.", [], { s: "PL", d: ["grow.report.builder"] });

mod("deliver.papers", "deliver", "Working papers", "Annual working papers, built from the Excel working paper.", "P2");
f("deliver.papers.core", "deliver.papers", "Working papers", "Per company per year-end: sections, schedules and sign-off.", ["ui:PapersPage", "ui:AccountsWorkingPapers", "ui:ClientPapers", "lib:papers", "test:papers"]);
f("deliver.papers.lead", "deliver.papers.core", "Lead schedules", "Bank, debtors, creditors, VAT, payroll, loans and accruals.", ["ui:PaperSchedules", "lib:papers", "test:papers"]);
f("deliver.papers.fa", "deliver.papers.core", "Fixed asset schedule", "Fixed assets with reconciliation to the TB.", ["lib:paperRecon", "test:paperRecon"]);
f("deliver.papers.open", "deliver.papers", "Opening balances", "Position at the start of the year from last year's closing balance sheet.", ["ui:OpeningBalances", "lib:openingBalances", "test:openingBalances"]);
f("deliver.papers.import", "deliver.papers", "Workbook and TB import", "Excel working paper workbooks and trial balances.", ["ui:PaperImport", "lib:workbookImport", "test:workbookImport", "test:priorTb"]);
f("deliver.papers.map", "deliver.papers", "Account mapping", "Each account mapped to an IRIS Elements code.", ["lib:tbMap", "test:tbMap"]);
f("deliver.papers.iris", "deliver.papers", "IRIS Elements export", "Mapped final TB as a CSV.", ["lib:irisExport", "lib:elements", "ui:ElementsImport", "test:irisExport", "test:elements"]);
f("deliver.papers.signoff", "deliver.papers", "Review and sign-off", "Prepared/reviewed sign-off and outstanding queries.", ["ui:PapersPage", "lib:papers"], { s: "ID", n: ["Outstanding query management is not built (issue #6)"] });

mod("deliver.accts", "deliver", "Accounts preparation", "Statutory accounts from the working papers.", "P2");
f("deliver.accts.setup", "deliver.accts", "Accounts setup and screens", "Setup kept per company and year; accounts screen.", ["ui:AccountsScreen", "lib:accounts", "test:accounts"]);
f("deliver.accts.status", "deliver.accts", "Accounts production status", "Where each company's accounts have got to.", ["ui:AccountsProduction", "lib:accountsStatus", "test:accountsStatus"]);
f("deliver.accts.review", "deliver.accts", "Accounts review", "Reviewing the draft accounts.", ["ui:AccountsReview"], { s: "ID" });
f("deliver.accts.client", "deliver.accts", "Client review and deck", "Draft accounts talked through, and as a PowerPoint deck.", ["ui:ClientDeck", "ui:DeckSlide", "lib:clientReview", "lib:deck", "lib:deckFigures", "lib:deckPlan", "lib:deckPptx", "test:clientReview", "test:deck", "test:deckPlan", "test:deckPptx"]);
f("deliver.accts.pl", "deliver.accts", "iXBRL profit and loss builder", "Statement lines and cost detail from the final TB; FRC elements marked unchecked.", ["ui:DetailedPlSettings", "lib:plTags", "test:plTags"], { p: "P5", b: ["FRC elements are not verified against the taxonomy"] });
f("deliver.accts.ixbrl", "deliver.accts", "Full iXBRL accounts", "Balance sheet, notes and a validated iXBRL file.", [], { s: "PL", p: "P5", d: ["deliver.accts.pl"], notes: "Documented as a limitation in the HMRC filing report." });

mod("deliver.pt", "deliver", "Personal tax", "Self Assessment returns and computations.", "P5");
f("deliver.pt.comp", "deliver.pt", "Tax computation", "A return for one person and tax year, with the computation.", ["ui:TaxPage", "lib:tax", "lib:taxRates", "test:tax"], { n: ["Check the planner's SA110 figures against HMRC's own calculation"] });
f("deliver.pt.sa100", "deliver.pt", "SA100 form and preflight", "The SA100 as HMRC prints it; checks before it goes anywhere.", ["lib:sa100", "lib:sa100Preflight", "test:sa100", "test:sa100Preflight"]);
f("deliver.pt.import", "deliver.pt", "Past return import", "Reading past returns from IRIS PDFs, with the AI reading and a check.", ["ui:TaxBulkImport", "ui:TaxReturnView", "lib:taxImport", "lib:taxFile", "lib:taxRead", "lib:taxReturnRead", "test:taxImport", "test:taxRead", "test:taxReturnRead", "test:taxPast"]);
f("deliver.pt.pay", "deliver.pt", "Tax payments", "Balancing payments, payments on account and CT.", ["ui:TaxPayments", "lib:taxPayments", "test:taxPayments"]);
f("deliver.pt.account", "deliver.pt", "HMRC account import", "Payments, credits and charges pasted from the agent services page.", ["ui:HmrcAccountImport", "lib:hmrcAccount", "test:hmrcAccount"]);
f("deliver.pt.cosec", "deliver.pt", "Dividends from Co Sec into tax", "Co Sec dividends feed the shareholder's return.", ["lib:taxCosec", "test:taxCosec"]);
f("deliver.pt.partner", "deliver.pt", "Partnership tax (SA800)", "Short trading route and partner shares.", ["api:filing/lib/sa800.js", "apitest:sa800"], { p: "P5", notes: "XML builder only; not submitted to HMRC." });

mod("deliver.ct", "deliver", "Corporation tax", "CT600 and computations.", "P5");
f("deliver.ct.ct600", "deliver.ct", "CT600 builder", "HMRC CT RIM pack V1.994, XML builder and a computation for simple companies.", ["api:filing/lib/ct600.js", "apitest:ct600"], { b: ["Not submitted to HMRC; needs Vendor ID and test credentials", "Computation covers simple companies only"], d: ["acc.hmrc.vendor"] });
f("deliver.ct.comp", "deliver.ct", "Corporation tax computation screen", "Screen for computing and reviewing CT.", [], { s: "PL", notes: "The computation exists in the API builder; there is no staff screen for it yet." });

mod("deliver.vat", "deliver", "VAT and CIS", "VAT agent authorisation and CIS.", "P5");
f("deliver.vat.auth", "deliver.vat", "HMRC agent authorisations", "Authorisation tracking for CT, PAYE and VAT (MTD).", ["ui:HmrcSettings", "lib:hmrc", "lib:hmrcAuth", "api:hmrc", "test:hmrcAuth", "apitest:hmrc", "doc:hmrc-authorisation-feasibility"], { b: ["HMRC sandbox untested"], d: ["acc.hmrc.hub"], p: "P5" });
f("deliver.vat.cis", "deliver.vat", "CIS contractor registration", "What HMRC asks for when registering a client as a CIS contractor.", ["ui:CisCard", "lib:cis", "test:cis"]);
f("deliver.vat.returns", "deliver.vat", "VAT returns", "Preparing and submitting VAT returns (MTD).", [], { s: "PL" });

mod("deliver.pay", "deliver", "Payroll", "PAYE payroll, statutory pay, pensions and RTI.", "P2");
f("deliver.pay.engine", "deliver.pay", "Payroll calculations", "PAYE tax by code, NI, student loans for one pay period.", ["ui:Payroll", "lib:payroll/engine.ts", "test:payrollEngine"]);
f("deliver.pay.statutory", "deliver.pay", "Statutory pay", "SSP, maternity, adoption, paternity and related.", ["lib:payroll/statutory.ts", "test:payrollStatutory"]);
f("deliver.pay.pension", "deliver.pay", "Automatic enrolment", "Who must be enrolled and opt-outs.", ["lib:payroll/autoEnrol.ts", "test:payrollMore"]);
f("deliver.pay.orders", "deliver.pay", "Court and council orders", "Attachments of earnings and similar.", ["lib:payroll/orders.ts", "test:payrollMore"]);
f("deliver.pay.records", "deliver.pay", "Payroll records", "PAYE scheme, people, pay year.", ["lib:payroll/records.ts", "test:payrollRecords"]);
f("deliver.pay.forms", "deliver.pay", "P60 and leaver documents", "End-of-year and leaver forms.", ["lib:payroll/forms.ts", "test:payrollMore"]);
f("deliver.pay.rti", "deliver.pay", "RTI FPS and EPS", "Builds FPS and EPS to the 2026-27 schema; GovTalk bridge in test mode by default.", ["lib:payroll/rti.ts", "lib:payroll/rtiClient.ts", "api:rti", "test:payrollRti", "apitest:rti"], { s: "BL", b: ["Not sent to HMRC live; needs recognition, Vendor ID and test credentials"], d: ["acc.hmrc.vendor"], p: "P5" });

mod("deliver.cosec", "deliver", "Company secretarial", "Statutory registers, shares, officers, dividends and Companies House forms.", "P3");
f("deliver.cosec.overview", "deliver.cosec", "Co Sec portfolio and overview", "Each company's dates; directors, shareholders and dividends.", ["ui:CoSecPage", "ui:CoSecOverview", "ui:CoSecCompany", "lib:portfolio", "lib:cosecOverview", "lib:cosecProfile", "test:portfolio", "test:cosecOverview", "test:cosecProfile"]);
f("deliver.cosec.ledger", "deliver.cosec", "Share ledger and registers", "Source of truth for holdings; registers at any date.", ["ui:CoSecCapital", "lib:shareLedger", "lib:cosecRegisters", "lib:cosecShares", "test:shareLedger", "test:cosecRegisters", "test:cosecShares"]);
f("deliver.cosec.certs", "deliver.cosec", "Share certificates", "Numbered certificates, never reused.", ["lib:cosecCertificates", "lib:cosecDocs", "test:cosecCertificates"]);
f("deliver.cosec.div", "deliver.cosec", "Dividends", "Dividend calculations in whole pence.", ["lib:cosecDividends", "test:cosecDividends"]);
f("deliver.cosec.cs01", "deliver.cosec", "Confirmation statement review", "Guided CS01 review from the company's records.", ["ui:CoSecCs01", "lib:cosecCs01", "test:cosecCs01"]);
f("deliver.cosec.dormant", "deliver.cosec", "Dormant accounts", "Prepare and track dormant company accounts.", ["ui:CoSecAccounts", "lib:cosecDormant", "test:cosecDormant"]);
f("deliver.cosec.approval", "deliver.cosec", "Client approval of transactions", "Approval through the portal.", ["ui:CoSecApproval", "lib:cosecApproval", "test:cosecApproval"]);
f("deliver.cosec.import", "deliver.cosec", "Historical imports", "From spreadsheets, CSV and register PDFs.", ["ui:CoSecImport", "lib:cosecImport", "test:cosecImport"]);
f("deliver.cosec.chart", "deliver.cosec", "Ownership chart", "Drawn from the share ledger.", ["ui:CoSecChart", "lib:ownershipChart", "test:ownershipChart"]);
f("deliver.cosec.forms", "deliver.cosec", "Companies House forms", "Forms the planner prepares (AD01, TM01 and others); filing fees schedule.", ["ui:CoSecFoundation", "ui:CoSecSettings", "lib:cosecForms", "lib:cosecFees", "api:cosec/lib/forms.js"], { s: "ID", notes: "Form preparation has no dedicated unit test file in app/tests; API tests cover cosec." });
f("deliver.cosec.detect", "deliver.cosec", "Change detection", "A change on the client record prepares the matching filing as a draft.", ["doc:co-sec-filing", "doc:cosec-phases-2-7-report"], { s: "ID" });

mod("deliver.docs", "deliver", "Documents", "The document designer, templates and PDF/Word output.", "P3");
f("deliver.docs.model", "deliver.docs", "Document model and templates", "Blocks, merge fields, templates and branding.", ["ui:DocEditor", "ui:DocsTemplates", "ui:DocsCreate", "ui:docsKit.ts", "lib:docModel", "lib:docTemplates", "lib:docFields", "lib:docBranding", "test:docModel", "test:docTemplates", "test:docFields", "test:docsKit"]);
f("deliver.docs.pdf", "deliver.docs", "PDF and Word output", "One content model rendered to PDF and .docx.", ["ui:DocsPreview", "lib:docPdf", "lib:docWord", "lib:docx", "test:docPdf", "test:docWord", "test:docRobust"]);
f("deliver.docs.design", "deliver.docs", "Document design and branding", "How each kind of PDF looks.", ["ui:DocDesign", "ui:DocsBranding", "lib:docDesign", "test:docDesign"]);
f("deliver.docs.store", "deliver.docs", "Document storage", "Documents attached to clients.", ["ui:Documents"], { s: "ID" });

mod("deliver.filing", "deliver", "Statutory filing", "Getting returns to HMRC and Companies House.", "P5");
f("deliver.filing.infra", "deliver.filing", "HMRC filing infrastructure", "Records of a return's journey; version lock; GovTalk envelope.", ["ui:HmrcFiling", "lib:hmrcFiling", "lib:filingApi", "api:filing", "api:filing/lib/govtalk.js", "api:filing/lib/gate.js", "test:hmrcFiling", "test:hmrcFilingPanel", "apitest:filing", "doc:hmrc-filing"], { b: ["Nothing has been tested against HMRC"], d: ["acc.hmrc.vendor"] });
f("deliver.filing.sa100", "deliver.filing", "SA100 submission", "Personal details, SA103S and SA110 as XML.", ["api:filing/lib/sa100.js", "apitest:sa100"], { s: "BL", b: ["Awaiting HMRC Vendor ID and External Test Service credentials", "Other SA pages not covered"], d: ["acc.hmrc.vendor", "acc.hmrc.test"] });
f("deliver.filing.ct600", "deliver.filing", "CT600 submission", "CT600 and iXBRL attachments to HMRC.", ["api:filing/lib/ct600.js", "apitest:ct600"], { s: "BL", b: ["Needs iXBRL accounts and computation", "Awaiting HMRC credentials"], d: ["deliver.accts.ixbrl", "acc.hmrc.vendor"] });
f("deliver.filing.ch", "deliver.filing", "Companies House AD01 gateway", "The planner's side of a filing to Companies House.", ["lib:cosecGateway", "api:cosec/lib/gateway.js", "apitest:cosec", "doc:co-sec-filing"], { s: "BL", b: ["Blocked by configuration and unproven", "Needs a test account and presenter details"], d: ["acc.ch.test", "acc.ch.presenter"] });
f("deliver.filing.cs01", "deliver.filing", "Companies House CS01 submission", "Submitting a confirmation statement.", [], { s: "BL", b: ["Companies House technical specification not available when audited"], d: ["acc.ch.test"], notes: "See docs/cosec-phases-2-7-report.md (limitations)." });

// =================================================================== GROW & ADVISE
area("grow", "Advise", "Reporting, analysis, forecasting, tax planning and advice for clients.");

mod("grow.report", "grow", "Financial reporting", "The reporting centre, reports and the report builder.", "P4");
f("grow.report.centre", "grow.report", "Reporting centre", "Per-client reporting from Xero with Refresh; analysis tools and settings.", ["ui:ReportingPage", "ui:ReportingSettings", "lib:reportData", "test:reportData"], { d: ["deliver.book.xero"], notes: "Not yet checked on a real Xero client." });
f("grow.report.builder", "grow.report", "Report builder", "Cover and sections of text, charts, tables, key numbers; publish to HTML/PDF.", ["ui:ReportingReports", "ui:ReportingComponents", "ui:ReportingThumbs", "lib:reportBuilder", "lib:reportComponents", "test:reportBuilder", "test:reportComponents"], { n: ["Check on a real client", "Logo upload for the cover (text wordmark now)", "Restyle the Reports list and Create dialog"] });
f("grow.report.aged", "grow.report", "Aged receivables and payables", "Who owes the client and whom the client owes.", ["ui:ReportingAged", "lib:aged", "test:aged"], { n: ["Past-date ageing is not built"] });
f("grow.report.analysis", "grow.report", "Analysis tools", "Cash flow waterfall, growth trail and month analyses.", ["ui:ReportingAnalysis", "ui:ReportingExplorer", "lib:analysis", "test:analysis"]);
f("grow.report.excel", "grow.report", "Excel export of published reports", "Download a report's figures as Excel.", [], { s: "PL" });
f("grow.report.media", "grow.report", "Files and media in reports", "Attach files and images to a report.", [], { s: "PL" });
f("grow.report.alerts", "grow.report", "Report and KPI alert delivery", "Notifications when a KPI crosses a threshold.", [], { s: "PL" });

mod("grow.kpi", "grow", "KPIs", "Key performance indicators against targets.", "P4");
f("grow.kpi.kpis", "grow.kpi", "KPI results and targets", "Each KPI from monthly P&L and balance sheet against a target.", ["ui:ReportingKpis", "lib:kpis", "test:kpis"]);

mod("grow.cash", "grow", "Cash-flow forecasting", "Looking forward at cash.", "P4");
f("grow.cash.waterfall", "grow.cash", "Cash flow analysis", "Cash flow waterfall from actual figures.", ["ui:ReportingAnalysis", "lib:analysis", "test:analysis"], { notes: "Backward-looking only." });
f("grow.cash.forecast", "grow.cash", "Cash-flow forecast", "A forward cash forecast per client.", [], { s: "PL", notes: "Screenshots for the reporting 'Forecast' section are awaited." });

mod("grow.profit", "grow", "Profitability analysis", "Breakeven and margins.", "P4");
f("grow.profit.breakeven", "grow.profit", "Breakeven and goal seek", "The breakeven picture and levers for a target.", ["ui:ReportingProfitability", "lib:profitability", "test:profitability"]);

mod("grow.budget", "grow", "Budgets and forecasts", "Budgets and rolling forecasts for clients.", "P4");
f("grow.budget.budget", "grow.budget", "Client budgets", "Annual budgets by month against actuals.", [], { s: "PL" });
f("grow.budget.forecast", "grow.budget", "Forecast section", "Forecast tool in the reporting centre.", [], { s: "PL", notes: "Waiting for screenshots from the practice." });

mod("grow.adv", "grow", "Advisory planning", "The Freedom Plan and advisory workflow.", "P4");
f("grow.adv.plan", "grow.adv", "Advisory Freedom Plan", "Advisory hub from Kevin's workbook.", ["ui:AdvisoryPage", "ui:AdvisoryTabs", "ui:advisoryKit", "lib:advisory", "test:advisory"]);

mod("grow.tax", "grow", "Tax planning", "Salary and dividend planning for owner-managed companies.", "P4");
f("grow.tax.plan", "grow.tax", "Owner-manager tax planner", "How a company's profit should reach the people who own and run it.", ["ui:TaxPlanning", "lib:taxPlanning", "lib:taxPlanExample", "test:taxPlanning"]);
f("grow.tax.letter", "grow.tax", "Tax plan letter", "The client's copy of an agreed plan.", ["lib:taxPlanLetter", "test:taxPlanning"]);

mod("grow.mgmt", "grow", "Management reports", "Management accounts and review packs.", "P4");
f("grow.mgmt.reports", "grow.mgmt", "Published management reports", "Reports published from the builder.", ["ui:ReportingReports", "lib:reportBuilder", "test:reportBuilder"]);
f("grow.mgmt.packs", "grow.mgmt", "Management accounts and client review packs", "Standard monthly and annual review packs.", [], { s: "PL", d: ["grow.report.builder"] });

mod("grow.opps", "grow", "Client advisory opportunities", "Spotting and tracking advice to sell.", "P4");
f("grow.opps.find", "grow.opps", "Business opportunities", "Finding and tracking advisory opportunities from client data.", [], { s: "PL" });

export const SEED_FEATURES: Feature[] = rows;

// =================================================================== ROADMAP

const ids = (...x: string[]) => x;
export const SEED_ROADMAP: RoadmapPriority[] = [
  { id: "P1", title: "Priority 1: Core Reliability", issue: 4, items: [
    { name: "Microsoft 365 authentication", features: ids("run.ops.auth") },
    { name: "SharePoint access", features: ids("run.ops.sharepoint") },
    { name: "Saving and data integrity", features: ids("run.ops.save") },
    { name: "Error handling", features: ids("run.ops.errors") },
    { name: "Permissions", features: ids("run.ops.perms") },
    { name: "Backups and restores", features: ids("run.ops.backup") },
    { name: "Application stability", features: ids("run.ops.save", "run.ops.errors", "run.ops.sharepoint") },
  ] },
  { id: "P2", title: "Priority 2: Accounts & Working Papers", issue: 6, items: [
    { name: "Trial balance imports", features: ids("deliver.papers.import") },
    { name: "Xero integration", features: ids("deliver.book.xero", "deliver.book.ledger") },
    { name: "Account mapping", features: ids("deliver.papers.map") },
    { name: "Monthly reconciliations", features: ids("deliver.recs") },
    { name: "Working papers", features: ids("deliver.papers.core", "deliver.papers.open") },
    { name: "Journals", features: ids("deliver.book.journal") },
    { name: "Accounts production", features: ids("deliver.accts") },
    { name: "Review and sign-off", features: ids("deliver.papers.signoff", "deliver.accts.review") },
  ] },
  { id: "P3", title: "Priority 3: Practice Workflow", issue: 7, items: [
    { name: "Jobs", features: ids("run.jobs") },
    { name: "Checklists", features: ids("run.checks") },
    { name: "Planning", features: ids("run.plan") },
    { name: "Action Centre", features: ids("run.actions") },
    { name: "Client requests", features: ids("run.comms.forms", "run.portal.messages") },
    { name: "Approval workflows", features: ids("deliver.cosec.approval") },
    { name: "Task automation", features: ids("run.plan.auto", "run.plan.routines") },
    { name: "Recurring work", features: ids("run.jobs.roll", "run.jobs.recurring", "run.plan.routines") },
  ] },
  { id: "P4", title: "Priority 4: Reporting & Advisory", issue: 8, items: [
    { name: "Financial reporting", features: ids("grow.report.centre", "grow.report.analysis", "grow.report.aged") },
    { name: "Management accounts", features: ids("grow.mgmt") },
    { name: "Client review packs", features: ids("grow.mgmt.packs", "deliver.accts.client") },
    { name: "KPIs", features: ids("grow.kpi") },
    { name: "Forecasting", features: ids("grow.budget") },
    { name: "Cash-flow reporting", features: ids("grow.cash") },
    { name: "Advisory planning", features: ids("grow.adv", "grow.tax") },
    { name: "Business opportunities", features: ids("grow.opps") },
  ] },
  { id: "P5", title: "Priority 5: Tax & Statutory Filing", issue: 9, items: [
    { name: "Personal tax", features: ids("deliver.pt.comp", "deliver.pt.sa100", "deliver.pt.import", "deliver.pt.pay") },
    { name: "Partnership tax", features: ids("deliver.pt.partner") },
    { name: "Corporation tax", features: ids("deliver.ct") },
    { name: "iXBRL", features: ids("deliver.accts.pl", "deliver.accts.ixbrl") },
    { name: "HMRC submissions", features: ids("deliver.filing.infra", "deliver.filing.sa100", "deliver.filing.ct600", "deliver.pay.rti") },
    { name: "Companies House filing", features: ids("deliver.filing.ch", "deliver.filing.cs01") },
  ] },
];

export const SEED_MILESTONES: Milestone[] = [
  { id: "ms.core", title: "First milestone: usable core with one real test client", priority: "P1", done: false, issues: [4, 6], notes: "From docs/BUILD-ROADMAP.md. No target date has been agreed.", items: [
    { text: "Log in to the production tenant and reliably load clients and jobs", done: false },
    { text: "Create and update records; demonstrate failure recovery without loss or silent corruption", done: false },
    { text: "Export a backup and complete a restore rehearsal to test data", done: false },
    { text: "Prepare one company through trial balance, reconciliations, journals and review", done: false },
    { text: "Show statuses and overdue actions consistently in the Action Centre and planner", done: false },
    { text: "Record all missing pieces as Issues; mark live only where verified", done: false },
  ] },
  { id: "ms.nav", title: "Three-area navigation agreed and built", priority: "P1", done: false, issues: [5], notes: "Product direction agreed 6 November 2026; the redesign itself is a separate piece of work.", items: [
    { text: "Design approved with clear user journeys", done: false },
    { text: "All existing pages reachable by mouse, keyboard and mobile", done: false },
  ] },
];

// =================================================================== EXTERNAL APPROVALS

const ISSUE_DOC = "https://github.com/kevindbannister/practice-planner/issues/10";
const base = (x: Partial<Integration> & Pick<Integration, "id" | "provider" | "service" | "requirement" | "docs">): Integration => ({
  status: "Not Checked", next: "Check whether this is already held, and record the answer.", blockers: "", tasks: [10], features: [], ...x,
});
export const SEED_INTEGRATIONS: Integration[] = [
  base({ id: "acc.hmrc.vendor", provider: "HMRC", service: "XML Vendor ID", requirement: "Software developer registration to receive a Vendor ID for XML submissions (SA100, SA800, CT600, RTI).", docs: "https://www.gov.uk/government/collections/xml-and-other-software-developers", features: ["deliver.filing.infra", "deliver.filing.sa100", "deliver.filing.ct600", "deliver.pay.rti"], next: "Confirm whether a Vendor ID is held; if not, request one. Ask about recognition for SA100, SA800 and CT600.", blockers: "Without a Vendor ID, no HMRC XML message can be tested or sent." }),
  base({ id: "acc.hmrc.sdr", provider: "HMRC", service: "Software Developer registration", requirement: "Registering the practice as a software developer with HMRC.", docs: "https://www.gov.uk/government/collections/xml-and-other-software-developers", features: ["deliver.filing.infra"], next: "Confirm registration status and the contact held at HMRC." }),
  base({ id: "acc.hmrc.test", provider: "HMRC", service: "External Test Service credentials", requirement: "Test credentials and GovTalk details for SA100, SA800 and CT600.", docs: "https://www.gov.uk/government/publications/external-test-service-ets", features: ["deliver.filing.sa100", "deliver.filing.ct600"], next: "Request after the Vendor ID is issued.", blockers: "Depends on the Vendor ID." }),
  base({ id: "acc.hmrc.hub", provider: "HMRC", service: "Developer Hub (REST APIs)", requirement: "Sandbox application, subscriptions to the relevant APIs (VAT, agent authorisation) and agent accounts.", docs: "https://developer.service.hmrc.gov.uk/", features: ["deliver.vat.auth"], next: "Audit the sandbox application and its subscriptions." }),
  base({ id: "acc.hmrc.prod", provider: "HMRC", service: "Production API access", requirement: "Approval to use production APIs after sandbox testing.", docs: "https://developer.service.hmrc.gov.uk/api-documentation/docs/going-live", features: ["deliver.vat.auth", "deliver.vat.returns"], next: "Start once sandbox testing is possible.", blockers: "Needs sandbox work first." }),
  base({ id: "acc.ch.test", provider: "Companies House", service: "Software filing test account", requirement: "Test credentials for software filing, and clarity on the submission route as the XML gateway is retired.", docs: "https://www.gov.uk/government/organisations/companies-house", features: ["deliver.filing.ch", "deliver.filing.cs01"], next: "Request a test account and the current technical specification." }),
  base({ id: "acc.ch.presenter", provider: "Companies House", service: "Presenter or credit account", requirement: "A presenter ID and authentication code, and a credit account for fees.", docs: "https://www.gov.uk/government/organisations/companies-house", features: ["deliver.filing.ch"], next: "Confirm whether a presenter account is held." }),
  base({ id: "acc.xero", provider: "Xero", service: "OAuth application", requirement: "Existing OAuth app: granted scopes, connection limits and tier.", docs: "https://developer.xero.com/documentation/", features: ["deliver.book.xero", "grow.report.centre"], next: "Check the app, scopes and connection limits; record the tier.", status: "Not Checked" }),
  base({ id: "acc.xama", provider: "Xama", service: "API access", requirement: "API credentials, scopes and commercial entitlement for live AML work.", docs: "https://apidocs.xamatech.com", features: ["run.clients.xama"], next: "Confirm scopes and entitlement." }),
  base({ id: "acc.adfin", provider: "Adfin", service: "Billing API", requirement: "Client ID and secret for recurring invoices and direct debit mandates.", docs: "https://www.adfin.com", features: ["run.fees.adfin"], next: "Check the credentials held and the live/sandbox state." }),
];

// =================================================================== DECISIONS

const dv = (decision: string, rationale: string, alternatives: string, consequences: string, status: Decision["current"]["status"] = "Accepted", on = "2026-11-06"): Decision["current"] =>
  ({ on, by: "Kevin Bannister", decision, rationale, alternatives, consequences, status });
export const SEED_DECISIONS: Decision[] = [
  { id: "dec.nav", title: "Three-area navigation", topic: "Navigation", history: [], current: dv(
    "Organise the application into Run Practice, Deliver Work and Grow & Advise, with contextual menus and global search, alerts, settings and the assistant always reachable.",
    "The top bar has too many items; the three areas follow how the practice actually works.",
    "Keep the current flat top bar; group by client rather than by activity.",
    "Agreed product direction only. The navigation redesign is separate work (issue #5) and every existing route and deep link must keep working.") },
  { id: "dec.db", title: "SharePoint Lists stay for now", topic: "Database", history: [], current: dv(
    "Continue using SharePoint Lists during development. Migrate to a proper database only after the data model and workflows are mature.",
    "The structure is still changing; a migration now would be redone. Lists give version history and no extra hosting.",
    "Move to PostgreSQL or Azure SQL now.",
    "No migration is carried out. Keep SharePoint behind the data layer, track schema changes and integrity, and record migration requirements (issue #11).") },
  { id: "dec.priorities", title: "Development priorities", topic: "Priorities", history: [], current: dv(
    "1 Core reliability, 2 Accounts & Working Papers, 3 Practice Workflow, 4 Reporting & Advisory, 5 Tax & Statutory Filing.",
    "Nothing else is trustworthy until saving and sign-in are reliable; accounts and papers are the core deliverable.",
    "Build tax and filing first because of the deadlines they carry.",
    "Limit main development to one or two issues at a time. Priority numbers appear in issue titles ([P1] to [P5]).") },
  { id: "dec.access", title: "Start external approvals immediately", topic: "External integrations", history: [], current: dv(
    "Applications and approvals that may involve waiting periods start now, in parallel, rather than when the related feature is built.",
    "Vendor IDs, test credentials and production access can take weeks and block whole workstreams.",
    "Apply feature by feature as each is reached.",
    "Tracked in Integrations & Approvals and issue #10. No submission is made without Kevin's approval. Sandbox or mock is never presented as live.") },
  { id: "dec.complete", title: "What 'complete' means", topic: "Definition of done", history: [], current: dv(
    "A feature is Complete only when tested with realistic data, permissions and recovery, with external services verified and acceptance evidence recorded. Code that exists, a screen, or passing unit tests is Ready for Testing at most.",
    "Several modules are substantial but not proven live; counting them as done would hide the real remaining work.",
    "Treat passing tests as done.",
    "The Hub asks for an evidence note before a feature can be set to Complete.") },
];

// =================================================================== ISSUES (offline snapshot)

/** The repository's issues as they stood on 6 November 2026. Shown only when GitHub can't be reached, and labelled as a snapshot. */
const snap = (number: number, title: string, state: "open" | "closed"): Issue => ({ number, title, state, labels: [], url: `https://github.com/kevindbannister/practice-planner/issues/${number}`, body: "", updated: "2026-11-06T00:00:00Z" });
export const SNAPSHOT_ISSUES: Issue[] = [
  snap(1, "Fix Co Sec save and filing controls (R01/R02)", "closed"),
  snap(2, "Show affected SharePoint list for Microsoft 365 save errors", "closed"),
  snap(3, "Rollback Co Sec filing/save changes and 403 diagnostics", "closed"),
  snap(4, "[P1] Validate M365 / SharePoint reliability and recovery", "open"),
  snap(5, "[P1] Implement three-area navigation: Run Practice / Deliver Work / Grow & Advise", "open"),
  snap(6, "[P2] Complete accounts and monthly working papers end to end", "open"),
  snap(7, "[P3] Connect planning, jobs, checklists and Action Centre", "open"),
  snap(8, "[P4] Prioritise reporting, management packs and advisory", "open"),
  snap(9, "[P5] Complete tax, iXBRL and statutory filing in verified stages", "open"),
  snap(10, "[Access] Start external registrations, developer credentials and test environments", "open"),
  snap(11, "[Architecture] Preserve SharePoint now; prepare controlled future database migration", "open"),
];

/** Which feature groups each existing issue is about, so the board can show the linked feature. */
export const ISSUE_FEATURES: Record<number, string[]> = {
  4: ["run.ops.auth", "run.ops.sharepoint", "run.ops.save", "run.ops.backup"],
  5: ["run.ops"],
  6: ["deliver.papers", "deliver.recs", "deliver.accts", "deliver.book"],
  7: ["run.plan", "run.jobs", "run.checks", "run.actions"],
  8: ["grow.report", "grow.kpi", "grow.adv", "grow.mgmt"],
  9: ["deliver.filing", "deliver.pt", "deliver.ct", "deliver.accts.pl"],
  10: ["deliver.filing.infra", "deliver.book.xero", "run.clients.xama"],
  11: ["run.ops.sharepoint"],
};
