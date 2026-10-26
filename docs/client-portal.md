# Client portal: setup and design

The client portal lets clients register, sign in once, and see only the businesses you give them access to. It is part of xproflow, not a separate app.

## How it fits together

- **Clients' browsers talk only to the portal server** (`/api/portal`, an Azure function in this repository). They never reach SharePoint, Microsoft Graph or any list. The server checks who they are and what they may see on every request.
- **Sign-in** is Microsoft Entra External ID, Microsoft's customer sign-in service. Clients register themselves (email confirmed by a one-time code). No passwords are stored by xproflow. The server verifies the signed token the provider issues.
- **Registering gives a login and nothing else.** A person sees a business only when staff add them to it, at one of four levels: Administrator, Standard, Restricted, Signatory. Being listed as a director or contact grants nothing. Signing always needs the person to be named on the document, whatever their level.
- **One login per person.** One record per email address; each business they can see is a separate access record. Inviting the same person again adds businesses, never a second account.
- **Staff screens** are Portal (top bar), the Portal tab on each client, and Client portal access on an individual's page. They call `/api/portal/admin/...` with the staff member's Microsoft 365 sign-in.
- **Data** is kept in `PP Portal …` SharePoint lists, written only by the portal server with its own credentials. All reads and writes go through one small storage interface (`api/portal/lib/store.js`) bound to a single practice, so the store can move to a database later by writing another implementation. Every record carries a practice id and a bound store cannot see another practice's records.
- **The audit trail** (`PP Portal Audit`) is append-only. Each event is signed with a key only the server holds; an event edited afterwards in SharePoint shows as "Altered" in Portal › Activity.
- **Clients never see internal information.** The server answers from a fixed list of client fields (name, number, addresses, contact details, VAT and PAYE references and so on). Job statuses, working papers, tasks, staff, notes, fees, tax references and identity numbers are never read for portal answers.

## One-off setup

Do these in order. About an hour.

### 1. An external tenant for clients
1. In the Microsoft Entra admin centre, create an **external tenant** (Entra External ID, customers). It is separate from your Microsoft 365 tenant, so clients never become users in it.
2. In that tenant: **App registrations › New registration**, name "xproflow client portal". Platform **Single-page application**, redirect URI `https://<your app address>/portal` (add `http://localhost` ones only for testing). Copy the **Application (client) ID**.
3. **User flows › New**: sign up and sign in, with email (one-time passcode, or email with password), collect Display name. Attach the app registration.
4. From the app's **Endpoints** page, open the OpenID Connect metadata document and copy the `issuer` and `jwks_uri` values.

### 2. A server identity for the portal (your Microsoft 365 tenant)
1. **App registrations › New registration**, name "xproflow portal server", single tenant. Add a client secret.
2. Give it access to the planner site only: grant **Sites.Selected** (application permission, admin consent), then give the app the **write** role on the Practice Planner site (Graph `POST /sites/{site-id}/permissions`).
3. For email, add **Mail.Send** (application) and limit it to one mailbox with an Exchange application access policy, so the app can't send as anyone else. Use a mailbox such as `portal@yourpractice.co.uk`.

### 3. Azure application settings (Static Web App › Environment variables)

| Setting | Value |
|---|---|
| `PORTAL_IDP_ISSUER` | the `issuer` from step 1.4 |
| `PORTAL_IDP_JWKS_URL` | the `jwks_uri` from step 1.4 |
| `PORTAL_IDP_CLIENT_ID` | the client portal app's Application (client) ID |
| `PORTAL_GRAPH_TENANT_ID` | your Microsoft 365 tenant ID |
| `PORTAL_GRAPH_CLIENT_ID` | the portal server app's client ID |
| `PORTAL_GRAPH_CLIENT_SECRET` | its secret |
| `PORTAL_AUDIT_KEY` | a long random string (keep it: changing it makes older audit events show as Altered) |
| `PORTAL_MAIL_FROM` | the mailbox from step 2.3 |
| `PORTAL_URL` | `https://<your app address>/portal` |
| `PORTAL_PRACTICE_NAME` | your practice name (until branding is set) |
| `PORTAL_ADMINS_MANAGE_ACCESS` | optional: `true` lets a business's Administrators invite and remove people for that business |

Portal › Set-up shows which of these are still missing.

### 4. First run
Open xproflow as staff once. It creates the `PP Portal …` lists automatically (like every other list). Then Portal › People › Invite someone.

## Two-step sign-in (MFA): what the provider offers

