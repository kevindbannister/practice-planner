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

## 5. Host the app (Azure Static Web Apps, free plan)

Do this once the code is in the GitHub repository.

1. Go to **portal.azure.com** and sign in with your Microsoft 365 admin account. If you have no Azure subscription, create a **Pay-As-You-Go** one: it asks for a card, but the Static Web Apps **Free** plan costs nothing.
2. **Create a resource** → search **Static Web App** → **Create**.
   - Resource group: new, `practice-planner`
   - Name: `practice-planner`
   - Plan type: **Free**
   - Region: **West Europe**
   - Source: **GitHub** → sign in → choose your account, the `practice-planner` repository, branch `main`
   - Build presets: **Custom** · App location: `/app` · Api location: *(blank)* · Output location: `dist`
3. Select **Review + create** → **Create**. Azure adds a deployment workflow to the repository and publishes the app (a few minutes).
4. On the new resource's **Overview**, copy the **URL** (like `https://something.azurestaticapps.net`).
5. Back in **entra.microsoft.com** → your **Practice Planner** app registration → **Authentication** → under *Single-page application*, **Add URI**: the URL from step 4 with a `/` on the end. Save.
6. Open the URL, sign in, and follow the Setup page: **Create the lists**, then **Choose import file**.

## Step 6: Companies House key

The Companies House checks run through a small server-side function in the same Static Web App (`api/`). It holds the key, so the key never reaches the browser or this repository.

1. Get a **REST API key** from the Companies House developer hub (developer.company-information.service.gov.uk → Your applications → create an application → Create new key → REST).
2. In **portal.azure.com**, open the **practice-planner** Static Web App → **Settings** → **Environment variables**.
3. Under **Production**, **Add**: name `CH_API_KEY`, value the key. **Apply**, then **Confirm**.
4. In the planner, open **Settings › Companies House** and select **Test connection**.

To change the key later (for example to replace one that's been shared), create a new key in the developer hub, update `CH_API_KEY`, and delete the old key there.

## Step 7: Outlook calendar (optional)

The planner can read your meetings and put planned work in your calendar. It needs the delegated Microsoft Graph permission **Calendars.ReadWrite**.

1. In the planner, open **Settings › Calendar** and select **Connect Outlook calendar**.
2. Microsoft asks you to allow calendar access. Accept it (as the admin you can also tick "Consent on behalf of your organisation").

If Microsoft says you need admin approval instead, add it in Entra first: **entra.microsoft.com** → App registrations → **Practice Planner** → **API permissions** → **Add a permission** → Microsoft Graph → Delegated → **Calendars.ReadWrite** → Add, then **Grant admin consent**. Then connect again.

The planner only changes events it created (category "Practice Planner"). Turning the link off in Settings removes its blocks from the next four weeks.
