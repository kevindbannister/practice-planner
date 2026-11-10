# Companies House accounts filing: Phase 1 (specification, audit, architecture, blockers)

Status: **design only. No filing code has been written or enabled. Nothing in the app can send accounts to Companies House.**
Date: 10 November 2026. Branch: `feature/ch-accounts-filing`.

## 1. What the official sources say (and how sure I am)

Read directly (gov.uk page "Technical interface specifications for Companies House software" and its "Important information for software developers, read first", edited 21 Oct 2026):

| Fact | Source | Confidence |
|---|---|---|
| Latest accounts TIS is the file `TIS_October_2026.odt` (updated 21 Oct 2026). The update log names v5.9 (1 Apr 2026), v5.7 (17 Mar 2025), v5.6 (16 Jan 2025); other unnumbered updates 25 Sep 2026 and 18 Dec 2025. Separate general TIS is v5.3 (6 Jun 2024). | gov.uk publication page | High for dates; **the exact version inside the Oct 2026 file is not stated** |
| Test gateway: `https://xmlgw.companieshouse.gov.uk/v1-0/xmlgw/Gateway`. Schemas and examples: `http://xmlgw.companieshouse.gov.uk/SchemaStatus`. | read-first page | High |
| Test accounts: apply on the gov.uk form (form 266379) giving contact, software provider, and the filing types to test. Test submissions must have the test flag set to 1. | read-first page | High |
| Gateway parses each test submission and rejects any with errors; parsed ones are stored **pending** and **manually reviewed**; email xml@companieshouse.gov.uk after making them. Each submission needs a unique envelope number (duplicates give "Failure - multiple tests"). | read-first page | High |
| Authentication: presenter ID and authentication value **MD5 encoded**; 502s usually mean wrong ID/value, test flag not 1, value not marked "clear", or package reference not 0012. | read-first page | High |
| Status is polled with Get submission status / status ack / get document. | read-first page | High (message details not read) |
| Testing finishes when Companies House is satisfied for each form type; then you apply for an online filing presenter account to get the live presenter ID. | read-first page | High |
| Companies House plans to replace the XML platform with a REST/JSON API, no timetable. | read-first page | High |
| Package accounts, and the 2025 taxonomy suite (enabled April 2025), arrived with TIS v5.7. | Companies House XML forum announcement | Medium (forum post) |
| For accounts "there are no schemas, you have to create the iXBRL and then submit within an XML envelope". A reply to an accounts submission uses `<Class>Accounts</Class>`, `<Qualifier>response</Qualifier>`, and carries `TransactionID`, `GatewayTest`, `GatewayTimestamp`; status then polled with `GetSubmissionStatus` / `SubmissionNumber`; in test, attachment-based submissions are changed from PENDING by hand by Companies House. | Companies House staff on the XML forum | Medium (forum, not the TIS) |

**Not obtained.** The TIS file itself could not be opened: the fetch tool needed your approval for the `assets.publishing.service.gov.uk` link and the prompt timed out; the Bash sandbox has no outside network. So the following are **unverified and must come from the TIS before any code is written**:
the exact request message class and body element for an accounts submission; how the iXBRL document is attached (element, encoding, content type, any size limit); the accepted taxonomies, versions and entry points for periods ending in 2026; Companies House's extra business rules and error codes; the precise status-request and acknowledgement bodies; dormant-accounts specifics; whether a ZIP (package accounts) route applies.

**To unblock:** open the link at the top of the gov.uk page and either attach `TIS_October_2026.odt` to this chat, or approve the fetch when prompted. Also needed: the schemas listed at SchemaStatus (status request, status ack, get document, GovTalk envelope).

## 2. Audit of what is already in the repo

