# 00 · Discovery: XProFlow

*Phase 0 of the full review. Lead reviewer's own work, done before any expert started. Companion file: `review/00-menu-audit.md` (every menu, tab, button and shortcut). Machine data: `review/data/screen-inventory.csv`. Screenshots: `review/screenshots/` (20 screens × desktop 1440 / tablet 820 / phone 390, plus job card, profile menu and quick-add overlays).*

Version reviewed: **V35.58** (branch `claude/funny-tesla-do9hqm`, same as `main`). **No code was changed** in this review.

## 1. How the review was run

| Item | Detail |
|---|---|
| Ran locally? | **Yes.** `npm run dev` serves `http://localhost:5173` against an in-browser fake SharePoint ("demo data store"). Playwright (Chromium) drove it. |
| Data used | A small demo set: 3 clients (Acme Ltd, Brown & Co, Cole Trading), ~17 jobs across VAT, accounts, payroll, SA100, bookkeeping, 1 stage-template set per type. **Real practices have far more data**, so list screens, long names and busy states are under-represented. |
| What can't be seen | Microsoft sign-in, real SharePoint latency, the Outlook/Graph, Xero, Adfin, HMRC, Companies House and AI integrations (faked or unavailable), and the client portal back end (`/api/portal/admin/*` returns 404 locally). |
| Method | Crawled all reachable routes at 1440px (233 screens), recorded navigation regions, button styles and font sizes per screen; screenshots at three widths; code read of `App.tsx`, `navAreas.ts`, `bits.tsx`, `styles.css`, settings and client page. |

## 2. Technology and structure

| Area | Finding |
|---|---|
| Framework | React 19 + TypeScript 6, bundled with esbuild (`build.mjs`), code-split per area (`chunks/`). Single-page app, PWA manifest + service worker. |
| Routing | **Hash routing** (`#/plan/deadlines`) with a hand-written `useRoute()` in `ui/bits.tsx` and one big `if/else` on the first path segment in `App.tsx`. No router library, no nested layouts, no route-level metadata (title, breadcrumbs). |
| State/data | React context (`useData`) over 97 SharePoint lists via Microsoft Graph; settings saved as rows in a Settings list. Local personal prefs in `localStorage`. |
| Auth | Microsoft 365 (MSAL-style PKCE) in `lib/auth.ts`; practice-only. |
| Styling | **One global stylesheet**, `public/styles.css`: **5,523 lines / 461 KB**, plain CSS, no Tailwind, no CSS modules, no component library. Fonts: Atkinson Hyperlegible Next (Google Fonts) and a mono face. |
| Components | 204 `.tsx` files in `src/ui` (49k lines), 225 `lib` files. Shared building blocks are few (`bits.tsx`: ~18 exports: `Icon`, `GroupedTabs`, `MoreMenu`, `SideTabs`, `Brand`, chips) and **there is no shared Button, Card, Table, Modal, Field or Form component**; each screen writes its own markup using class names. |
| Inline styling | **4,054** `style={{…}}` attributes across `src/ui`, and 183 hard-coded hex colours in TSX. |
| Tests | 1,538 unit tests (logic); **no UI, visual or accessibility tests**. |
| Separate client portal | `src/portal` (19 files, ~1.4k lines), `api/portal`, `public/portal.html` + `portal.css`, `docs/client-portal.md`. A **second front end with its own design tokens** (`--p-*`, primary `#0f4c81`). Staff screens for administering it (Settings → Client portal, client → Portal) call endpoints that 404 in this build. The brief says clients do not log in yet; this needs reconciling. |
| Other | `extension/` (browser extension), `api/*` (Azure Functions: Xero, Adfin, HMRC, CH, AI, MCP, etc.), `src/accept` (a signing page). |

## 3. Screen inventory

*183 distinct route patterns reached (233 screens incl. per-client instances). Full list in `review/data/screen-inventory.csv`; grouped here.*

