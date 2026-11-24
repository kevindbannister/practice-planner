# 00 · Menu & Duplication Audit

*Built from the running app (V35.58, demo data) and the source. Method: every route was crawled at 1440px (233 screens reached, 183 distinct route patterns); the visible links and buttons in each navigation region were recorded; then compared with `app/src/lib/navAreas.ts`, `app/src/ui/App.tsx`, `SettingsTabs.tsx`, `ClientPage.tsx` and the screen components. Raw data: `review/data/screen-inventory.csv`. Counts are for the demo data set; a few tabs only appear for some client types, so a real practice will see slightly more.*

## 1. Headline numbers

| Measure | Count |
|---|---|
| Distinct navigation destinations (links in any menu, tab strip or side list) | **129** |
| Distinct screens (route patterns) | **183** |
| Destinations reachable from more than one navigation region | **51** |
| Destinations that have more than one label | **28** |
| Labels that lead to more than one destination | **19** (e.g. "Overview" → 9 places, "Clients" → 3, "AML" → 3, "Working papers" → 3) |
| Navigation items labelled "Overview" | **9** (plus four more dashboards under other names: Home, Practice view, Work home, Advisory overview = **13 dashboard-type screens**) |
| Top-bar items visible at once (Practice mode) | **16**: logo, 3 mode icons, Home, 6 modules, Search, Alerts, Ask, New task, Profile (plus 6 in the Profile menu) |
| Menu *styles* the user can choose between | **8** (all showing the same modules) |
| Job card layouts the user can choose between | **4** |
| "Work by type" views / settings | 4 views + 4 switches |
| Distinct button visual styles measured on screens | **116** |
| Average buttons per screen / busiest screen | **25** / **165** |
| Distinct button labels for "save", "create", "download" families | ~26 / ~96 / ~16 |

## 2. Level 1: the always-visible frame (top bar)

| Label | Where it appears | Leads to | What it does |
|---|---|---|---|
| Logo "xproflow" | Every screen, top-left | `#/home` | Goes Home. (The Home icon beside the menu does the same thing in Practice.) |
| Mode switch: building icon / briefcase icon / bar-chart icon (no labels) | Top bar, every screen (phone: strip above the bottom bar) | Practice → `#/`, Work → `#/work`, Advisory → `#/advisory-overview` | Switches workspace. Tooltips only: "Practice: running the firm", "Work: clients' work", "Advisory: performance and advice". |
| Home (house icon) | Top bar, every mode | Practice `#/`, Work `#/work` ("Work home"), Advisory `#/advisory-overview` ("Advisory overview") | Goes to that mode's landing page. Same icon, three different labels and destinations. |
| **Practice mode modules:** Plan (with count badge), Clients, Sales, Email, Practice view, AML | Top bar | `#/plan`, `#/clients`, `#/sales`, `#/comms`, `#/practice`, `#/aml` | Module menu. 6 items. |
| **Work mode modules:** Clients, Working papers, Tax, Payroll, Co Sec | Top bar | `#/clients/<active client>`, `#/papers/<client>`, `#/tax/<client>`, `#/payroll`, `#/cosec/company/<client>` | Module menu. 5 items. "Clients" here goes to *the chosen client's page*, not the client list. |
| **Advisory mode modules:** Clients, Reporting, Freedom Plans, Tax planning | Top bar | `#/clients`, `#/reporting`, `#/advisory`, `#/taxplan` | Module menu. 4 items. |
| Search (box on desktop, icon on phone) | Top bar | overlay | Finds clients, jobs, tasks. Ctrl+K. |
| Alerts bell + count (e.g. "27 alerts") | Top bar | overlay panel → `#/actions` | Lists what needs attention; a button inside goes to the Action Centre. |
| Ask | Top bar (desktop); icon on phone | assistant drawer | AI assistant. |
| + (New task) | Top bar; floating "+" on phone | Quick-add overlay | Capture a task from anywhere. Alt+N. |
| Profile (initials) | Top bar | menu, see §3 | Account and preferences. |
| Version "P V35.58" | Top-left corner of every screen | none | Build number. |

## 3. Profile menu (6 items + chip)