| Area | Finding |
|---|---|
| `lib/cosecDormant.ts` | Sound base. Deadline and penalty rules, dormant eligibility checks with user confirmations, integer (BigInt micro-unit) share-capital figures, statements wording, PDF of accounts, approval and "filed elsewhere" recording. Explicitly **does not file**. Prior-year comparatives are computed from the share ledger but only for companies with nothing else. No structured accounts data model other than `Figures`; the PDF is the only rendering. |
| `lib/cosecGateway.ts`, `api/cosec/lib/gateway.js`, `forms.js` | Envelope builder with CHMD5 authentication, test by default, live only if `CH_GATEWAY_LIVE=1` **and** the form is in `CH_LIVE_FORMS`. Only AD01, whose body is **unverified** (its own header says so). Replies are read with regular expressions rather than an XML parser, which is fragile. **Not suitable for accounts and must not be reused as is.** The mock gateway always "accepts" after two polls; its tests prove nothing about the real gateway. |
| Secrets and codes | Presenter ID and secret are server-side (Azure settings): good. **The company authentication code is stored in the client row in SharePoint (`CHAuthCode`) and sent from the browser to the server with each submission.** That breaks the brief's requirement to protect the code and to have the server enforce preconditions. |
| Server trust | `api/cosec/submit` accepts the form payload and company details from the browser. For accounts the server must instead load the approved accounts version itself and rebuild everything from it. |
| Duplicate prevention | `submissionNumber()` is time-based plus a random digit; no persisted idempotency record, so a timed-out submit followed by a retry could submit twice. |
| Approval | `cosecApproval.ts` and the dormant `approve()` record the director, date and signed reference; `drifted()` detects changed figures. Approval is not bound to a hash of the exact document. |
| Documents | `Documents` / `DocVersions` lists exist (documents module). Large files should not go in list fields. |
| Tests | `app/tests/cosecDormant.test.ts`, `api/test/cosec.test.js` cover current behaviour with a mocked fetch only. |
| PRs / branches | No open pull requests found (`gh pr list` is blocked in this environment; branches: `main`, `typecheck`). |

## 3. Architecture (decisions)

Layers, each independent and pure where possible:

1. **Accounts data model** (`lib/accounts/model.ts`): one structured, versioned object per filing (company, period, regime, comparatives, balance sheet lines, statements, notes, signatory). Money in integer pence. Built from the existing dormant `Figures` plus confirmed manual inputs. The PDF and the iXBRL both render from this object only, so there is one set of numbers.
2. **Preparation and statutory validation** (`lib/accounts/validate.ts`, level 1): balance sheet balances, comparatives reconcile, shares x nominal agree, paid/unpaid correct, required statements present, dates valid, exemption claims allowed. Never plugs a difference.
3. **Taxonomy mapping** (`lib/accounts/taxonomy/<version>.ts`): internal field to concept, data type, context, unit, dimensions, rules; versioned and tested. No concept names anywhere else. **Concept names and entry points are not written until read from the FRC taxonomy / Companies House instructions.**
4. **iXBRL generator** (`lib/accounts/ixbrl.ts`): model plus mapping to an XHTML document with inline facts, contexts, units. Shared by browser (preview) and server (the one that is filed).
5. **Validation levels 2 to 5**: XML/XHTML well-formedness; XBRL validation with an established engine (candidate: Arelle, run server-side; its licence (Apache 2.0), Python runtime and Azure Functions fit have to be evaluated, and it cannot run inside the current Node functions without a container or separate Function app); Companies House business rules (from the TIS); the official test gateway.
6. **Filing package builder and provider**: `AccountsFilingProvider { validate, submit, checkStatus }`. `XmlAccountsFilingProvider` is the only implementation; a future REST provider slots in without touching 1 to 4 or the UI. The internal filing object is never raw XML; XML is generated from it.
7. **Submission service (server)**: loads the approved snapshot, verifies its hash against the director's approval, re-runs all validations, checks environment and enablement flags, writes a durable "submitting" record with the envelope number **before** sending (idempotency), then sends. A timeout leaves the attempt "outcome unknown"; the only allowed action is a status enquiry on the saved number, never a resend.
8. **Status service and audit**: polling, normalised status (acknowledged, pending, accepted, rejected, failed), raw response stored, every attempt a separate record, history never overwritten. Only a confirmed acceptance completes the job.

