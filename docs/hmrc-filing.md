# HMRC filing integration: audit, what is built, what is blocked

Written 4 November 2026. Covers the first stage of the HMRC brief: the audit, the shared filing infrastructure (Priority 1) and the SA100 side that does not need HMRC's XML. **Nothing here has been tested against HMRC, and no return can be filed with HMRC yet.**

## 1. Audit (Phase 1)

| Area | What exists | Gap |
|---|---|---|
| Personal Tax (SA100) | Full return model, computation, IRIS import, payments, summary (`app/src/lib/tax*.ts`, `ui/TaxPage.tsx`) | No HMRC XML. Not checked against HMRC's RIM artefacts |
| Partnership (SA800) | Only the partner's share on the SA100 (`Partnership` type) | No partnership return, no partner allocation, no SA801 to SA804 |
| Corporation Tax (CT600) | Nothing. Co Sec holds companies, dividends and dormant accounts | No CT module, no computation, no CT600 XML |
| iXBRL | Nothing. `docDesign.ts` makes PDFs | No iXBRL accounts or computations; nothing to reuse |
| HMRC connectors | PAYE RTI GovTalk bridge (`api/rti`: envelope, IRmark, polling, SharePoint queue, test mode by default). VAT agent-authorisation bridge (`api/hmrc`, sandbox untested) | RTI's GovTalk code is PAYE-specific; left untouched |
| UTRs | `Client.UTR` (SA), `CTUTR` (companies) on the Clients list | Not validated beyond presence |
| Credentials | RTI: `RTI_SENDER_ID`, `RTI_PASSWORD`, `RTI_VENDOR_ID` in Azure settings. HMRC OAuth tokens: sealed copy in app settings | No Key Vault |
| Documents / approval | Portal signing and acceptance exist | Not tied to a return version |
| Tests / deploy | `node:test`; Azure Static Web Apps managed functions deploying from `main` | See Key Vault note below |

## 2. What is built (Priority 1 and the SA100 side that needs no XML)

**Shared filing record and rules** (`app/src/lib/hmrcFiling.ts`): Draft, Prepared, Validated, Reviewed, Client approved, Ready to file, Submitted, then Accepted or Rejected.
- The client approves an exact version (a SHA-256 of the return as filed). If the return changes afterwards the approval no longer covers it and it goes back to Prepared.
- Live filing is off unless switched on and approved by a named person. The External Test Service needs HMRC's vendor ID and test credentials. A mock run is always possible and is never shown as filed.
- Only HMRC's own final acceptance on the live service counts as filed. A test-service or mock acceptance never does.
- The same version cannot be sent twice. A correction or amendment is a new version pointing at the one before; earlier versions are never changed.
- Review and filing need permission; filing needs an explicit confirmation. HMRC XML must be ready before a return can be marked ready or sent.
- History is append-only (`HmrcFilingLog`); bots can read but not write either list.

**Server** (`api/filing`): secret store (settings or Key Vault), a generic GovTalk layer (envelope, IRmark, send, poll, answers), an environment gate and a mock transport, behind `/api/filing/info`, `/send`, `/poll`. Each service plugs in an adapter; **none is registered**, so every send refuses and says why.

**SA100 screen** (Summary view, "HMRC Filing"): state, readiness checks, history, versions, the next allowed step, and a list of which SA100 pages the planner covers (SA101, SA107 and SA109 are not in the planner). The planner's own pre-flight checks are labelled as such and are not HMRC validation.

**Tests:** 12 state-machine, 18 server, 5 panel and 5 pre-flight tests, plus the bot-policy check.

## 3. Verified from official sources, and what is not

