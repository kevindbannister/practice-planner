# Co Sec: change of accounting reference date on request, and no assumed dormant accounts

Branch `cosec-aa01-on-demand` (not merged to main, nothing deployed).

## What changed

**AA01 is something a person starts.** Nothing in Co Sec prepares accounts or assumes a company needs dormant accounts. Accounts are done in Working Papers and Accounts Production.

- **Start it from the company:** Overview › Change accounting reference date, or the button on the Filings tab. It is there for every limited company and LLP.
- **The right form:** a company gets AA01; an LLP gets LL AA01 (form id `LLAA01`). AA01 no longer applies to LLPs.
- **Prefilled from Companies House:** the period being changed, from the accounting period Companies House last showed and the incorporation date. The previous period has to be typed in, since Companies House's record only shows the current one.
- **Rules checked before it can be approved** (`lib/cosecArd.ts`):
  - the current or the immediately previous period can be changed;
  - an extension can't go past 18 months from the period's start, except in administration;
  - a second extension within five years needs one of the exceptions. The planner can't know a company's history before it was added, so this is asked, never guessed;
  - the new date can't equal the old, or fall before the period's start.
- **Read before filing, not blocking:** the likely new accounts deadline (an extension is nine months after the new end; a shortening is the later of that and three months after Companies House receives the form), a warning when a previous period's usual deadline has passed, and a reminder that the corporation tax period and HMRC dates move too.
- **One draft at a time.** Starting a second change updates the open draft and withdraws any approval it had. A change already with Companies House blocks another.
- **Filing is unchanged:** reviewed, approved, filed at Companies House by a person, then recorded. The gateway still has only AD01.
- **On acceptance** (or "filed externally"), Companies House's last-shown year end and the planner's own year end both follow. Without the second one, the next comparison with Companies House would draft the change straight back. The accounts due date is not guessed: the activity asks for a refresh from Companies House and a check of the tax and accounts jobs.
- **Editing the client's year end still drafts one** (that rule is unchanged), but now picks AA01 or LL AA01 by company kind. That draft has only the new date. To have the rules checked, use Change accounting reference date, which keeps the period's dates.

**Dormant accounts are no longer started from Co Sec.**

- The "Dormant accounts" card no longer appears on every limited company's overview, and the "Start the accounts" form is gone.
- Companies that already have a job started here keep a "Dormant accounts (earlier jobs)" card, so those can be finished or looked up.
- `lib/cosecDormant.ts`, its tests and the `PP CoSec Accounts` list are untouched. Nothing was deleted. If accounts for dormant companies are wanted later, they belong in Accounts Production, which already has a dormant type.
- Settings › Co Sec describes this.

## Checks

- 19 new tests in `tests/cosecArd.test.ts` (rules, deadlines, the LLP form, one-draft behaviour, acceptance).
- App suite: 1,376 pass and 15 fail, the same 15 that fail on clean main in this environment, all because `pdf-lib` and `pptxgenjs` aren't installed here. The dormant and overview tests are among those, so they have not been run against this change. Run `npm test` where packages are installed.
- Not exercised in a browser. The new screen and the review-screen fields type-check but have not been clicked through.

## Worth knowing

- The rules come from Companies House's guidance and secondary sources checked on 13 November 2026. Companies House has talked about limiting how often a company can shorten; that is not coded, and the screen says to check current guidance.
- The first accounts of a new company follow their own deadline rule. The screen's deadline is a guide and says so.