| Label | Leads to | What it does | Note |
|---|---|---|---|
| Show tips on each screen | toggle | Shows or hides the grey explanation line under headings | **Duplicated** as a switch in Settings → Appearance → "Show tips". |
| Dark / Light mode | toggle | Switches theme | **Duplicated** in Settings → Appearance → "Light or dark" (3 choices there). |
| Settings (with waiting-count badge) | `#/settings` | Settings | |
| Appearance and menu… | `#/settings/appearance` | Settings page | Second route into Settings. |
| Development Hub | `#/devhub` | Internal tracker of which features are built | Developer tool in a user's menu (code comment says "only development administrators get in"). |
| Sign out | sign-out | | Not shown in demo. |

## 4. The 8 menu styles (Settings → Appearance → Menu style)

All eight render the same module list; they differ only in how modules and workspaces are switched.

| Style | What it is |
|---|---|
| Practice/Work + Advisory icon *(default)* | Two-way switch plus a separate Advisory icon |
| Three-way mode switch | Practice / Work / Advisory as a segmented control |
| Mode dropdown | Same three choices in a dropdown |
| Practice and Work switch | Older two-way switch (Advisory folded into Work) |
| Drop-down areas | Three areas (Practice, Work, Advise) as dropdowns |
| Drop-down, shows where you are | Same, with the current page named |
| Two lines | Areas on one line, modules on a second line |
| Area picker | Round area buttons then a module list |

Each has its own code path in `AreaMenu.tsx` / `App.tsx` and its own CSS (206 CSS rules mention `.topbar`). **Near-duplicates ×8.** Note also two *different* area models coexist: `AREAS` (Practice / Work / **Advise**: Work holds Papers, Tax, Payroll, Co Sec) and `WORKSPACES` (Practice / Work / **Advisory**: Work also holds Clients). The same item sits in different groups depending on the style chosen.

## 5. Level 2: second line and tab strips, by module

*(Second line = the strip under the top bar. "Region" = where it is drawn: S = second line, T = tab strip in the page, L = side list, P = pills in the page header.)*

### Plan (`#/plan`) · Practice mode
| Label | Region | Leads to | Does |
|---|---|---|---|
| Today | S | `#/plan/today` | Today's planned work; also holds Inbox and Unblock |
| Calendar | S | `#/plan` | Week view (the default Plan screen) |
| ↳ Week / Month / 6 weeks | S (sub) | `#/plan`, `/plan/month`, `/plan/rolling` | Calendar granularities. "Week" is the **same destination** as "Calendar". |
| List | S | `#/plan/deadlines` | Deadlines list |
| ↳ Deadlines | T | `#/plan/deadlines` | **Same destination** as "List" |
| ↳ Months ahead | T | `#/plan/months` | Workload by month |
| ↳ Projects | T | `#/plan/projects` | Business projects |
| ↳ Done | T | `#/plan/done` | Completed work |
| ↳ Overview | T | `#/plan/overview` | A planning overview |
| ↳ Reports | T | `#/plan/reports` | Work reports. **A second "Reports"** exists under Time. |
| Time | S | `#/plan/timesheet` | Timesheet |
| ↳ Timesheet | T | `#/plan/timesheet` | **Same destination** as "Time" |
| ↳ Time reports / Reports | T | `#/plan/time` | Two labels, one page |
| ↳ Billing / Rates / Team and approval / Data check | T | `#/plan/time/…` | Time billing, charge-out rates, approvals, checks |
| (not in any menu) Chase | – | `#/chase` | Reached from Home tiles and the bell |
| (not in any menu) Action Centre | – | `#/actions` | Reached from the bell |

