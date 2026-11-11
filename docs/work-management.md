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
