# Co Sec complete system: Phase 0 audit and architecture

Written 28 Oct 2026 against `main` at the Forms merge (984116d). The Inform Direct screenshots mentioned in the brief did not arrive, so this works from the written requirements. Nothing here has been tested against Companies House.

## 1. What exists today

| Area | State |
|---|---|
| Co Sec top menu | Overview, Filings, Companies. Company page tabs: Details, Officers, Shareholders, Share classes, PSCs, Registers, Filings. |
| Portfolio | One row per **client** with a company number: accounts, CS01, CT, VAT, payroll, CIS dates (Companies House first, planner jobs second), open filings, search and sort. Dissolved companies shown separately. |
| Change engine (`lib/cosec.ts`) | Rule registry; client edits and portal changes become draft filings (AD01, NM01, AA01, CH01/PSC04); idempotent events; one open draft per target; scan against last-verified Companies House data. |
| Transactions | `CoSecTransactions` with statuses draft, info, approved, submitted, accepted, rejected, declined, cancelled, external. Review screen, approve/decline/clarify, independent review, history. |
| Registers | Officers, PSCs, share holdings and share classes as internal registers, printable. Officers and PSCs can be imported from Companies House. |
| Shares | Holdings rows with From/To/Event. Allotment records a pending holding and prepares an SH01 draft; transfer **reduces the holder's row and adds a new one** (overwrites balances; no ledger). |
| Filing gateway (`api/cosec`) | AD01 only. Schema-level details unverified; live switch blocked (`CH_GATEWAY_LIVE`, `CH_LIVE_FORMS`). Nothing has ever been sent to Companies House. |
| Action Centre | Co Sec group (review, approval, submit, rejected, needs information, waiting, differences). |
| Reused elsewhere | Clients (one company record), People (officer rows can link a client), Document designer, portal signing, Xero, Forms, timeline. |

## 2. Gap matrix against the brief

| Brief item | Status | Phase |
|---|---|---|
| Companies that are not clients (prospects, monitoring, reference) | **Missing**: portfolio only lists clients | 1 |
| Service levels (managed, specific filings, ad hoc, monitoring, historical) and per-company overrides | **Missing** | 1 |
| Add company: existing / Companies House / manual, duplicate check | **Partial** (Companies House lookup exists elsewhere; no Co Sec entry point) | 1 |
| Dashboard counts (monitoring, overdue CS01, awaiting review, rejected etc.) | **Partial** (list view only) | 1 |
| Historical transaction ledger, ownership at any date, no overwriting | **Missing** (current rows are overwritten) | 1 |
| Reconcile ledger to register, share totals, Companies House | **Missing** | 1 (ledger vs register), later (CH) |
| Shared people (one identity, many roles) | **Partial** (officer rows can link a client; no People directory identity) | 1 (model), 2 |
| Identity verification tracking and secure personal codes | **Missing** | 3 (needs secure store decision) |
| Historical import (manual, CSV, PDF with AI extraction, review, approval) | **Missing** | 2 |
| Registers: date-specific, packs, corrections with reasons | **Partial** (printable current registers) | 2 |
| Shared transaction engine (client approval, signing, evidence, states) | **Partial** (review/approve exists for filings; no client approval or signing, no ledger completion stage) | 3 |
| CS01 wizard | **Missing** | 4 |
| Other filings beyond AD01 | **Draft/external only** | 4 |
| Share transfers/allotments with validation, certificates, reorganisations, options | **Partial** (basic allot/transfer) | 5 |
| Dividends | **Missing** | 5 |
| PSC reconciliation | **Missing** | 4/5 |
| Accounts (dormant, FRS 105, FRS 102 1A, iXBRL) | **Missing** | 6 (separate workstream) |
| Settings → Co Sec, reminders, fees | **Missing** | 1 (service levels), 7 |
| Unified timeline entries | **Partial** | each phase |

## 3. Architecture

**One company record.** Companies stay in `Clients` (kind Ltd or LLP). A company that is not a client is a Clients row with a Co Sec relationship, not a second database. A new **`CoSecProfiles`** list holds one row per company: service level, responsible person, whether the practice files the CS01, notes and overrides. Companies with no profile default to "fully managed" if they are active clients and "historical" otherwise, so nothing changes for existing data.

