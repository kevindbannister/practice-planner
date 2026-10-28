# Company Secretarial: phases 2 to 7 report

Branch: `cosec-phases-2-7` (pushed, **not merged to main**, nothing deployed). Phases 0 and 1 are already on main.
Tests at the end: app 648 passing, api 242 passing. The app builds in demo mode.

## What was built

**Phase 2: historical import and registers.** Import share transactions, officers and PSCs from manual rows, CSV/XLSX or the text of a PDF register. Everything is staged, checked (dates, numbers, ledger balance by replay) and reviewed item by item; only accepted items are saved, and the whole import is approved and audited (`CoSecImports`). Printable registers (members, transactions, officers, PSCs) as CSV or PDF as at a date; sensitive columns only for approvers. Officers can be compared with Companies House.

**Phase 3: approvals and completion.** Each filing records whether client approval is needed (mandatory for NM01, SH01, STT). Approval by client portal signing or by recording a signed copy; no ID or personal codes stored. Internal approval is blocked until client approval is in. Filings can be completed once done, and completing a share filing writes the share ledger. Share transfers (STT) are a no-filing form.

**Phase 4: confirmation statement (CS01).** Guided review from the company's own records: capital, shareholders, officers, PSCs, identity-verification status, SIC/office, blockers and warnings. Prepared and approved here; **filed externally**. Fee comes from an editable schedule.

**Phase 5: share capital and dividends.** Class rights (votes, dividend rights, redeemable, restrictions). Ownership by shares and votes at any date, with a PSC check against the PSC register (a prompt, not a change). Share certificates: unique never-reused numbers, issue/replace/exchange/cancel, holdings cover check, PDF. Dividends: exact-penny maths from the ledger at the record date, per-share or total, waivers that need a document reference, mandatory distributable-profits review before declaring, drift check against the ledger, minutes, schedule and vouchers as PDFs.

**Phase 6: dormant (never traded) accounts only.** Eligibility checks (period, company active, CH expected period, no share issues/dividends/premium, capital on the ledger, director to sign, a person's confirmation that the company never traded). Deadline and late-penalty calculation per Companies House's published rules. Draft accounts (balance sheet with dormant statement, audit-exemption wording, notes, comparatives) and a note for the director. Workflow: prepared → director approval (needs signed copy saved) → filed (recorded by a person) → accepted. **The job is only complete when Companies House's record moves on or a person records the acceptance evidence; producing a PDF never completes it.** If the ledger changes after preparation, approval is refused until the accounts are prepared again.

**Phase 7: settings and final checks.** Settings › Co Sec: editable fee schedule and a plain list of what is and isn't automated.

## Testing levels
- **Unit tests** (all logic in `app/src/lib`): every phase.
- **Browser, demo data:** each phase's screens were driven through a full flow in the demo build (create, review, approve, download PDFs, save to documents).
- **Not tested live:** anything against real Companies House submission, the live client portal signing route, real SharePoint/OneDrive saving, and HMRC.

## Safety constraints kept
No production SharePoint lists deleted or recreated (new lists and columns are added only); no live data touched; no live filing; no deploy; personal and authentication codes are never stored; non-client companies are added to the prospect list.

## Limitations to know about
- No filing is submitted to Companies House. The AD01 gateway exists but is blocked by configuration and unproven. A CS01 submission adapter was not built because the Companies House technical specification could not be downloaded from this environment.
- PDF import is text matching with page references, not AI; low confidence by design and always reviewed.
- Facts taken from secondary sources and flagged in the screens: the CS01 fee (£50, third-party article) and the rule that directors must be identity-verified before a CS01 is accepted. Dormant accounts deadlines, penalties, definition and the 1 April 2028 software-only change were checked against GOV.UK guidance.
- Dormant accounts wording is standard small-company wording shown to the director; have it reviewed once. Paid-up status of shares not recorded on the ledger is treated as unpaid and flagged.
- Accounts for trading companies, FRS 105/102 1A with iXBRL, and filing accounts electronically are out of scope.
- Dividends do not work out tax, and whether profits are distributable is the reviewer's decision.
- Portal signing is reused from the existing portal code and has not been exercised live.
- Companies that are only prospects (Co Sec only) have no ledger until they become clients.
- The older Shareholders register is still partly independent of the ledger (share transfers and allotments now sync); an unused `transferShares` function remains.
- Demo quirk: Companies House demo data shows a future accounts/CS01 date.
- HMRC work was left for the user to return to.
