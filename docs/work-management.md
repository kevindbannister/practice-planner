# Task and dependency management (ClickUp replacement)

Branch `feature/task-dependency-engine`, off main at V24.0. Independent of the accounts filing branch.

## Phase 1: review and foundations

### What is already in the app (reviewed)
- **Tasks** list: Key, ClientKey, GroupKey, Type (used as the title), PlannedDate, EstimateHours, DueDate, Status (Open/Done/Cancelled/On hold), Notes, hold fields, Subtasks (JSON checklist), actual/remaining/ready hours, ProjectKey, RoutineKey/RoutineDate. No title column, no owner, no priority, no parent.
- **Jobs** list: a job has stages, three dates (records, planned, deadline) plus InternalDeadline, readiness fields (RemainingHours, ReadyHours, ReadyNote), hold/waiting fields. Job readiness already exists in `lib/jobProgress.ts` (ready, partly, waiting, hold, complete) and `lib/waiting.ts` (wait stages). The new dependency engine must feed this, not replace it.
- **Projects**: `lib/projects.ts`; project tasks are Tasks with a ProjectKey and count against business hours.
- **Routines** (`lib/routines.ts`): recurring tasks already exist, de-duplicated by RoutineKey+RoutineDate. General recurring tasks (Phase 9) should extend this, not add a second recurrence system.
- **Meetings**: Actions are JSON on the meeting `{text, who, due, taskKey?, done?}`. Some already link to a task.
- **Planning sessions and timesheets** (V23.6, V23.7, V24.0): `PlanSessions`/`PlanEvents` hold planned work permanently; `JobTime` is the one canonical time record and already has a `TaskKey`. Planned dates stay out of the task record; actual time is never derived from task status.
- **Client portal** already has `PortalRequests` ("information requests"), documents and messages. Client actions (Phase 4) must reuse its identity and permissions.
- **Action Centre** (`lib/actions.ts`) derives actions from records; task and dependency alerts plug in there (Phase 7).
- **Permissions** (`lib/permissions.ts`): roles enforced in the app's data layer (`guard`/`checkWrite`).
- Open PRs: #12 (review roll-forward undo) and #13 (accounts filing). Neither touches tasks. No other branch changes the task, planning or timesheet code.

### Decisions made in Phase 1
1. **One task list.** New optional columns are added to `Tasks` (area, parent, job, meeting, owner type, assigned user/contact/external party, priority, internal target, client-agreed date, remaining minutes, blocked reason, follow-up, recurrence, privacy, tags, version, capture key). Old rows keep working unchanged: `readTask` derives area, title, minutes and owner from the old fields. Nothing is rewritten unless an optional backfill is run.
2. **Tasks are not jobs.** A task may point at a job (`JobKey`) and depend on one. Job lifecycle, recurring jobs and checklists are untouched. Subtask checklists stay as JSON; independent child tasks use `ParentTaskKey`. No automatic conversion of checklist items.
3. **Dates are separate.** A task has its own due date, internal target and client-agreed date. Statutory deadlines stay on the job. Planned work lives in `PlanSessions` only; `PlannedDate` on a task is read as legacy.
4. **One central status model.** Existing statuses stay. Client/outside-party actions add Not requested, Requested, Submitted, Under review, More information required. "Submitted" is not finished: only the practice moving it to Done satisfies anything that needs verification.
5. **Dependencies are first-class records** (`Dependencies`, with append-only `DependencyEvents`), referencing a task, a job (optionally with a stage) or an information task by stable key. Types: finish-to-start, stage, approval, information, partial. Cycles, self-dependencies, missing ends, duplicates and bad stages are refused; cancelled links are ignored for cycles; overrides need a reason; history is never edited.
6. **Quick capture is idempotent.** Bulk paste splits lines, strips bullets, drops repeats and gives each line a stable capture key, so a retry or an offline replay creates only what's missing.
7. **Privacy** is a rule on the data (`lib/work/privacy.ts`): personal tasks are visible only to their owner or creator, not to managers, the portal or any report. Portal sees only actions explicitly shared with that client, owned by a contact or external party, and only safe fields.

### Honest limit, and a decision needed before Phase 2
The app reads SharePoint directly from the browser with each person's own sign-in. A privacy rule applied in the app cannot stop someone who has rights to the SharePoint list from opening it. To make personal-task privacy real, personal tasks must live where only their owner has rights: a separate SharePoint list (same columns) whose item permissions the server sets to the owner alone, or the API. I have not stored any personal task anywhere yet. **Please decide:** (a) separate private list with server-set item permissions (recommended), or (b) accept app-level privacy only and tell staff not to put anything sensitive in it.