**Ledger as source of truth for shares.** A new **`CoSecLedger`** list holds immutable entries (opening balance, allotment, transfer, bonus issue, subdivision, consolidation, redemption, cancellation, correction). Holdings and ownership at any date are **computed by replaying the ledger**; never stored as the only copy. A correction is a new entry that supersedes an earlier one with a reason, never an edit. The existing `CoSecShares` rows stay as the working register during migration. Phase 1 adds a reconciliation that compares them to the ledger and offers to create opening-balance entries so nothing is lost.

**Four pictures of a company** (already the pattern): planner data, proposed (draft), Companies House last verified, internal registers. The ledger adds a fifth view for shares, reconciled to the others.

**Transaction engine.** Extend, not replace, `lib/cosec.ts`: add a completion stage that writes ledger entries only when a transaction is approved or completed, separate from filing acceptance. Not atomic across lists, so each ledger entry carries the transaction key and an idempotency key; a completed transaction with missing entries is detectable and repairable.

**Filing adapter.** Already separated (`api/cosec/lib/forms.js` builds payloads, gateway sends). Keep; add one adapter per form after the schemas are verified. No form beyond AD01 is claimed as fileable.

**Secrets.** Personal codes and presenter credentials need a server-only store. Use the same options and approval step as the HMRC work (Azure Table Storage recommended). Not introduced yet.

**Navigation.** The brief's eight sections map to: Dashboard (now Overview), Companies, Actions & Deadlines (Overview's attention list), Transactions & Filings (Filings), Statutory Records (company Registers + new cross-company views), Documents, Reports, Settings → Co Sec. Phase 1 adds the Dashboard counts and Companies filters; the rest arrive with their phases. Company workspace tabs gain **Ledger** in Phase 1.

## 4. Security implications
Residential addresses, dates of birth, personal codes and authentication codes need backend-enforced access. Today permissions are role checks in the browser plus the Microsoft sign-in on the server. Anything stronger (record-level access, restricted exports) needs a server-side check and is scheduled with the phase that introduces the data (identity verification in Phase 3; exports in Phase 2). SharePoint is not transactional, so every multi-list write carries an idempotency key and a repair check.

## 5. Companies House filing feasibility
CS01, AD01, officer and PSC forms, SH01 and accounts all depend on Companies House's software filing (XML Gateway) or its newer interfaces, a presenter ID, and an official test account. None of that is in place and the existing AD01 body is unverified. Phase 4 starts by obtaining the schemas and a test account; until then every form other than AD01 stays "prepared, reviewed, filed externally and recorded". The brief's 1 April 2028 software-only accounts date and the 23 October 2026 announcement about profit-and-loss filing need checking against current official pages before Phase 6; this audit has not verified them.

## 6. Phase plan
1. **Foundation:** Co Sec profiles and service levels; companies that are not clients; add company with duplicate detection; dashboard counts; share ledger with ownership at any date and transfer validation; ledger vs register reconciliation; Ledger tab.
2. **Historical import and registers:** manual opening positions, CSV mapping, PDF extraction with review and approval, date-specific registers and packs, corrections with reasons.
3. **Transaction engine:** client approval (manual PDF and portal signing), ledger completion stage, identity verification tracking (needs secure store).
4. **CS01 and common filings** (needs Companies House test account), PSC reconciliation.
5. **Share capital and dividends:** certificates, reorganisations, redemptions, options, dividends.
6. **Accounts:** dormant, FRS 105, FRS 102 1A, iXBRL (specialist workstream).
7. **Settings, reminders, fees, reporting, portal, end-to-end tests.**

## 7. Decisions needed from you
- Secure store for personal and filing credentials (same decision as HMRC).
- Companies House presenter registration and a test account.
- Whether non-client companies should appear in the main Clients list (marked "Co Sec only") or only inside Co Sec. Phase 1 assumes they exist as Clients rows with a Co Sec relationship and are hidden from client-facing lists unless marked as clients.
