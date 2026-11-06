# Practice Planner — Build Management
_Last agreed: 6 November 2026 · Status: active working roadmap_

> This is the **single source of truth for scope, priorities and decisions**, with GitHub Issues holding actionable work. Update this document when a decision changes. Do not interpret source-code presence as proof of live readiness.

## Product structure and navigation

**Run Practice** — Home dashboard, planning (day/week/month), Action Centre, clients and groups, jobs, deadlines, checklists, communications, portal, sales, proposals, onboarding, fees, billing and practice operations.

**Deliver Work** — Bookkeeping and month-end, annual working papers, accounts production, personal and corporation tax, VAT/CIS, payroll, company secretarial, document management, review/approval and filing.

**Grow & Advise** — Management reporting, financial analysis, KPIs, profitability, cash flow, forecasting, tax/business planning, client advisory packs, opportunities and expansion of client services.

Navigation: three top-level areas, contextual sidebars; global search, alerts, settings, AI assistant accessible everywhere. Final module placement is subject to UX review; avoid duplicate competing views.

## Agreed priority order

1. **Core reliability:** Entra/M365 access, SharePoint permissions, saving, failed-write recovery, backups/restore, relationships, integrity and real-data workflow tests.
2. **Accounts and working papers:** TB import/mapping, Xero integration, journals and reconciliations, current/prior-year figures, schedules, sign-offs, usable annual accounts preparation and month-end packs.
3. **Practice workflow:** jobs, checklists, deadlines, records requests, Action Centre, cross-module statuses, approvals, follow-up, recurring work and time/billing handoffs.
4. **Reporting and advisory:** Xero-based reporting, management and annual review packs, forecasts, cash-flow, KPI insights, advisory opportunities; commercial differentiation.
5. **Tax and statutory filing:** SA100, SA800, CT600, iXBRL, Companies House filing and corresponding test/live acceptance.

**Parallel track from day one: external access.** Apply for all API credentials, software developer registration, test environments, authorisation and approvals requiring waiting periods now. Never present sandbox/test/mock as live.

## Architecture and database decision

- **Keep SharePoint Lists during iterative development.** Do not migrate yet.
- Use stable app-level identifiers and an explicit entity/relationship map; isolate SharePoint and Microsoft Graph behind repositories/adapters rather than UI.
- Track schema changes, referential integrity, concurrency, multi-list writes, permissions, migrations, restores, data retention and performance.
- **Revisit a proper database (PostgreSQL, Azure SQL or similar) only after the data model and real workflows have stabilised.** Plan migration with export/import, reconciliation and rollback; do not assume it will be a drop-in replacement.

## Definition of feature states

- **Planned:** requirements written, no confirmed implementation.
- **In development:** code exists but workflow not completed.
- **Ready for testing:** end-to-end workflow implemented, tests available, known limitations documented.
- **Ready for live use:** tested with realistic data, permissions and recovery, external services verified where relevant, and acceptance evidence recorded.
- **Blocked:** list specific dependency and next action.

For each issue include: objective; user journey; acceptance criteria; test/verification steps; dependencies; outstanding decisions; references.

## Product-level acceptance journeys

1. Lead → proposal → engagement → onboarding/AML → client/services → jobs.
2. Client records request → receive/import records → working papers → journals/reconciliations → reviewed TB → accounts → client approval → filing evidence → complete job → roll forward.
3. Monthly bookkeeping → month-end reconciliations → management reporting → advice → next actions.
4. Personal tax / CT → computation → review → signed version → supported submission → official acknowledgement.
5. Companies House change → internal checks → client approval → filing/recorded external completion → register updates.
6. Work done → time/fees → invoice → collections → practice KPIs.

## First milestone — usable core with one real test client

- Log in to production tenant and reliably load clients/jobs.
- Create/update records and demonstrate failure recovery without loss or silent corruption.
- Export backup and perform a **restore rehearsal** to test data.
- Prepare one company through trial balance, reconciliations, journals and review.
- Show statuses and overdue actions consistently in the Action Centre and planner.
- Record all missing pieces as Issues; only mark live where verified.

## Parallel external-access applications (start now)

1. HMRC XML software developer: Vendor ID, External Test Service credentials, GovTalk details for SA100/SA800/CT600, recognition/live-route clarification.
2. HMRC Developer Hub: sandbox and production access for relevant APIs, VAT and agent authorisation; agent accounts and client permission checks.
3. Companies House: software filing testing credentials and applicable presenter/credit account; clarify filing routes and transition away from XML gateway.
4. Xero: existing OAuth app, client connections/tier and scopes.
5. Xama: existing API credentials, relevant scopes/commercial entitlement.
6. Other integrations: record any approval or supplier lead times as soon as identified.

Do not store credentials, client data, authentication codes or secrets in GitHub issues.

## Operating rhythm

- Track active tasks in GitHub Issues. Use issue titles with [P1] … [P5] and [Access] for parallel applications.
- Suggested workflow status: Backlog → Ready → In progress → Blocked → Review/testing → Done (represent through GitHub Projects when configured).
- Limit simultaneous main development work to 1–2 issues; external access continues concurrently.
- Every weekly review: what was completed; what passed tests; what's blocked; what changed; next 1–3 issues. Link PRs to Issues.
- Before adding modules, check whether an existing module already covers the need.
- Keep this file up-to-date when scope/priority/navigation/architecture decisions change.

## Repository evidence and caveats

Codebase includes substantial modules for planning, client lifecycle, accounts, reporting, portal, payroll, company secretarial, tax, filing adapters and tests. **Not all are live-ready.** In particular, HMRC direct filing, iXBRL and Companies House filing have explicitly documented limitations. Consult `docs/hmrc-filing.md`, `docs/cosec-phases-2-7-report.md`, `docs/client-portal.md`, and relevant tests; recheck the current main branch before relying on statements made in earlier reports.

## Decision log

- 2026-11-06: Organise navigation into **Run Practice / Deliver Work / Grow & Advise**.
- 2026-11-06: Keep SharePoint for development; migrate after database structure is proven.
- 2026-11-06: Priorities set to reliability → accounts/working papers → practice workflows → reporting/advisory → tax/filing.
- 2026-11-06: Start third-party API applications now as a parallel workstream.