| Area | Route(s) | Purpose | Main actions | Screens |
|---|---|---|---|---|
| **Home** | `#/`, `#/home` | Practice dashboard: greeting, "what needs me", tiles (Late, Due in 7 days, To chase, Checks, Done), **Work by type**, today's plan | Open the plan, Practice view, Payroll, Deadlines; tile links; gear/targets on Work by type | 1 |
| **Plan** | `#/plan` (Week), `/month`, `/rolling`, `/today`, `/deadlines`, `/months`, `/projects`, `/done`, `/overview`, `/reports`, `/timesheet`, `/time/*` | Scheduling: calendar, deadline lists, projects, timesheets, time billing | Drag jobs to days, Suggest my week, Connect calendar, filters, CSV/Print | 16 |
| **Chase / Action Centre** | `#/chase`, `#/actions` | Records to chase; everything needing action | Email, Log a call, Records in, dismiss | 2 (reached from tiles/bell only) |
| **Clients** | `#/clients`, `/all`, `#/groups` | Groups; all-clients list; bulk actions | Open client, add, filters | 3 |
| **Client page** | `#/clients/<id>[/work\|tasks\|papers\|timeline\|activity\|comms\|meetings\|signing\|forms\|portal\|invoices\|tax\|numbers\|aml\|clearance\|disengage]` | Everything about one client; ~20 collapsible cards on Overview; 6 tab groups | Update job, + Job, + Task, edit details, add missing fields | 17 per client |
| **Sales** | `#/sales/*` | Pipeline, proposals, fees, billing, leads, engagements/onboarding | New lead/proposal | 7 |
| **Email / Comms** | `#/comms/*` | Inbox, letters & emails log, documents (create/templates/history/branding), meetings, payment reminders, **Request receipts** | New email/letter/meeting, create from template | 21 |
| **Practice view** | `#/practice` | Read-only firm dashboard | Drill into any figure | 1 |
| **Compliance** | `#/compliance/*` | Risk register, firm dates, requests, retention, audit | Add/close items | 7 |
| **AML** | `#/aml/*` | Risk assessment, policies, client tracker, ACCA forms, records | Start assessment, SAR forms | 16 |
| **Work home** | `#/work` | Client-work dashboard (late, due, ready to start; by type) | Working papers, Tax, Payroll, Co Sec, All deadlines | 1 |
| **Working papers** | `#/papers[/<client>[/<period>]]` | Accounts working papers, schedules, production status | Section list, journals, sign-off | 6 |
| **Tax** | `#/tax/<client>[/<year>]` | Personal/company tax return preparation | Fill return, import | 3 |
| **Payroll** | `#/payroll` | Payroll schemes, runs | Run payroll | 1 |
| **Co Sec** | `#/cosec[/filings\|companies\|company/<id>/…]` | Company secretarial: officers, shares, PSCs, registers, filings, CS01, dividends | Appoint, allot, file | 18 |
| **Advisory** | `#/advisory-overview`, `#/advisory/<id>/…`, `#/reporting`, `#/taxplan/…` | Freedom Plans, reporting, tax planning | Start a plan | 12 |
| **Settings** | `#/settings/<24 entries>`, `#/checklists/*`, `#/dependencies`, `#/portal/*` | Configuration | Many save forms | 41 |
| **Dev Hub** | `#/devhub/*` | Internal feature tracker | | 8 |
| **Setup** | `#/setup` | First-run: create lists, import data | | 1 |

### Overlays: dialogs, drawers, panels
Job card (4 layouts, right drawer), Task card, New job, New task / Quick add, Project card, Search palette (Ctrl+K), Alerts panel, Profile menu, Assistant ("Ask") drawer, Work by type breakdown dialog, Work by type gear panel, Banner menu, Quick journal (working papers), Client action panel, Document create/preview dialogs, Elements/HMRC/Tax bulk import dialogs, Reporting report editor, Client deck, Dev Hub board dialogs. **34 `window.confirm()` calls** are used for confirmations/destructive actions (native browser dialogs, unstyled, no undo).

## 4. Core user journeys to walk (shared with every expert)

| # | Journey | Start | Notes |
|---|---|---|---|
| J1 | Add a new client | Clients → All clients, or onboarding from Sales | companies from Companies House number? |
| J2 | See what's due this week / today | Home, Plan → Today / Week, Plan → List → Deadlines | morning check |
| J3 | Create and assign a task | top-bar +, client → Tasks, Plan | owner/assignment, due date |
| J4 | Take a job from "records in" to complete, and decide on an invoice | Plan/Deadlines → job card → stage done → Complete | new invoice job logic |
| J5 | Find a client / a job quickly | Search (Ctrl+K), Clients list | |
| J6 | Review workload across staff | Home Work by type (scope switch), Plan → Months ahead, Practice view | single-partner practice today, but staff supported |
| J7 | Chase a client for records | Home "Records to chase" → Chase page; job card "Chase" | |
| J8 | Prepare accounts (working papers) for a client | Work mode → Working papers | journal, sign-off |
| J9 | Prepare/file a confirmation statement | Work mode → Co Sec → company → Confirmation statement | |
| J10 | Request receipts from a client with a spreadsheet | Email → Letters and emails → Request receipts | new |
| J11 | Set up types of work, stages and when work can start | Settings → Types of work | |
| J12 | Change how the app looks / behaves | Profile → Appearance | 8 menu styles, 4 job cards |
| J13 | Win and onboard a client | Sales → Leads → Proposals → Engagements and onboarding | |
| J14 | Phone: see today, start a timer, record a call | phone viewport | |
| J15 | Handle an AML check for a new client | AML / client → Compliance | |

## 5. Design system status