### Decision needed from you (server-side storage)
To meet "the server independently enforces preconditions" the Azure Functions need a **trusted store the browser cannot write**: the approved snapshot, its hash, the attempt records and the company authentication codes. SharePoint is written directly by the browser with the user's own token, so it cannot be that store. Recommended: **Azure Table + Blob storage (or Cosmos) owned by the Functions app, and Key Vault for presenter secrets and company auth codes.** This needs an Azure storage account and connection string from you. Alternative (weaker): sign the approved snapshot with an HMAC key held in Azure settings when the director's approval is recorded, and have the server accept only snapshots whose signature verifies. That proves integrity but not "has not already been submitted", so duplicate prevention would still need server storage.

### Safety defaults (unchanged from the brief)
Production off by default; enabling live needs `CH_GATEWAY_LIVE`, an explicit accounts-type allowlist, and a recorded test-evidence flag; a successful mock or test result never enables live. Test and production shown with unmistakable banners. No "File accounts" button appears until the route is implemented, tested against the real test gateway and enabled.

## 4. SharePoint changes (planned, non-destructive)
New lists (rows hold references and hashes, not documents): `PP Accounts Filings` (AccountsFiling), `PP Accounts Filing Attempts`, `PP Accounts Documents` (storage reference + SHA-256, document type, version), `PP Accounts Validations`. Existing `PP CoSec Accounts` rows are migrated by a dry-run script that creates an `AccountsFiling` for each, marks any "filed elsewhere" ones as external (no invented references), and leaves originals untouched. The `CHAuthCode` column on clients is to be retired once the codes live in Key Vault (a separate, reversible migration).

## 5. Phase plan and what can proceed without credentials

| Phase | Can be done now | Blocked on |
|---|---|---|
| 2 Preparation | Yes: structured model, eligibility, comparatives, statutory validation, PDF from the model | none |
| 3 iXBRL | Engine, XHTML structure, context/unit handling, tests | FRC taxonomy concept names and CH entry points (TIS / taxonomy download); XBRL validator choice |
| 4 Gateway | Server skeleton, idempotency, storage, redaction, XML parsing safety | TIS message class/body/attachment definition; schemas; test presenter credentials |
| 5 Workflow/UI | Screens, states, history, job and Action Centre integration, with the submit button **absent** until Phase 4 is verified | Phase 4 |
| 6 Testing | none | test account (form 266379), then Companies House manual review of pending test filings |
| 7 Production | none | live presenter ID, Companies House sign-off, your explicit authorisation |

## 6. External checklist (your actions in bold)
- [ ] **Apply for a test account: gov.uk form 266379** (contact, software provider, filing types: dormant accounts)
- [ ] **Provide the TIS file (or approve its download) and the schemas from SchemaStatus**
- [ ] **Decide the server-side storage (Azure storage account + Key Vault)**
- [ ] Test presenter ID and authentication received
- [ ] Taxonomy files obtained and entry points confirmed
- [ ] Local validation passing; XBRL validator chosen
- [ ] Test submissions made and reported to xml@companieshouse.gov.uk
- [ ] Companies House feedback addressed
- [ ] Live presenter account obtained; production credentials set; live explicitly enabled

Accounts filing status today: **not available. Test mode only, once built.**

---

# Phase 2: dormant accounts preparation (V24.1)

