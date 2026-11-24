# Shared brief for every expert reviewer (Phase 1)

You are one of eight independent expert reviewers of **XProFlow**, a practice planner web app for UK accountancy practices (manages clients, deadlines, tasks and workflow). This is not only a code review: the owner wants to know **how the app looks, how it feels to use, and how easy it is to understand**. Code matters mainly where it helps or blocks those things.

**The goal:** a user should feel that everything in XProFlow is self-explanatory and straightforward. They should know where they are, what they can do, and what happens next, without training or guesswork.

## Rules (read carefully)
1. **Do not change any code or app data.** Your only writes are: your own report `review/01-<expert>.md` (path given in your task), optional screenshots in `review/screenshots/<expert>/`, and throw-away scripts in your own scratch folder (path given in your task). No `git commit/add/checkout/reset`, no `npm install`, **do not stop, restart or rebuild the dev server**, do not edit anything under `app/`, `api/`, `docs/`.
2. **Be independent.** Do not read any other expert's report (`review/01-*.md` other than your own, `review/02-*`, `review/03-*`). They are being written in parallel and must not influence you.
3. **Evidence first.** Every finding must point at a real screen, element, piece of text, screenshot or code location. Quote exact labels. Re-check a claim before you write it. If you are unsure, say so rather than guess.
4. Prefer simple, consistent and obvious over clever. Think about the real user: a busy accountant or practice administrator, often under deadline pressure, who wants to get in, see what matters and get on with it.
5. If you need a decision from the owner, put it under **"Questions for the owner"** at the end of your report. Don't guess.
6. Be efficient with the machine: run **one browser at a time**, close it when done (`await b.close()`), keep scripts short. Seven other reviewers are using the same dev server.

## Owner context
* **Users today:** a single partner uses XProFlow. It is practice-only; clients do not log in.
* **Future:** a client portal (clients logging in) is planned. *Do not design or build it.* Do flag anything in navigation, layout, design system or component structure that would have to be torn up when it arrives. (Note: a separate portal app already exists in `app/src/portal`, `api/portal`, `docs/client-portal.md` with its own CSS tokens; the owner's brief treats the portal as future work.)
* **Devices:** desktop is the priority (laptop/large monitor); the app must also work well on tablet and phone. Design desktop-first, then every core journey must be usable on tablet and phone.
* **Brand:** product name is **XProFlow** (shown as "X-Pro Flow"); there is an existing logo (`app/public/logo.png`, dark-navy wordmark). Keep both. The app has **three modes** (Practice / Work / Advisory), each with a different colour scheme (see `review/00-discovery.md` §6). Judge whether the differences help the user or add inconsistency.
* **Owner's #1 frustration: too many duplicates.** Lots of menu options and multiple versions of the same thing. The top priority of the whole review is to cut menus and options down as far as possible while keeping all functionality. Everything should feel simple.

## Scope
**In scope:** visual design, layout, navigation, interface consistency, usability, user journeys, wording and labels, accessibility, responsiveness, feedback and error handling, onboarding and empty states, perceived performance, and the front-end code/components that drive these.
**Out of scope:** features known to be incomplete or not yet functional (for example, *filing of accounts*). Do not review how complete they are or plan to build them. **Exception:** if an unfinished feature *confuses users* (a dead button, a menu item that leads nowhere, a screen that looks broken) flag it under your findings and recommend how to present it (hide it, disable with a clear "coming soon" label, or remove the entry point).

## Starting material (read first)
* `review/00-discovery.md`: stack, screen inventory, journeys J1–J15, design-system status, the three modes.
* `review/00-menu-audit.md`: every navigation item/button/shortcut and the duplication flags.
* `review/screenshots/`: desktop (1440), tablet (820) and phone (390) captures of 20 key screens, plus `job-card-*`, `profile-menu-*`, `quick-add-*`. File pattern `<screen>-<desktop|tablet|phone>.png`.
* Crawl data (JSON, one record per screen: nav regions, button styles, font sizes, console errors): `/tmp/claude-0/-home-user-practice-planner/3420d493-4ad5-5888-b825-cfa220677f11/scratchpad/lead/crawl-1440.json`, `btns.json` (page-level button labels per screen).
* Source: `app/src/ui/*.tsx`, `app/src/lib/*.ts`, `app/public/styles.css`.

## Running the app
The dev server is **already running at http://localhost:5173** (in-browser demo data; 3 clients, ~17 jobs). Use Playwright:
```js
import { boot } from '/tmp/claude-0/-home-user-practice-planner/3420d493-4ad5-5888-b825-cfa220677f11/scratchpad/hw6.mjs';
const { b, page, errs, base } = await boot({ width: 1440, height: 900 });   // loads the demo data (takes ~30 s)
await page.evaluate(() => { location.hash = '#/plan/deadlines'; });          // navigate by hash
await page.waitForTimeout(1500);
await page.screenshot({ path: '…/review/screenshots/<expert>/name.png' });
await b.close();
```
`boot` creates a fresh browser with its own demo data store (nothing you do affects anyone else, and you may create/edit/delete records freely in your own browser). Playwright is `require('/opt/node-tools/node_modules/playwright/index.js')`. Take screenshots at `deviceScaleFactor` 1. Put your scripts in your own scratch folder, written as `.mjs`. For a tablet use width 820, phone 390.
Demo limits: no Microsoft sign-in, Outlook/Xero/HMRC/AI integrations are fakes or unavailable; client-portal admin calls 404 (expected, but how it presents is fair game).

## Finding format (every expert, every finding)
```
### <ID> · <Title (one line)>
- **Where:** screen/route, and file path or component where relevant
- **What's wrong:** concrete and specific, with evidence (screenshot reference, code snippet or exact text)
- **Impact on the user:** who is affected and how
- **Severity:** Critical (blocks or seriously misleads) / High / Medium / Low
- **Effort to fix:** S / M / L
- **Recommendation:** specific, not generic. ("Rename 'Process' to 'Mark as complete'" is good. "Improve labels" is not.)
```
IDs are prefixed by your expert code (`UX-01`, `VIS-04`, `A11Y-07`, `IA-02`, `CONT-05`, `DOM-03`, `FE-06`, `QA-09`), numbered from 01.

## Report layout
1. Title and one-paragraph overall impression from your discipline.
2. **What works well** (so the plan protects existing strengths): 5–10 specific bullets.
3. Findings, ordered by severity (Critical → Low). Aim for the **15–35 most important findings**; merge similar ones; don't pad. Group tiny repeated issues into one finding listing all instances.
4. A summary table at the end: ID · title · severity · effort.
5. **Questions for the owner** (only real decisions you need).
6. Optional: any appendix (measurements, scripts, screenshot list).

When you finish, reply with a short message: the path of your report, the number of findings by severity, and your top 5 findings in one line each.
