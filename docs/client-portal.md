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