**Implemented**
- `lib/accounts/model.ts`: the structured accounts (`AccountsModel`), whole-pence integers, current and comparative balance sheet columns, share classes, statements, employees, signing. Canonical JSON and SHA-256 hash. Only `type: "dormant"` exists; the filing buttons for other types do not exist.
- `lib/accounts/validate.ts` (level 1): balance sheet balances (never adjusted), net assets = assets less liabilities, funds = capital + reserves, dormant has no liabilities/reserves, comparatives present (not in a first period), comparative date before the period, capital unchanged between years, shares x nominal = called up, unpaid <= called up, note totals agree with the balance sheet, statements only if a person confirmed them, employees = 0, director chosen, approval date after the balance sheet date and a valid date. Each issue names its field.
- Eligibility (`assess`) now also blocks LLP numbers (OC, SO, NC) and carries every accounts check as a blocker, so a set of accounts that fails validation cannot be prepared or approved. Existing checks kept: active company, period dates and length, period matches Companies House, duplicates, share issues/redemptions after incorporation, premium, dividends, transfers, paid/unpaid, comparatives, directors, human confirmation of "never traded / no significant transactions / small company regime". A company that has traded is not treated as dormant here: comparative disclosures for previously-trading dormant companies are not implemented, so it is blocked with the confirmation requirement, as the brief requires.
- The PDF is now written only from the model (`accountsPdfFromModel`); no figure is calculated in the document code. Phase 3's iXBRL will use the same model, so they cannot disagree.
- Approval is tied to the exact accounts: the approval stores a SHA-256 of the approvable accounts (signer and date excluded) and a copy of the approved model (`ApprovedHash`, `ApprovedModel` on PP CoSec Accounts, two new columns). If the accounts later hash differently, the screen shows "The accounts have changed since the director approved them", the approval can't be used, and "Withdraw the approval" (reason required, logged in the notes) sends the job back to Prepared.
- New screen list "Accounts checks" under eligibility.

**Tests**: `tests/accountsModel.test.ts` (10 tests), plus the existing dormant tests; app suite 1,329 pass. MCP schema copy regenerated.

**Not done in Phase 2 (stated plainly)**: previously-trading dormant companies; storing the approval hash on the server (needs the server-side store decided in Phase 1); migration of existing `CoSecAccounts` rows into the new Phase 4/5 filing lists (those lists do not exist yet; existing rows are untouched and have no hash, so they are never flagged stale); a manual-entry form for opening balances without a share ledger (the model accepts figures, the screen still derives them from the ledger); an average-employees input (fixed at 0, which is the only valid value for dormant).

**SharePoint**: two new columns on PP CoSec Accounts, added by Settings › Set up the lists. Non-destructive.

---

# Phase 3: iXBRL engine (V24.2). Built; blocked from producing a filing document until the taxonomy is verified

**Implemented**
- `lib/accounts/xml.ts`: strict small XML reader (rejects DOCTYPE, entity declarations, CDATA, processing instructions, duplicate attributes, undeclared prefixes, unclosed or mismatched tags). Used for level 2 (well-formed) and to read facts back. Not a validating parser.
- `lib/accounts/taxonomy.ts`: the single mapping registry (field, concept, type, context, unit, required, status `missing | named | verified`, source). Only namespaces defined by the XBRL and Inline XBRL standards themselves are hard-coded. `mappingProblems()` lists exactly what stops a mapping being used.
- `lib/accounts/ixbrl.ts`: Inline XBRL writer (ix:header, link:schemaRef, xbrli:context/unit, ix:nonFraction/ix:nonNumeric, instant and duration contexts, current and comparative periods, GBP and pure units, decimals, sign), `readDocument`, internal checks (levels 2 and 3: our own consistency, not taxonomy validation), and `reconcile()`: every tagged fact must equal the model, every fact the model supplies must be tagged, no amount may appear untagged.
- `generate()` refuses unless the model passes validation **and** the mapping is verified. Nothing can come out of the draft mapping.
- Screen: "Electronic filing readiness: not available yet" lists what's missing. There is no filing or iXBRL button.

