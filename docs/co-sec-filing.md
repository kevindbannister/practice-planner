# Co Sec: company secretarial, and filing with Companies House

Co Sec is in the top menu. It keeps each company's statutory records, notices changes made anywhere in the planner, prepares the filings they need, and (for the forms set up for it) sends approved filings to Companies House.

## Current release safeguard (October 2026)

The Companies House XML filing bridge is **disabled by default**. Saving drafts, reviewing them, and marking a filing as completed externally remain available. This is intentional: the server must verify stored approvals and staff permissions, prevent duplicate gateway submissions, and pass the official schema tests before filing is enabled.

**Do not enable the gateway merely to test this release.** A future audited release can require `CH_FILING_SUBMIT_ENABLED=1` in Azure before the `/api/cosec/submit` endpoint will allow any submission. Even presenter credentials and `CH_GATEWAY_LIVE=1` do **not** override this safeguard. Until the release gate is complete, the Submit button returns a clear disabled message.

Earlier transactions without a saved test/live environment marker must be checked manually; a test acceptance is not a live filing.

## What it does

- **Watches for changes.** Change a company's registered office, name or accounting date on its client record (or approve a client's change in the portal) and Co Sec prepares the matching filing as a draft. It does not file anything itself.
- **Keeps addresses apart.** Only a change to the registered office prepares an AD01. Trading and correspondence addresses never do. A director's home address change reaches the director's record only when that director is linked to their own client record.
- **One draft per change.** Changing the same thing again updates the open draft. Changing it back cancels the draft. A change already made at Companies House, or already filed and accepted, prepares nothing.
- **Review, approve, submit.** Each draft shows the company, form, previous and proposed value, source, who changed it and when. You can edit it, approve it, reject it, ask for clarification, or record that it was filed elsewhere. Approving and submitting need a manager or partner (everyone, if no staff roles are set up).
- **Four separate pictures of a company:** the planner's record, the proposed change (the draft), what Companies House last showed, and the internal registers. A field with a draft waiting shows "Pending Co Sec review".
- **After acceptance:** the confirmation is stored, the registers are updated, the last-verified Companies House record is brought up to date, the action closes and the timeline records it. A rejected filing keeps its draft and shows in the Action Centre.
- **Records:** officers (directors, secretaries, LLP members), persons with significant control, shareholders and share transactions, and printable registers. Officers and PSCs can be brought in from Companies House.
- **Action Centre and bell:** a Company Secretarial group covers changes to review, drafts to approve, approved filings to submit, rejected filings, queries, and Companies House differences.

## Setup (one-off)

### 1. The lists
Nothing to do. The new `PP CoSec …` SharePoint lists and the new client columns are added automatically the first time the new version loads.

### 2. Companies House API key (for checking and bringing in officers)
This is the same key the Companies House check already uses (`CH_API_KEY` in the Azure app settings). If it is already working, skip this.

### 3. Each company's authentication code
Every filing needs the company's six-character Companies House authentication code. Enter it on the client's record (the "CH auth code" field). Co Sec refuses to submit without it.

### 4. Filing through the Companies House XML Gateway
Companies House only accepts software filings through its XML Gateway, and it has to approve the software first. This takes some weeks. What the planner side needs from you, in order:

1. **Ask for a test account.** Email `xml@companieshouse.gov.uk` with the practice name, a contact name, address, email and phone, and say you are developing software to file AD01 (and any other forms you plan to use). They send test presenter credentials. The technical interface specification and XML schemas are published by Companies House (the gov.uk page "Technical interface specifications for Companies House software" links to them).
2. **Add the test credentials to Azure.** In the Azure portal open the Static Web App, then Settings, Environment variables, and add:
   - `CH_PRESENTER_ID`: the presenter ID they gave you
   - `CH_PRESENTER_AUTH`: the presenter authentication code
   - `CH_PRESENTER_EMAIL`: (optional) the email address for the sender details

   Leave `CH_GATEWAY_URL`, `CH_GATEWAY_LIVE` and `CH_LIVE_FORMS` unset. With these unset every submission goes to the Companies House **test** service and is marked as a test.
3. **Check the form message against their schema.** The XML for each form is in `api/cosec/lib/forms.js`. It is written to the shape of the Companies House messages but the exact element names come from their schemas, so they must be checked and corrected during testing. This is the one place to edit.
4. **After the security and schema release gate is complete, make test submissions.** In Co Sec, prepare an AD01 (change a test company's registered office), approve it and press Submit. It goes to the test service. Test submissions that pass the schema check are stored pending; email Companies House to say you have made them. Use "Check the answer from Companies House" to read the result back.
5. **Companies House approves the software** and, when they are satisfied, you apply for an online filing presenter account and receive your live presenter ID and authentication code.
6. **Go live.** Replace the two presenter settings with the live ones and add:
   - `CH_GATEWAY_LIVE` = `1`
   - `CH_LIVE_FORMS` = `AD01` (a comma-separated list; add each form only after Companies House has accepted it in testing)

   The server will not send a form live unless both are set, so a form you have not tested cannot go out by accident. The Submit message says whether it went to the test or the live service.

You can use Co Sec fully before any of this: prepare, review and approve drafts, then file at Companies House yourself and press "Mark as already filed externally". That updates the registers exactly as an accepted filing does.

### 5. Who can approve and submit
Co Sec uses the planner's existing staff roles. Managers and partners can approve, reject and submit; everyone else can prepare and edit. If independent review is switched on there, the person who last edited a draft cannot approve it.

## Day to day

1. Make the change where you normally do (the client record, a portal approval, the Co Sec company page).
2. Open Co Sec. The overview lists what needs attention. Open a draft, check the details (an incomplete address or missing officer detail is listed), and approve it.
3. Submit it, then use "Check the answer from Companies House" until it is accepted. The register updates itself.
4. "Look for changes" on the overview compares every company with what Companies House last showed. "Check Companies House now" on a company does the same for one.

## What is not built yet

- **Sent through the gateway:** AD01 only. The other forms (AP01 to AP04, TM01, TM02, CH01 to CH04, LL forms, PSC01 to PSC07, SH01, AA01, NM01) are prepared, reviewed and approved in Co Sec but filed at Companies House by you, then recorded as filed externally. To add a form to the gateway, add it to `api/cosec/lib/forms.js` and to the gateway list in `app/src/lib/cosecForms.ts`, and test it the same way.
- Confirmation statements (CS01), accounts, PSC statements, share reorganisations, dividend vouchers, share certificates, minutes and resolutions, name-change documents, charges, strike-off, company formation, and a document library.
- Residential addresses are not available from Companies House, so they are entered by hand.