As checked in October 2026, an external tenant offers **email one-time code, SMS (a paid add-on) and passkeys** as second factors. Authenticator-app codes (TOTP) are not in Microsoft's documentation for external tenants. Microsoft enforces two-step with a Conditional Access policy for chosen apps and users, not as a per-person switch. The portal reads whether a sign-in used two-step (the token's `amr` claim) and shows it to staff, who can see adoption but cannot bypass it or see anything used to sign in. A per-person opt-in would be an "opted-in" group the policy targets; making it mandatory is one policy change. The identity provider is replaceable: the server only needs signed tokens (`PORTAL_IDP_*`), so a provider with authenticator-app support could be swapped in.

## Limits to know about

- The server's rate limit is in memory on each server instance. It slows floods but the provider's own sign-in protections are the real brute-force defence.
- Audit events can't be silently edited, but deleting one is only caught by SharePoint's version history and recycle bin.
- Permissions are enforced by the portal server; staff screens are for people who already have full access to the planner's site.

## Document centre (phase 4)

- Staff add a document on a client's **Portal** tab. It stays a draft until published; clients see only published documents. Optionally name the people it is for (otherwise all administrators and standard users), and ask for the client's approval.
- Restricted and Signatory people see only documents assigned to them. Client uploads by a restricted person are visible to that person and administrators/standard users; a signatory can't upload.
- Files live in a `Client Portal/<practice>/<client>/<document>/` folder of the planner site's document library, written with the same app-only Graph access as the lists. There is no public link: every download is a signed-in call that is permission-checked and audited, and the file is returned inside the response.
- Checks before storing: size (10 MB, `PORTAL_MAX_UPLOAD_MB`), an allow-list of types (PDF, DOCX, XLSX, PNG, JPG, CSV, TXT), the file's first bytes must match its extension, no double extensions, no macro-enabled Office files, no PDFs with scripts/launch actions. This is format checking, not antivirus. A real scanner can be passed to the handler as `scanner(bytes, info) -> {ok}`; until then the staff screen says "no virus scanner connected".
- Emails only say a document is waiting; they never carry its name or contents.
- Versions are never overwritten. A new version resets approval. Approval records who, when and the SHA-256 of the exact version approved.
- Preview uses the browser's own PDF viewer (blob address); phones that can't show PDFs inline fall back to Download.
- Not yet: retention/deletion, virus scanning, identity documents (own module, phase 6).

## E-signing (phase 5)

- Staff pick a PDF from a client's documents, name the people who must sign (and whether in order), and send it. Only a **named** person can sign it. Being an administrator, or having portal access at any level, never gives that right. They also need active access to the business. A person who isn't named gets the same "not found" as for a request that doesn't exist.
- The signer reads the PDF in the portal, ticks a consent statement, and types their name or draws a signature (finger, pen or mouse; a blank drawing is refused by checking the image has ink). They can decline with a reason.
- At signing the server re-checks the document's SHA-256 against the one recorded when it was sent, and records: time, network address, browser/device, whether the sign-in used two-step, the verified email, the consent text and the document fingerprint.
- When the last person signs, the server writes a **signed copy** (original pages, a reference footer on each, and a signature page) and an **evidence certificate**, files both in the document centre (locked, assigned to the signatories), and records their SHA-256 in the audit trail. "Check integrity" on the staff screen re-reads the files and the record and says if anything has changed.
- Emails say only that a document is waiting. Reminders can be sent by staff; the automatic schedule comes with the reminder engine.
- **What this is not.** These are simple electronic signatures with an evidence trail. The sealed PDF has no cryptographic certificate from a trust service provider, so it isn't a "qualified" signature, and the certificate says so. Whether an electronic signature is suitable for a given document (for example deeds, or anything requiring witnesses) is for the practice to decide. Do not describe it as more than this.
- **Dependency.** The API now has one dependency, `pdf-lib` 1.17.1. The GitHub workflow installs it into `api/node_modules` and deploys with `skip_api_build`, so Azure does not need to build the functions. If the deploy ever drops `node_modules`, signing (and only signing) fails with a clear server error.

## Identity documents and renewals (phase 6)