| Question | Finding |
|---|---|
| Is there a design system? | **Partial tokens, no components.** `:root` defines **107 CSS custom properties** (`--ground`, `--surface`, `--ink`, `--blue`, `--amber-*`, `--red-*`, `--svc-0…7`, `--grad`, `--navy`, etc.) with dark-mode overrides. Spacing, type scale and radii are **not tokenised**. |
| How consistently used? | `var(--…)` appears 2,210 times, but **926 hard-coded hex values (333 distinct)** and 413 `rgba()` remain; 126 `!important`. 58 distinct `border-radius` values, 39 `font-size` values; **28 distinct text sizes** measured on live screens. |
| "Built at different times" evidence | The stylesheet is a stack of **83 version-stamped override blocks** (`/* V35.xx … */`) appended on top of earlier rules: `.btn` has 62 rules, `.card` 86, `.drawer` 70, `.topbar` 206. Many components are re-skinned by later blocks with `!important`. |
| Component duplication | **116 distinct button visual styles** measured across screens; no single Button; each screen hand-rolls tables, cards, tabs, empty states, forms. Tab strips exist in at least 6 forms (`page-tabs`, `GroupedTabs`, `subtabs`, `cs-tabs`, `side-tabs`, `rail`, `PlanTabs`). |
| Breakpoints | Effectively one: `720/721px` (≈140 of 258 media queries), plus 800/900/1100 one-offs. No tablet-specific layer. |
| Brand | Logo: dark-navy "xproflow" wordmark with a wave in the "w" (`public/logo.png`), inverted to white on dark bars. Colours in use for "brand": `#0A64D8` blue (`--primary`), `#1B3049` navy (Work bar / buttons), purple `#2E2368` (Advisory), blue→lavender gradient (Practice), teal `#0b4f6c` (manifest `theme-color`), `#0f4c81` (portal). **Four different "primary" blues**. Product name appears as "xproflow" (logo), "Xproflow" (UI copy), brief says "XProFlow / X-Pro Flow". |

## 6. The three modes side by side

The mode switcher is three unlabeled icons in the top bar (tooltips only). Intent (from the in-app tooltips): **Practice** = "running the firm", **Work** = "clients' work", **Advisory** = "performance and advice". There is also an 8-way **menu style** setting that changes how they are switched, and a separate **dark theme**, so a user can see up to 3 × 2 colour schemes × 8 menu structures.

| | **Practice** | **Work** | **Advisory** |
|---|---|---|---|
| Purpose (user-facing) | Running the firm: plan, clients, sales, email, firm dashboard, AML | Doing clients' work: papers, tax, payroll, co sec | Advice products: reporting, Freedom Plans, tax planning |
| Landing | Home (`#/`) | Work home (`#/work`) "Client work" | Advisory overview |
| Top bar colour | Pale blue→lavender gradient (user-selectable preset), dark text | **Navy `#1B3049`** (selectable: 6 presets), white text | **Purple `#2E2368`** (selectable: 6 presets), white text |
| Second line | Page tabs on a white-or-gradient line (per module) | **Client strip**: "Choose a client to work on" → client name + Client page / Working papers / Tax / Payroll / Co Sec / Change client | Page name + "Start a Freedom Plan / Start a tax plan" |
| Page canvas | Light grey `#F4F6F9` | Darker grey `#E7EBF0` | Darker grey `#E7EBF0` |
| Modules (count) | Plan, Clients, Sales, Email, Practice view, AML (6) | Clients\*, Working papers, Tax, Payroll, Co Sec (5) | Clients, Reporting, Freedom Plans, Tax planning (4) |
| Mode-specific navigation | Tabs inside module | Client-scoped (menu items need a chosen client) | Plans with numbered steps |
| Shared accents | Same service-dot palette, same status colours (red/amber/green), same buttons | | |
| Colour as orientation? | Yes, strongly, by bar colour | Yes | Yes |
| But also | "Clients" appears in all three modes with different behaviour; Work-mode items change meaning depending on the active client; the same page (e.g. Working papers, Co Sec) can be reached from Practice via links and shows Work colours |

\* In Work mode "Clients" opens the *chosen client's page*, not the client list.

## 7. Facts relevant to a future client portal (flag only)

1. Routing and layout are **staff-only**: the `App.tsx` switch, the top bar and every screen assume a signed-in Microsoft user with full access; there is no role-aware layout or permissions layer in the UI shell (role checks are scattered: `can(cfg, user, …)`).
2. A **separate portal bundle** with its own CSS tokens and components already exists; the staff and portal UIs share **no components, tokens or brand definitions**.
3. The staff navigation (modes + modules + 8 styles) is built around internal workflows, not around a client's view, so a portal can't reuse it, and a sensible shared design system would need to cover both.
4. Staff-side portal admin screens are spread across Settings, client tabs, client overview, and the profile badge.

## 8. Quick observations to test (not yet findings)

* 7 screens have no `<h1>` (Clients, All clients, Groups, Practice view, Tax, Chase, Action Centre).
* 8 screens log 404s in the console (portal-related).
* Mode icons have no visible labels except in the three-way style.
* The job card has 4 layouts and the home Work by type has 4 views + 4 switches; many were added as options during the last weeks.
* 34 native `confirm()` dialogs; only 11 `aria-live`/`role="status"` usages in 204 UI files; very few `alt` attributes (icons mostly decorative SVG).
* Everything below 721px is "phone"; tablets (820px) get the desktop layout.
* Co Sec, Working papers, Tax and Payroll are four big modules; each has its own sub-navigation pattern.

## 9. Where the experts should look

Start from `00-menu-audit.md` (what exists) and the screenshots; run the app with the helper at `…/scratchpad/hw6.mjs` (see each expert's brief). Every finding needs a real screen, element or text as evidence.