### Clients (`#/clients`)
| Label | Region | Leads to | Does |
|---|---|---|---|
| Groups | S | `#/clients` | Client groups (empty in demo; **page has no heading**) |
| All clients | S | `#/clients/all` | Client list (**no heading**) |
| Client page: Overview | T | `#/clients/<id>` | Client summary cards (≈20 cards, many collapsible) |
| Work | T | `#/clients/<id>/work` | Group label *and* a tab. Contains Jobs, Tasks, Working papers |
| ↳ Jobs / Tasks / Working papers | T | `/work`, `/tasks`, `/papers` | |
| Communication | T | `/timeline` | **Group "Communication" contains a tab also called "Communication"**; plus Activity, Letters and emails, Meetings |
| Documents | T | `/signing` | Group; first tab is "Signing requests" (same destination, different label). Also Forms, Portal |
| Finance | T | `/invoices` | Group; first tab "Invoices". Also Tax payments, Numbers |
| Compliance | T | `/aml` | Group; first tab "AML". Also Clearance, Ceasing to act |
| Page-header pills: Advisory, Tax planning, Payroll, Client settings (gear) | P | `#/advisory/…`, `#/taxplan/…`, `#/payroll`, settings | Repeat of three top-level modules, on every client page (17–20 screens) |

### Sales (`#/sales`)
Overview, Pipeline, Proposals, Money (= **Fees & revenue**, same page `/sales/fees`), Billing (`/sales/billing`), Leads, Engagements and onboarding.

### Email / Comms (`#/comms`)
Email (`/comms`) · Letters and emails (`/comms/letters`) · Documents (`/comms/documents`: Create / Templates / History / Branding) · Meetings and calls · Payment reminders. Also a "Request receipts" button (new).

### AML (`#/aml`)
Overview · **Clients** (= **Client tracker**, same page `/aml/clients`) · **Firm** (= **Policies**, same page `/aml/policies`) · Risk assessment · ACCA checklist · ACCA return · Records · SAR and blank forms.

### Practice view (`#/practice`)
Single read-only firm dashboard (work, capacity, money, compliance, growth). **No heading** shown.

### Compliance (`#/compliance`, reached from Practice view; "Compliance" sits under the Practice menu item)
Overview · Dates and requests (= **Our dates**) · Requests and incidents · Records (= **Retention**) · **AML** (`/compliance/aml`) · Audit trail.

### Work mode
| Item | Region | Leads to |
|---|---|---|
| Strip: "Choose a client to work on" / client name + Client page + Working papers + Tax + Payroll + Co Sec + Change client | second line | client pages for the chosen client. **Duplicates the top-bar Work menu** (same four destinations) |
| Working papers | menu | `#/papers/<client>`; side list of sections; tabs Companies / Sole traders and partnerships / Production status |
| Tax | menu | `#/tax/<client>` (**no heading**) |
| Payroll | menu | `#/payroll` |
| Co Sec | menu | `#/cosec` with Overview / Filings / Companies; per company 7 tabs + 8 action screens |
| Work home (house icon) | | `#/work` "Client work" dashboard |

### Advisory mode
Advisory overview · Reporting (`#/reporting`) · Freedom Plans (`#/advisory`, 4 numbered steps) · Tax planning (`#/taxplan`). Second line: "Start a Freedom Plan" / "Start a tax plan".

### Settings (`#/settings`, 24 entries + 5 group tabs)
| Group | Entries |
|---|---|
| Firm (5) | Your week, Your firm, Appearance, Calendar, Backups |
| Work and pricing (5) | Types of work (+ stages), Your own fields, Services & pricing (+ Pricing rules), Clearance points, Sales |
| Documents and email (4) | Document design, Letters and email (+ Engagement letters), Forms, Onboarding |
| Connections (7) | Xero, Adfin, HMRC, Companies House, Co Sec, Xama, Detailed P&L |
| Checks and portal (3 pages) | Checks (Overview / Templates / Team and rules), Dependencies, Client portal (Overview / Approvals / Activity / Set-up / Changes / Identity) |

## 6. Overlays and toolbars

| Surface | Items / actions | Notes |
|---|---|---|
| Job card (4 layouts) | Stage steps; Now/Plan/Records/Billing/Hold; footer: Working papers, Email client, next-stage; tabs Job, Checklist, Time, More | Editable fields differ by layout version |
| Quick add (+) | Title, client, date | One of **at least 8 "add a task" entry points** (top bar +, "+ Task" on Home, client Work tab, Plan, Tasks page, job card, Chase, phone floating button) |
| Assistant (Ask) | Chat | Also reachable on a phone as an icon |
| Search | Ctrl+K | |
| Alerts panel | list, "Open Action Centre" | |
| Work by type gear | Include on hold, Group by statutory/other, Jobs to do first, Hide types with nothing to do | Plus 4 views chosen elsewhere (Appearance) |