Verified (GOV.UK pages read on 4 November 2026):
- The 2026 individual-return specification page (updated 19 May 2026) lists: Individual RIM Artefacts v1.2 (ZIP), Calculate Tax and NIC MTR v1.5.1, Payments on Account calculation v1.0.0, Test Case Generator v1.5.4, MTR Mapping v1.0, Special cases v1.1 and Exclusion cases v1.0.
- HMRC's guide for XML software developers: a **Vendor ID and test credentials** are needed for the test services; the External Test Service is at `test-transaction-engine.tax.service.gov.uk`; TPVS and LTS check the body only; HMRC recognition can be applied for after your own testing (about 10 working days; contact SDSTeam@hmrc.gov.uk). The page does not say whether recognition is required before live submissions.
- Azure Static Web Apps **managed functions have no managed identity and no Key Vault references** (Microsoft's feature comparison); both need "bring your own" Functions.

Not verified, so not built: the SA100 message class and GovTalk keys, the XSD and schematron, IRmark test vectors, any XML element. The RIM artefacts could not be downloaded from the build environment (the proxy returns 403).

## 4. Blockers and decisions

1. **HMRC registration.** Register as a software developer and get the XML Vendor ID and test credentials from the software developer support team. Without them even the External Test Service cannot be used.
2. **The RIM artefacts.** Supply `HMRC-RIM-MTR-2026-v1.2.zip` (and the Test Case Generator and MTR Mapping if wanted) as an attachment. The SA100 adapter, XSD validation and the XML mapping are built from those.
3. **Secrets (Key Vault).** The brief asks for Key Vault. Managed functions cannot use it with a managed identity. Options: (a) link a standalone Functions app and use a managed identity; (b) keep managed functions and use the vault with a service principal (one bootstrap secret stays in app settings); (c) stay with app settings. The code supports (a) and (b) now (`FILING_KV_VAULT` and the identity or `FILING_KV_*` settings).
4. **Recognition.** Ask HMRC whether recognition is needed before live filing for a new product.
5. **Lists.** Two new SharePoint lists (`HmrcFilings`, `HmrcFilingLog`) are created by the app's existing "Create the lists" step.

## 5. Not started

SA800 (Priority 3), CT600 and iXBRL (Priority 4), HMRC account and payments APIs (Priority 5), the HMRC Integrations settings page and the central filing dashboard (Phases 7 and 8). The earlier feasibility report (`hmrc-authorisation-feasibility.md`) still stands for agent authorisation.

## 6. Definition of done: status

None of the eight conditions is met. SA100 XML, SA800, CT600 and the HMRC test passes are all outstanding.

## SA100 builder and conformance check (2025-26)

HMRC's RIM pack (v1.2) is in `api/filing/rim/sa100-2025-26/` (MTR XSD, envelope XSD, Schematron and its compiled XSLT, with SHA256SUMS).

- `scripts/validate_rim.py <rim folder> <message.xml>` checks a GovTalk message against the XSD, then HMRC's business rules. HMRC's compiled rules answer with an `ErrorResponse` (not SVRL); any `Error` in it is a failure. The business rules also require the `GovTalkDetails/Keys` to match the `IRheader` keys. Needs python3 + lxml, so it is a development and test check, not a runtime one.
- `api/filing/lib/sa100.js` builds the `IRenvelope` for: personal details, self-employment on SA103S (expense boxes 11-19, capital allowances, CIS, losses) and SA110 totals. Anything else in a return is listed as unsupported and the build is refused, so a partial return is never produced as complete. Turnover over £90,000 needs SA103F, which is not built.
- Not registered as an adapter: the GovTalk message class and key rules for SA100 are not in the RIM pack (the envelope XSD only says Class is a 4-32 character string). They must come from HMRC's technical documentation or the SDST. Until then nothing can be sent.
- Not yet checked: the planner's SA110 figures against HMRC's own calculation, and runtime validation (the API has no XML schema validator; options are a WASM XSD library or a Python function).

## SA800 builder and conformance check (2025-26)

HMRC's partnership RIM pack (v1.0a) is in `api/filing/rim/sa800-2025-26/`. `scripts/validate_rim.py` works on it the same way as for SA100.

`api/filing/lib/sa800.js` builds the partnership `IRenvelope` for: partnership details and nominated partner, trading income on the short route (turnover, expenses, net profit), each partner's share of profit or loss, and the declaration. It checks, before building, the things HMRC's rules enforce: UTR check digit (rule 8205, repeated digits refused by 6965), at least two partners, accepted name characters, and that the partners' shares add up to the partnership's profit.

Rules learned from HMRC's checker: on the short route the tax adjustments (3.66-3.73) must not be sent (6626) and the taxable profit [3.83] must equal net profit [3.26] (6627); the partners' total must equal [3.83] (6904).

Refused (reported as unsupported, nothing built): turnover over £90,000, capital allowances and balancing charges, savings, UK/foreign property and chargeable-asset pages, the full partnership statement (SA800PS), attachments and amended returns.

Not registered as an adapter: the GovTalk message class and key rules are not in the RIM pack. The planner holds only a partner's share (SA104); there is no partnership return record, screen or storage yet.