### Schema changes
`Tasks`: 30 new optional columns (listed above). New lists `Dependencies`, `DependencyEvents`, `TaskEvents`. The MCP schema was regenerated.

### Migration
`planMigration` is a read-only dry run: counts by area, orphaned clients/projects/jobs/parents, tasks with both client and project, duplicates, checklist items kept, meeting actions not yet tasks. `backfill` fills only blank Area and Version; `rollbackFor` is its exact undo and leaves anything a person changed since. Rerunning finds nothing to do. No UI yet and nothing runs automatically. No dependency history is invented for old jobs.

### Tests
`app/tests/workModel.test.ts` (14): quick add, area rules, legacy reads, status moves, bulk and retry, dependency validation (self, missing, duplicate, cycle, stages, partial), transitions and history, row round trip, privacy, portal visibility, migration and rollback.

### Outstanding limitations
No screens, no readiness or risk calculation, no store wiring for personal tasks, no portal changes. Those are Phases 2 to 9. Nothing here is switched on for users.

## Phase 2: universal task management (V24.2, merged to main)

**Built**
- **Task Inbox** (`#/plan/inbox`, a new Plan tab). Quick add needs only a title; Enter saves and the box stays ready. Pick tasks, then move to a client or project, assign, set due date or priority, complete or archive. Archive means cancel: nothing is erased. Search. The last change can be undone; an undo is refused (and says so) for any task someone has changed since.
- **Client Tasks tab** under Work. One compact list of every task for the client (ours and the client's, including tasks linked to a job or meeting; nothing is copied). Filters: All outstanding, Our actions, Client actions, Waiting, Blocked, Overdue, Completed, with counts. Group by status, responsible party, job, due date or priority. Quick add with the client preselected. Smaller tasks show under their parent with a done/total chip.
- **Bulk add**: paste lines, untick any, then add. Bullets and numbers stripped, repeats dropped. Every line has a stable capture key, so pressing Add again after a failure only creates what is missing.
- **Task editor** now has a Details section: who does it (us, the client, someone else), who exactly, owner or who chases it, status, priority, due date, our target date, follow-up date, "part of" (parent task) and what is stopping it.
- **Rules** (`lib/work/tasks.ts`): every change is a patch that bumps Version and refuses when the task changed since it was read; a task can't be its own parent, a child of its own child, under a finished parent, under another client's task, or more than 3 levels deep; completing a task with open smaller tasks needs an explicit yes; a client action follows Not requested, Requested, In progress, Submitted, Under review, Done (it can't jump to Done), and switching who does a task sets a sensible status.
- A task given a client or project is treated as filed even when an older screen left Area as inbox.

**Files**: `lib/work/tasks.ts`, `lib/work/model.ts` (area rule), `ui/TaskInbox.tsx`, `ui/ClientTasks.tsx`, `ui/taskKit.tsx`, `ui/TaskDetails.tsx`; edited `Editors.tsx`, `ClientPage.tsx`, `PlanPage.tsx`, `App.tsx`, `bits.tsx`, `devHubSeed.ts`.
**Schema changes**: none beyond Phase 1 (the new Tasks columns are added to SharePoint automatically on first run).
**Migration**: none needed. Old tasks appear in the client list and keep working. Run the dry run in Phase 1 if you want a report before anything is backfilled.
**Tests**: `app/tests/workTasks.test.ts` (12) plus the Phase 1 tests; whole suite 1,345 pass. Checked in a browser on the demo build: quick add, bulk move to a client, undo, paste three lines, client tab, mobile width; no errors.

**Not built, on purpose**
- No Personal area yet: it waits for your privacy decision (separate private list vs app-level only). Nothing personal is stored.
- Blocked here means "has a stated reason". Dependencies feed it from Phase 5.
- Partner/manager "assign to" lists only people set up under Team; with no team set up it offers Me.
- Swipe actions, PWA, Quick Add shortcut and floating mobile Add button are Phase 3.

## Phase 3: quick capture and mobile (V24.3, merged to main)

**Built**
- **Quick Add** (`ui/QuickAdd.tsx`): a small composer that opens from **Alt+N** (Option+N on a Mac; Ctrl/Cmd+K is already Search), the top-bar plus button, or a **floating Add button on a phone** (above the bottom navigation, 56px). The title is focused; Enter saves. Only the title is needed.
- It files the task **where you are**: on a client's page it adds to that client; anywhere else it goes to the Inbox. A "Goes to" picker lets you change it (Inbox, a client or a business project). Personal is not offered (see below).
- **Quick dates** for **Due (the deadline)**: Today, Tomorrow, This week (this Friday, or today at the end of the week, never in the past), Next week (next Monday), pick a date, or none. **Plan to work on it** is a separate, clearly labelled date under More details, so a deadline and a plan are never confused. More details also has notes and priority, and a link to the full task form.
- **Several at once**: paste lines and the dialog switches to a list ("Add 3 tasks"). Retrying never repeats ones already saved.
- **Add another after this** keeps the box open for the next one.
- **Speak a task**: shown only where the browser supports speech recognition. The words go into the box for you to read and change; nothing is saved until you press Add. The normal box works without it.
- **Offline-safe capture**: if the save fails because there is no connection, the task is kept on this device and added when you're back online (also checked at start-up). Every task carries a capture key, so it can't be saved twice, even from two tabs. After 5 failed tries it stops and shows the task in the Inbox for you to retry or discard. Only new tasks are queued, never edits, so there is nothing to clash.
- **Share from a phone**: the app is now installable (manifest, icons) and declares a share target, so on Android Chrome you can share a link or text to it and the composer opens filled in (title from the first line, everything kept in the notes).
- **Service worker** (`public/sw.js`): network-first, so while you're online you always get the current release, and it never touches sign-in, SharePoint, Graph or the API. It only lets a screen you already have open keep working through a dropped connection.

**Files**: `lib/work/capture.ts`, `ui/QuickAdd.tsx`, `ui/App.tsx`, `ui/TaskInbox.tsx`, `main.tsx`, `public/manifest.webmanifest`, `public/sw.js`, `public/icon-192.png`, `public/icon-512.png`, `public/index.html`, `public/styles.css`, `public/staticwebapp.config.json`, `devHubSeed.ts`.
**Schema changes**: none. **Migration**: none.
**Tests**: `app/tests/workCapture.test.ts` (8): quick dates around weekends and year end, where a task goes from the screen, share parsing, voice tidy-up, queue de-duplication, retry limits and a damaged stored queue. Browser-checked on the demo build: Alt+N, quick date, client default, three-line paste, the phone Add button and layout, no errors.

**Limits to know**
- **Offline start**: capture works while the app is open when the connection drops. Opening the app cold with no connection shows the cached screen but it can't load your data (sign-in and SharePoint need the network), so you can't capture then. A tiny stand-alone capture page would be needed for that and wasn't built.
- **The offline save path was not exercised in the browser** (the demo uses an in-memory store that can't go offline). The decision and the queue are unit-tested; please try it once on your phone in aeroplane mode with the app open.
- **iPhone**: Safari doesn't support share targets or reliable speech recognition in an installed app, so those are Android/desktop Chrome only. Quick Add, the Add button and the offline queue work everywhere.
- The installable icons are enlarged from the existing 64px icon, so they're soft. Replace `icon-192.png` and `icon-512.png` with proper artwork when you have it.
- The top-bar plus is inside the collapsible tools area on narrower desktop windows; Alt+N always works.
- Swipe actions weren't added: every row already has large tick boxes, and a swipe gesture needs an accessible alternative on every row first.
- The queue lives in this browser's local storage; it isn't synced between devices and is cleared if you clear site data before it syncs.

## Phase 4: client actions and meeting actions (V24.4, on main)

**Features.** A client action (owner is the client or another outside party) can be shared through the existing client portal as an information request. The task keeps our side (status, checking, chasing, history); the portal request keeps the client's side. New `PortalRequestId` column links them.
- Sharing, a portal reminder, accepting, asking for corrections and reopening each show what will happen and need a Confirm press. Logging a call, email or note sends nothing.
- When the client answers in the portal the task moves to Submitted by itself. That is the only automatic change. Nothing the client or portal does can make a task Done or Cancelled: those are only suggested. Accept is the practice's own check, recorded as a `verified` event, which is what Phase 5 will use to satisfy dependencies that need verification.
- Chasing: call, email, note, portal reminder, escalate, follow-up date. A portal reminder is refused within 3 days of the last one.
- Append-only history (`TaskEvents`) for status, owner, responsible party, sharing, submissions, checks, chases and follow-up dates.
- Meetings: every agreed action can be turned into a task after a review list with tick boxes. Tasks for others are tracked as client actions and not shared. A capture key per action means converting twice can't duplicate. Actions found in the notes ("Action:", "[ ]", "Sam will...") are offered, never added automatically. The meeting shows how many of its actions are done, read from the linked tasks.
- Action Centre: submitted work to check, overdue client actions to chase, follow-ups due. Private tasks are excluded.

**Files.** `lib/work/clientActions.ts`, `ui/ClientActionPanel.tsx`; edited `ui/TaskDetails.tsx`, `ui/Meetings.tsx`, `lib/actions.ts`, `lib/schema.ts`, `lib/devHubSeed.ts`, `version.ts`, MCP schema regenerated.
**Schema.** Tasks: `PortalRequestId` (auto-provisioned). `TaskEvents` was already added in Phase 1.
**Migration.** None. Existing tasks are unaffected.
**Tests.** `tests/workClientActions.test.ts` (12). App suite 1,365 pass; API 339 pass.
**Limits.** Portal sync runs when a task is open, not in the background. The legacy meeting "Add my actions to the plan" button is replaced by the review list, so tasks it made earlier keep their link. Browser walkthrough of the panel was not run against a live portal (the demo has none). Meeting action completion is not written back to the meeting's tick box.

## Phase 5: dependency engine and readiness (V24.5, on main)

**Features.** One engine (`lib/work/readiness.ts`) reads the dependency records and the real state of the work they point at.
- Readiness values: Ready, Partly ready, Blocked, Waiting, On hold, Complete. Kept separate from workflow status.
- A dependency is met only when its prerequisite really is: a task is Done (and, for client information or anything marked "must check", also accepted by the practice); a job is Complete or has reached the named stage. A cancelled prerequisite or a missing one blocks and is flagged for a decision; it is never treated as met.
- Stage-scoped holds: a dependency on one stage of a job (partial, or any type with a stage chosen) leaves the job Partly ready until it reaches that stage, then Blocked. The other stages stay actionable.
- Every block has a plain reason, for example "Blocked because Annual Accounts 2026 has not reached Approved", with a button to open the prerequisite.
- Chain view: everything a piece of work is waiting on, nearest first, and the earliest steps that can be acted on.
- Hours split helper (`splitHours`): remaining hours into actionable and held, from stage budgets; says it cannot split when stage hours are unknown.
- Integrity checks: missing or cancelled ends, stages that no longer exist, cycles in existing data, a satisfied record whose prerequisite went back, a job moved past a held stage, duplicates, overrides with no reason.
- Records follow the facts: satisfied once truly met, reopened if the prerequisite goes back, each with a history entry. Overriding needs a reason and is reversible.
- Screens: a Dependencies section on every task and job editor (add, override, put back, remove, chain); a readiness chip in task lists; the client Tasks "blocked" filter now includes tasks held by dependencies.
- No expected date is invented: where none is known the panel says so and says the deadline does not move.

**Files.** `lib/work/readiness.ts`, `ui/DependencyPanel.tsx`; edited `ui/TaskDetails.tsx`, `ui/Editors.tsx`, `ui/taskKit.tsx`, `ui/ClientTasks.tsx`, `lib/devHubSeed.ts`, `version.ts`.
**Schema / migration.** None (Dependencies and DependencyEvents lists came in Phase 1).
**Tests.** `tests/workReadiness.test.ts` (14).
**Limits.** The planner does not yet schedule only the actionable hours (Phase 9); deadline risk and Action Centre alerts for blocked work are Phase 7; templates are Phase 6. The Inbox list shows the readiness chip but does not filter on it. Approval dependencies on a job rely on the approval stage being chosen. Not browser-checked against live data.

**Fix included in V24.5.** Phase 4's client-action panel needs the portal context, but the task and job editor drawers were mounted outside it, so opening any task crashed. The portal provider now wraps the editors. Found by the browser check, not by the unit tests.

## Phase 6: accounting dependency templates (V24.6, on main)

**Features.** Configurable templates (`lib/work/templates.ts`, screen at Settings > Dependencies, `#/dependencies`) for the standard relationships: records received → VAT, bookkeeping → accounts, accounts approved → tax finalisation, partnership accounts → partners' Self Assessment, payroll information → payroll, reconciliations → management accounts. Six starter drafts are offered; they stay off until the services (and stages) are chosen, so nothing runs half-configured.
- A template says "this service waits for [another service's job | information to be received]", optionally at a named stage and holding back a named stage (stored by name, so reordering stages doesn't break it; a missing stage becomes a review, not a wrong link).
- Matching is by service, client and period only: same period end; the period it covers (accounts → tax); same tax year (6 April to 5 April); or a different client.
- Uncertain means review, never a guess: several candidates; no period end; accounts longer than 12 months covering an earlier tax period; partnership to partner (different clients, no relationship recorded, so always a confirm); a stage that no longer exists; a link that would make work wait on itself. A person picks the right job or says "this doesn't apply" (remembered).
- Information templates make a client task (not shared with the client) and a verified-only dependency. A repeat can't make two (capture key).
- Applied to open jobs only. Finished jobs are untouched; a dependency that was removed on purpose or declined is never recreated; editing a template changes nothing that already exists.
- Automatic when a job is created (completing a recurring job, or adding one by hand): only what is certain is created. Everything else, and jobs created elsewhere, shows on the screen under "Ready to create" (needs a click) and "Needs a decision".
- Template administration: view, create, edit, on/off (refused while unfinished), where used. Managers and partners only (the existing Checks permission).

**Files.** `lib/work/templates.ts`, `ui/DependencyTemplates.tsx`, `ui/templateKit.tsx`; edited `ui/Editors.tsx`, `ui/App.tsx`, `ui/SettingsTabs.tsx`, `ui/data.tsx`, `lib/schema.ts`, `lib/devHubSeed.ts`, `version.ts`, MCP schema regenerated.
**Schema.** New lists `DependencyTemplates` and `TemplateDecisions` (auto-provisioned). No migration.
**Tests.** `tests/workTemplates.test.ts` (10).
**Limits.** Jobs created by Companies House roll-forward are picked up on the screen, not automatically. Review items are on the Dependencies screen only; the Action Centre alert comes with Phase 7. Template matching for a new job covers that job as the waiting side only. Tax periods and accounts periods are matched by period end because jobs don't record a start date. Not tried end to end in the browser (the demo data has no services); the matching and creation rules are covered by tests.

## Phase 7: deadline and blocker intelligence (V24.7, on main)

**Features** (`lib/work/risk.ts`, `ui/Unblock.tsx`, `ui/riskKit.tsx`).
- **Statutory deadlines are protected.** Nothing in the dependency, readiness or risk code writes a deadline column (`Deadline`, `CHDeadline`, `DeadlineSource`; a test guards the list). Blocked jobs stay visible. A job's panel shows five dates apart: statutory deadline, internal target, agreed with the client (not recorded on jobs, so shown as such), planned date, and when the last prerequisite is expected.
- **Risk categories:** On track, Attention required, At risk, Critical, Overdue, from working days to the deadline (the practice's usual week and days marked off), hours remaining, hours actionable now (the progress figures, reduced by stage-held hours from dependencies), outstanding prerequisites and their expected dates, and the internal target.
- **Unknown dates are never invented.** If any prerequisite has no expected date the result is flagged "uncertain" with no projected finish, and escalates as the deadline nears (defaults: attention at 20 working days, at risk at 10, critical at 5; never worse than the optimistic case). A blocked job is not treated as low priority. With known dates it reports spare days, and "critical" if a prerequisite is expected after the deadline.
- **Configurable:** spare days, hours one job can take in a day and the uncertainty thresholds, on the Unblock tab (saved as the `work.risk` setting).
- **Blocker impact:** per outstanding prerequisite: directly and indirectly held-up work, hours held, deadlines touched, who has it, follow-up date, earliest actionable step, whether it can be acted on now.
- **What can I unblock?** (Plan > Unblock): prerequisites ranked by worst deadline risk, then how much they hold up, hours, and whether anyone can act, plus the deadline risk of every open job.
- **Action Centre:** held-up jobs that are short of time raise an alert naming the prerequisite, who has it and whether a date is known, linking to it. Overdue jobs keep their existing alert; healthy jobs raise nothing. Client-owned overdue tasks no longer duplicate.

**Files.** `lib/work/risk.ts`, `ui/Unblock.tsx`, `ui/riskKit.tsx`; edited `ui/DependencyPanel.tsx`, `ui/ActionCentre.tsx`, `ui/PlanPage.tsx`, `ui/bits.tsx`, `lib/actions.ts`, `lib/devHubSeed.ts`, `version.ts`.
**Schema / migration.** None.
**Tests.** `tests/workRisk.test.ts` (9). App suite 1,398 pass; API 339.
**Limits.** Bank holidays count as working days unless marked off. Capacity is the practice's day hours, not per person, and other planned commitments are not yet subtracted (Phase 9). The date agreed with the client exists on tasks but not jobs. Planned hours ahead are not yet fed into the risk figure.
