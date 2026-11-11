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
