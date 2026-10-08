# Practice Planner: build spec

Version 0.2 · 8 Oct 2026 · single-user practice manager

## What it is

An internal practice manager built around **planning** rather than deadlines. Every job carries three dates: when records are expected, when the work is planned in, and the statutory deadline. The planning board, not the deadline list, is the main screen.

## Architecture

| Part | Choice | Why |
|---|---|---|
| App | Single-page web app (React + TypeScript) | Drag-and-drop planning; matches the mock-ups |
| Hosting | Azure Static Web Apps | Free or near-free at this scale, deploys from GitHub |
| Sign-in | Microsoft account (Entra ID), single tenant | No separate passwords |
| Data | SharePoint Lists on a dedicated "Practice Planner" site, via Microsoft Graph | Every edit saves instantly; version history on every record |
| Background jobs | Azure Functions (timer + on-demand) | Companies House checks; OneDrive export |
| Backups | Nightly Excel export to OneDrive, plus an "Export now" button | Data always in the practice's hands |
| Secrets | Companies House API key stored server-side only | Never in the browser |

## Data model (SharePoint Lists)

**Clients**: name, type (Ltd, LLP, individual, partnership, trust, sole trader), status, company number, CH auth code, incorporation date, year end, SIC, partner, manager, default preparer, primary contact (name, email, mobile, preference), addresses, UTR, CT UTR, NI number, VAT number and quarter, PAYE ref, Accounts Office ref, AML status and review date, Xama ID, Xero ID, engagement letter status and date, fees, payment terms, logo, Engager ID.

**Contacts**: people linked to clients who aren't clients themselves.

**Groups** and **Group members**: group, client or contact, role. A client can be in more than one group.

**Service templates**: accounts, CT600, CS01, VAT, SA100, payroll, CIS, bookkeeping, management accounts, etc., each with a recurrence and a deadline rule.

**Stage templates**: service, order, name, default person, default budget, billing point.

**Client services**: which services each client has, fee, period, overrides of stage people and budgets.

**Jobs**: client, service, period end, records expected, records received, planned date, estimate, deadline, deadline source (Companies House, calculated, manual), priority, status, completed date, actual time, depends on (e.g. CT600 depends on accounts).

**Job stages**: job, order, name, who, budget, date done, billing point.

**Job history**: completed and closed jobs, including those brought over from Engager.

**Tasks**: title, optional client or group, type (advisory, practice, admin), planned date, estimate, due date, status.

**HMRC authorisations**: client, service (MTD VAT, MTD IT, SA, CT, PAYE), status (not requested, link sent, authorised, removed), date sent, expiry, notes.

**Settings**: hours per weekday, "tight" threshold (default 21 days), export schedule.

## Key rules

- **One open job per client service.** Future periods stay hidden until the current one is completed.
- **Roll-forward on completion** creates the next job: next period, next deadline, records expected = this year's received date + 1 year, suggested slot = the same week next year, estimate = this year's actual time.
- **Deadline rules:**
  - Ltd accounts: year end + 9 months (first accounts taken from Companies House)
  - CT600 filing: year end + 12 months
  - CT payment: year end + 9 months + 1 day
  - CS01: made-up date + 14 days
  - SA: 31 January
  - VAT: quarter end + 1 month + 7 days
- **Companies House is the source of truth** for accounts and CS01 periods and deadlines.
- **Flags:** tight (planned within the threshold of the deadline), unplanned, records awaited, over capacity (planned hours over the day's hours), urgent.
- **Companies House check:** daily check of accounts and CS01 due dates and officers; flag any mismatch.

## Build stages

| Stage | Delivers |
|---|---|
| 1. Foundations | SharePoint site and lists; Engager data imported and checked |
| 2. Clients | Clients list, quick look, client page (overview and work tabs) on real data |
| 3. Planning board | Week view, drag-and-drop planning, capacity, flags, unplanned tray |
| 4. Automation | Roll-forward, Companies House checks, nightly and on-demand OneDrive export |
| 5. Groups and polish | Group view, other tasks, logos, deadlines list |

## Decided

- The practice owner is the Microsoft 365 admin.
- Code lives in a private GitHub repository, `practice-planner`. Client data is never committed.
- Engager import rules: see `scripts/import/README.md`.

## Open questions

- Hours available per weekday
- Whether 21 days is the right "tight" threshold
- Keep Engager's 12-stage accounts workflow, or simplify it?
- How outsourced preparation should appear in planning: tracked, but not counted against the owner's capacity?
- Time estimates per job type (Engager holds almost no time data)