## 7. Recurring actions: same job, different words

| Job | Labels actually used |
|---|---|
| **Create** | Add, + Add a note, New email, New letter, New meeting, New template, New tax return, Start (a review / an assessment / the register), Create, Log a call, Add company, Add a person / Add person, Add item / section / condition, Start a Freedom Plan, Add a one-off charge… (≈96 distinct "add/new/start" labels) |
| **Save** | Save, Save template, Save wording, Save and versions, Save to my templates, Save draft, Save date, Save branding, Save intervals, Save points, Save administrators, Save activity codes, Save designs, Save my view, Save the practice look, Save this view, Save these, Update, Update job, Apply, Done (≈26) |
| **Download / output** | Download CSV, Download as CSV, Export CSV, CSV, Print, Print or PDF, PDF, Download PDF, Download pack, Download Excel, Download Word, Download a copy (≈16) |
| **Refresh / check** | Refresh, Refresh emails, Refresh from Xero / Companies House / GitHub, Check now, Check Adfin, Look for changes, Run date checks now, Test connection |
| **Remove** | Delete, Remove, Archive, Ceasing to act, Disengage, "Delete section", "Delete item" |
| **Go back** | ← Overview, Back to templates, Back to the usual, Back to today's numbers, Back to Home |
| **Cancel** | Cancel, Close, Not yet, Undo |

## 8. Preferences that exist in more than one place

| Preference | Places it can be changed |
|---|---|
| Light / dark | Profile menu; Settings → Appearance; (OS setting) |
| Tips on/off | Profile menu; Settings → Appearance |
| Menu style (8) | Settings → Appearance only (profile menu copy removed) |
| Practice page layout (tabs or side list) | Settings → Appearance |
| Work by type view (4) | Settings → Appearance |
| Work by type switches (4) | Gear on Home |
| Job card layout (4) | Settings → Appearance |
| Practice look (colours, background) | Settings → Appearance |
| Personal vs practice-wide | Mixed: "Your view" is per person; "Practice look" is for everyone, on the same page |

## 9. Keyboard shortcuts
Ctrl/⌘+K Search · Alt+N Quick add · Alt+Arrows move a card in Month view · Esc closes overlays. **None are listed anywhere in the app.**

---

## 10. FLAGS

### A. Exact duplicates (same destination or action, several places, no good reason)
1. **Home**: logo + house icon + "Practice" mode icon all lead to the same Home in Practice mode.
2. **Calendar = Week** (`#/plan`), **List = Deadlines** (`#/plan/deadlines`), **Time = Timesheet** (`#/plan/timesheet`): a tab and its own first sub-tab are the same page.
3. **Time reports = Reports** (`#/plan/time`).
4. **Client page group = first tab** for Documents/Signing requests, Finance/Invoices, Compliance/AML; Communication contains "Communication".
5. **Work-mode strip (Working papers, Tax, Payroll, Co Sec)** repeats the Work menu above it. The client-page pills (Advisory, Tax planning, Payroll) repeat Advisory/Work menu items.
6. **Client portal** is reachable from Settings → Checks and portal → Client portal, from the client page → Documents → Portal, and (for individuals) from a client Overview card ("Portal access"); the Profile menu's Settings item carries a portal waiting-count badge.
7. **Light/dark and Tips** in both the Profile menu and Appearance.
8. **Settings** reachable from Profile → Settings, Profile → Appearance and menu…, and the "Checks" tab group.
9. **Overview of AML** exists in AML → Overview, Compliance → AML, client → Compliance → AML, and the AML card on a client Overview.
10. **Working papers** reached from: Work menu, Work strip, client Work tab → Working papers, job card footer "Working papers →", chips on job cards, client Overview.
11. **Add task** has ≥8 entry points (see §6).