**What the official sources gave me, and what they did not**
Read: FRC UKSEF 2025 Tagging Guide v2.1 (frc.org.uk/docs/8115) names `bus:BalanceSheetDate`, `bus:UKCompaniesHouseRegisteredNumber`, `core:DateAuthorisationFinancialStatementsForIssue`, `core:DirectorSigningFinancialStatements`, `core:AverageNumberEmployeesDuringPeriod`, `core:ProfitLoss`, the Companies House identifier scheme `http://www.companieshouse.gov.uk/`, and an FRS 102 UKSEF entry-point pattern. These are recorded as **named, not verified**: that guide is for listed-company (UKSEF) filers, and none has been checked against the entry-point schema. The FRC page confirms the 2025 suite v1.0.0 (18 Oct 2024) zip and that Companies House enabled it on 2 April 2025.
Not obtained: the dormant / small-company entry-point URL; the namespace URIs for `core` and `bus`; concepts for called-up share capital not paid, cash, net assets, share capital, shareholders' funds, dormant status, period start/end, entity name and the four statutory statements; Companies House's mandatory-fact rules; whether dates and amounts need an Inline XBRL transformation format. The TIS and taxonomy are binary files (ODT, ZIP) that the fetch tool can't read as text.

**To unblock:** extract the 2025 suite zip (or the `changelog.pdf`/presentation sheets in it) and the October 2026 TIS to text/PDF and attach them, or paste the entry-point list and the balance-sheet, dormant-status and statements concept names. I will fill `taxonomy.ts`, mark entries verified only when checked against the schema, and then run the engine against a real XBRL validator.

**Tests**: `tests/ixbrl.test.ts` (9): production mapping refuses and lists gaps; invalid model produces nothing; generated document is well-formed, passes checks and reconciles; context set; first period has no comparative; exact pence text; reconciliation catches a changed figure, missing fact, untagged amount, extra fact; checks catch broken context/unit/prefix/unused resources/missing schemaRef/bad dates/wrong scheme/missing decimals; XML reader rejects DOCTYPE and malformed input. The engine tests use an invented mapping that is only in the test file. App suite 1,338 pass.

**Not done**: level 3 validation with a real XBRL engine (Arelle) and Companies House's validator (needs the taxonomy and a deployment decision); transformation formats for dates/amounts; a document preview; saving the document to documents.

## Phase 4: server-side filing (safe parts only)

**Status: built and tested against a fake gateway. Nothing can be sent. Do not treat this as production-ready.**

What exists (`api/cosec/lib/accountsFiling.js`, wired in `api/cosec/index.js`):

- `accounts-info`, `accounts-submit` and `accounts-status` actions. The browser sends only a filing key. It never supplies XML, the approved version or the company authentication code.
- Approval is recorded server-side with its hash. Submission re-checks the hash (`tampered` if it differs), re-validates the model, and regenerates the iXBRL from the approved snapshot. It does not accept client XML.
- An attempt record is written before anything is sent (idempotency). A second click, a concurrent call, or a retry after a timeout is refused. A timeout or HTTP error leaves the attempt `unknown`; the only way forward is a status enquiry, never a resend.
- An acknowledgement is not acceptance. Only a status reply of ACCEPT is "accepted"; unknown words change nothing, and an accepted attempt cannot be silently reversed. Earlier attempts are kept.
- Test by default. Live needs `CH_GATEWAY_LIVE=1`, the accounts type in `CH_LIVE_ACCOUNTS`, and `CH_ACCOUNTS_TEST_EVIDENCE`. A non-test gateway URL without those is refused.
- Presenter secrets and MD5 authentication values are redacted from anything stored or shown. Replies are read with the strict XML parser (no DOCTYPE or entities).
- Fix: the existing envelope never sent the `GatewayTest` flag even in test mode. It now does (this also affects AD01).

Why nothing can be sent yet (three independent blocks, each refuses with its own code):

1. `ixbrl-unavailable`: the taxonomy mapping is a draft (no entry point, no namespaces, most concepts unnamed).
2. `spec-not-verified`: the accounts message class and body, and how the iXBRL is attached, have not been taken from the Companies House TIS (`ACCOUNTS_SPEC.verified` is false).
3. `storage-not-configured`: no trusted server-side store (Azure Table/Blob plus Key Vault) is configured. The in-memory store is for tests only.

`accounts-status` returns not-available until the status message is taken from the TIS.

Tests: `api/test/accountsFiling.test.js` (12). The spec and mapping used there are invented for the tests and prove nothing about the real gateway.
