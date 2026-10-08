# Microsoft 365 setup

One-off steps, done by a Microsoft 365 admin. They take about 15 minutes and need no passwords or secrets to be shared: the two IDs collected at the end identify the app but don't grant access on their own.

## 1. Create the SharePoint site

1. Go to your SharePoint start page (**office.com** → app launcher → **SharePoint**).
2. Choose **+ Create site** → **Team site**. (If asked to pick a template, the standard team template is fine.)
3. Name it **Practice Planner**. Set privacy to **Private**, and keep yourself as the only member.
4. Note the site address, e.g. `https://yourcompany.sharepoint.com/sites/PracticePlanner`.

The lists inside the site are created by the app itself on first sign-in, so there's nothing to set up by hand.

## 2. Register the app

1. Go to **entra.microsoft.com** → **Applications** → **App registrations** → **New registration**.
2. **Name:** Practice Planner
3. **Supported account types:** *Accounts in this organizational directory only* (single tenant).
4. **Redirect URI:** choose platform **Single-page application (SPA)** and enter `http://localhost:5173`. The real web address gets added once hosting is set up.
5. Select **Register**.
6. On the app's **Overview** page, copy:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## 3. Give the app permission

1. In the app registration, open **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Add:
   - `User.Read` (usually already there): who is signed in
   - `Sites.ReadWrite.All`: read and write the planner's lists
   - `Sites.Manage.All`: create the lists on first run
   - `Files.ReadWrite`: save the Excel backups to your OneDrive
3. Select **Grant admin consent for [your organisation]** and confirm.

These are *delegated* permissions: the app can only ever do what the signed-in person can already do.

## 4. Send back

- The SharePoint site address
- The Application (client) ID
- The Directory (tenant) ID

## Later (stage 2 onwards)

- **Hosting:** an Azure Static Web App, deployed automatically from GitHub. Its web address gets added to the redirect URIs in step 2.
- **Companies House API key:** free from the Companies House developer hub; stored server-side only, never in the app.