### B. Near duplicates (different screens doing nearly the same job)
1. **Thirteen dashboard-type screens**: Home, Work home, Advisory overview, Practice view, and nine items labelled "Overview" (Plan → List → Overview, Sales, AML, Compliance, Co Sec, a Co Sec company, Checks, Client portal, a client's Overview): each a tiles-and-lists dashboard built separately.
2. **Eight menu styles** for the same module list.
3. **Four job card layouts**; **four Work-by-type views**; **two Practice page layouts**.
4. **Reports** ×3: Plan → List → Reports, Plan → Time → Reports, and the Reporting module (Advisory); plus Settings → Detailed P&L.
5. **Billing / invoicing** ×5: Plan → Time → Billing, Sales → Billing, Sales → Money (Fees & revenue), client Finance → Invoices, Settings → Adfin; plus Payment reminders under Email and the new "Invoices to raise" job type.
6. **Compliance** ×3: Compliance module, AML module, client Compliance group (and "Clearance", "Ceasing to act").
7. **Deadlines** ×6: Plan → List → Deadlines, Months ahead, Calendar, Practice view tiles, Home "Work by type", Work home "Client work", client Overview. (Home tiles now link into the Deadlines list.)
8. **Chasing** ×3: Plan → Chase page, job card "Chase", Payment reminders; Collections (Billing).
9. **Tax** ×4 meanings: Tax (return preparation), Tax planning (advisory), Tax payments (client Finance), Tax references (client card).
10. **Documents** ×4: Email → Documents, client Documents group, Settings → Document design, Settings → Documents and email group.
11. **Templates** ×3: Comms documents templates, Checklist templates, Settings → Letters and email templates.
12. **Mail** ×3: Email (inbox), Letters and emails (log), client Communication / Letters and emails / Meetings.
13. **Practice view vs Compliance vs Action Centre** all answer "what needs my attention?" in a different place.

### C. Same thing, different names
| Concept | Names in use |
|---|---|
| The firm's own dashboard | Home · Practice view · Practice (the mode) |
| Client dashboard | Overview · Client page · Clients |
| A client's jobs | Jobs · Work · Open work · Client work |
| Papers | Working papers · Papers (phone) · Companies / Sole traders (tabs) · Production status |
| Calendar | Calendar · Week · Plan |
| Timesheet | Time · Timesheet · Time reports · Reports |
| AML client list | Clients · Client tracker |
| AML firm policies | Firm · Policies |
| Firm's regulatory dates | Dates and requests · Our dates |
| Retention | Records · Retention (Compliance) / Records (AML) |
| Fees | Money · Fees & revenue (Sales) · Fee schedule · Services and fees (client) |
| Portal approvals | Approvals · Changes |
| Settings "Firm" | Firm · Your week · Your firm |
| Product name | "xproflow" (logo) · "Xproflow" (UI copy) · brief: "XProFlow" / "X-Pro Flow" |
| The Work mode | Work · Advise (AREAS) · Advisory (WORKSPACES) |

### D. Rarely needed items occupying prime space
1. **Development Hub** in the Profile menu (an internal tracker).
2. **Practice view, AML, Sales, Co Sec, Payroll** as permanent top-bar items for a single-partner practice that uses each occasionally (AML and Co Sec especially).
3. **Ask** button given primary-button weight on every screen.
4. **Version string** shown on every screen.
5. **All three mode icons + Home icon + menu-style choices** shown permanently although most days one mode is used.
6. **Settings** items that are one-time set-up (Backups, Xama, Detailed P&L, Clearance points, Onboarding, Document design) listed at the same level as daily-use ones (Your week).
7. **"Client settings" gear and three cross-module pills** on every client page.

### E. Unfinished or confusing entry points
1. **Client portal** screens call `/api/portal/admin/*`, which return 404 in this build (8 screens log console errors). The portal **already exists** as a separate app (`src/portal`, `api/portal`, `docs/client-portal.md`). The brief says the portal is future work; reconcile.
2. **Screens with no heading**: Clients, All clients, Groups, Practice view, Tax, Chase, Actions (title only in the second line, if at all).
3. **Empty demo screens** read as broken: Groups/Clients with no groups.
4. **Development Hub** shows build-status of features to a normal user.
5. **Co Sec action tiles** that open placeholders when no data exists.