- **Belongs to the person.** Identity documents are tied to a portal login, not to a business. The portal has no business in the route and no way for anyone else (an administrator, another user of the same business, someone at another business) to see them: they get the same "not found" as for something that doesn't exist. Only the practice can open them.
- **Types:** passport, driving licence, national identity card, proof of residential address, or a custom named document. The practice chooses which each person must provide, which businesses it covers, and whether it renews automatically.
- **Reuse, not duplicate.** Asking for a document the person already has accepted and valid is refused, and the business is added to the existing one. "Ask again anyway" overrides it. An open request can't be duplicated.
- **Checking.** The practice has to open the file (logged) before it can accept it, confirm they've checked it, and enter the expiry date or say it has none. If `PORTAL_ID_VERIFIERS` is set (comma-separated emails or display names), only those people can accept or reject. Accepting records who and when; **it does not complete the practice's AML identity verification**, and the screens say so.
- **Rejecting** reopens the request with the reason shown to the client, keeps the rejected file in history and lets them send another.
- **Renewal rule.** The next request date is one calendar month before expiry (15 Sep 2027 gives 15 Aug 2027; a 31 March expiry gives 28/29 February). With no expiry date, an optional "review every N months" applies. Accepting a replacement moves the old one to history and recalculates the next date, so it repeats. Cancelling a renewal request stops the automatic rule until a replacement is accepted.
- **Reminders** (defaults: 7 and 14 days after asking, and 7 days before expiry; each sent once; one email per run even if several are due). They stop when the request is completed or cancelled, or when paused. An internal alert appears if a document expires without an accepted replacement.
- **Running the date rules.** `identity.sweep` does the renewals and reminders and is safe to run as often as you like. For now staff can press "Run date checks now" on Portal › Identity. Nothing runs it automatically yet; the scheduled trigger comes with the reminder engine (phase 7). Until then renewals and reminders only happen when someone presses the button.
- **Security.** Files are encrypted (AES-256-GCM) before they're stored, with a key derived from `PORTAL_ID_KEY` (or, if that isn't set, from `PORTAL_AUDIT_KEY`). Lose the key and the files can't be read, so keep it safe and don't change it. Uploads are limited to PDF, JPG and PNG and are format-checked; a virus scanner can be plugged in the same way as for documents. Every opening is audited. Dates are compared in UTC.
- **Not yet:** retention and deletion (including removing old identity files), specialist ID-verification providers, and the scheduled trigger above.

## Information requests, notifications and reminders (phase 7a)

**Information requests.** Staff ask a client for something from the client's Portal tab ("Ask for information"), optionally for named people only (restricted users see only requests assigned to them). The client answers on the Requests page with words and/or files; files go through the normal upload checks into the document centre ("From you"). Status: waiting for the client, answered (needs staff), complete, cancelled. Staff can reply and complete. The email only says something is waiting, never what.

**Notifications.** Short in-portal lines (new request, question, document to approve, etc.) shown on the client's home page, with "Mark all as read". They never contain document contents.

**Reminders.** One central engine chases signing, information requests, document approvals and change-request questions. Per kind: first reminder after N days, repeat every N days, at most N. Items can be paused, stopped or rescheduled; everything can be paused globally (always respected, including by "Run now"). Reminders go 07:00–19:00 UK time, as one email per person per run, and stop by themselves when the thing is done. Every sent reminder is in the audit trail. The same run also asks for identity renewals one calendar month before expiry.

**Scheduler.** Azure Static Web Apps' built-in functions can't run on a timer, so `.github/workflows/portal-reminders.yml` calls `POST /api/portal/system/sweep` hourly. Set repository secrets `PORTAL_BASE_URL` and `PORTAL_SWEEP_KEY`, and the same `PORTAL_SWEEP_KEY` as an app setting in Azure (a long random string). Until then nothing runs automatically; Portal > Reminders shows when it last ran and warns if that's more than 3 hours ago, and "Run now" works by hand.

## Secure messaging (phase 7b)

Conversations belong to one business and live in the `messages` list (thread records and message records). Staff start or reply from the client's Portal tab; clients use the Messages page. Rules:

- **Who sees what.** Administrators and standard users see the business's conversations (same rule as documents and requests). Restricted users see only conversations they are named in, and conversations they start are private to them and the practice. Signatories and people outside the business get the same "not found" as for a conversation that doesn't exist.
- **Unread** is per person and counted in messages (not timestamps). Opening a conversation marks it read for that person only; a colleague's reply is unread for the others. The client sees a badge on the Messages menu and a line on the home page; staff see conversations waiting on them in Portal > Overview (filterable by type, searchable) and in the client's Portal tab.
- **Notifications** say that a message is waiting ("New message from ..."), never what it says. Emails say the same; the message is never in an email. Colleagues get an in-portal line only.
- **No internal notes.** A conversation has only the written messages, names and times; there is nowhere to store a staff-only note, so none can be shown. The staff box says so.
- **Attachments** are real documents in the document centre (same type, size and content checks; refused files leave no empty conversation). People who can't upload can't attach. Staff attachments are published to the people the conversation is for.
- **Search** covers subjects and message text among conversations the person may see.
- **History** is kept; nothing is deleted from the portal. The audit trail records that a conversation started or a message was sent (with counts), never the text.
