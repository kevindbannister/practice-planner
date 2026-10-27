# HMRC agent authorisation: feasibility report

Written 27 Oct 2026, from HMRC's published documentation. Nothing here has been tested against HMRC yet.

## Summary

| Service | Direct from XProFlow? | Basis |
|---|---|---|
| VAT (MTD) | **Yes, through HMRC's REST API** | Agent Authorisation API, MTD-VAT supported, sandbox exists |
| Corporation Tax | **Not confirmed. Build the guided workflow.** | XML spec published, but no statement that new software can use it |
| Employer PAYE | **Not confirmed. Build the guided workflow.** | Same |

## VAT (MTD): Agent Authorisation API

Confirmed from HMRC's repository (github.com/hmrc/agent-authorisation-api, README for version 2.0) and HMRC's sandbox guide:

- `POST /agents/{arn}/invitations` creates a request (204, invitation id in the `Location` header). For VAT the body is `service: "MTD-VAT"`, `clientType` (`personal` or `business`), `clientIdType: "vrn"`, `clientId` (the VRN) and `knownFact` (the VAT registration date).
- `GET /agents/{arn}/invitations/{id}` returns `status`, `expiresOn`, `created`, and `clientActionUrl`, the genuine client link. We never build the link ourselves.
- `GET /agents/{arn}/invitations` lists the last 30 days. `DELETE .../{id}` cancels a pending request.
- `POST /agents/{arn}/relationships` checks for an active relationship (204 active, 404 not).
- `PUT /agents/{arn}/deauthorise-client` ends one (not used).
- A request expires after **21 days**. It can only be cancelled before the client responds and before it expires.
- Errors include `DUPLICATE_AUTHORISATION_REQUEST`, `NOT_AN_AGENT`, `AGENT_NOT_SUBSCRIBED`, `NO_PERMISSION_ON_AGENCY`, `SERVICE_NOT_SUPPORTED`, `INVALID_INVITATION_STATUS`.
- The client must already be signed up for MTD VAT; the API does not onboard clients. They approve with their own Government Gateway sign-in.
- **Sandbox:** exists, with a Create Test User API (agents and organisations) and an Agent Authorisation Test Support API that lets a test invitation be accepted. An application must subscribe to VAT (MTD), Create Test User, Agent Authorisation and Agent Authorisation Test Support.
- **OAuth:** user-restricted (the agent signs in with their own agent Government Gateway user). HMRC's sandbox guide names the scope `write:sent-invitations`.

### Not confirmed (check on the Developer Hub before production)

- The full list of invitation `status` values. Only `Pending` and `Accepted` appear in the examples. We map `Rejected`, `Cancelled` and `Expired` too, and treat **any other value as unknown, never as authorised**.
- Whether reading an invitation needs a second scope beyond `write:sent-invitations`.
- The exact request body for the relationships check (we send the same shape as the invitation).
- The body (if any) the sandbox test-acceptance call expects.
- The `Accept` header version: HMRC's examples mix `1.0` and `2.0`. We send `application/vnd.hmrc.2.0+json`.
- Refresh-token lifetime. One reporter found daily re-authorisation was needed in 2019.
- Production access: an application must be reviewed by HMRC before it can use production credentials.

### Needed from the practice

1. A Developer Hub account and an application, subscribed to the four APIs above, with the redirect URI `https://<your app>/api/hmrc/callback`.
2. The practice's Agent Services Account and its ARN (`TARN...` in the sandbox).
3. For production, HMRC's production-credentials review.

## Corporation Tax and PAYE: Agent Authorisation Online (XML)

What the GOV.UK pages show: technical specifications (test case data, business validation rules, valid XML samples) and generic documents (GovTalk header rules, response messages, schema, "How to use the test services v2.5a"). The CT and PAYE pages were last changed on 16 June 2023, when the "recognition process" PDFs were **removed**. The collection page names only a contact, SDSTeam@hmrc.gov.uk.

What the pages do **not** say: whether new software developers can be admitted, how to register, or what production approval involves. HMRC's own API catalogue describes the XML service as separate from the REST API and "not part of Making Tax Digital". **Publication of the specification does not show the service is open to new developers**, so none of it is assumed.

**Confirmation needed from HMRC** (SDSTeam@hmrc.gov.uk): is Agent Authorisation Online open to new software developers; how is a developer registered; what test credentials and test service exist; is recognition still required and how; what does production access require; and how is the agent authenticated.

**Plan:** build the guided workflow (below) now. Keep any direct adapter isolated behind the same record model so it can be switched on later.

### Guided workflow (CT and PAYE)

Checks the client details; opens HMRC's official service; records when the request was made; sets a follow-up for the postal code; records receipt; links to HMRC's code-entry service; allows a manual confirmation once evidence has been seen. Every manually recorded status is labelled as **not checked with HMRC**. For PAYE, the alternative is the client approving through their HMRC business tax account, with the practice's agent identifier and clear instructions. A client saying they have done it never makes the record "confirmed".

## Where the HMRC sign-in is kept: a decision for you

The agent's HMRC tokens are powerful (they can send authorisation requests for the practice). Options:

| Option | What it is | Cost | Notes |
|---|---|---|---|
| **A. Azure Table Storage (recommended)** | A table in the storage account the Functions app already uses, tokens encrypted with a key held only in Azure settings | Pence a month | New code, no new service. Tokens never reach the browser or SharePoint. |
| B. Azure Key Vault | Secrets in a vault, read by the function's managed identity | About £0.03 per 10,000 operations, so pence | Strongest; adds a service and a role assignment. |
| C. Encrypted blob kept in SharePoint settings (as Xero does today) | Encrypted with a server-only key, held by the browser | Nothing | Weaker than your brief allows. Not used here. |

**The bridge is built with a pluggable store and has none connected.** Until you approve A or B, it reports "nowhere safe to keep the HMRC sign-in" and refuses to connect. There is no fallback to something less safe.

## Status model

Not requested, awaiting client, awaiting postal code, authorised, rejected, cancelled, expired, request failed, authorisation ended. Each record also carries where the status came from: **HMRC** (confirmed), **staff** or **client** (neither checked with HMRC). Only "authorised" from HMRC counts as confirmed.

## Test levels, today

| Level | VAT | CT / PAYE |
|---|---|---|
| Unit tested | Yes | Data model only |
| Sandbox tested | **No** (needs the Developer Hub application) | n/a |
| HMRC production approved | No | No |
| Live connection tested | No | No |
| Production operational | No | No |
