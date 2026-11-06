# Development Hub

Built 6 November 2026. Open it from the profile menu (top right) › **Development Hub**, or go to `#/devhub`. It is a separate area with its own menu and is never part of the client portal.

## What is in it

| Section | What it does |
|---|---|
| Overview | Counts by status, completion by workstream, approvals outstanding, what to work on next, recent GitHub activity and changes made in the Hub |
| Feature Map | Interactive map of the whole application (Practice Planner → Run Practice / Deliver Work / Grow & Advise → modules → features → subfeatures). Pan, zoom, expand and collapse, search, filter by status and priority, highlight blocked work, fit to screen. Click a feature for its panel |
| Feature Inventory | Table of every feature with search, filters, sorting and inline status changes. Add your own features |
| Development Board | The repository's GitHub issues as Backlog / Ready / In Progress / Blocked / Testing / Done. Drag a card to change the issue on GitHub |
| Roadmap | The five agreed priorities with progress taken from the features under each, plus milestones |
| Bugs & Issues | Blocked and broken features, known bugs, blockers, unmet dependencies and features built without tests |
| Integrations & Approvals | The external API applications tracker, with follow-up reminders |
| Architecture & Decisions | The decision register, with history when a decision changes |

## Where the data lives

* **The inventory, roadmap, approvals list and decisions ship in the code** (`app/src/lib/devHubSeed.ts`). A test checks that every source file and test file it names exists, so the map cannot drift from the repository without the build failing.
* **Everything you change in the Hub is saved as a small overlay in the existing Settings list** (keys `dev.features`, `dev.tasks`, `dev.milestones`, `dev.integrations`, `dev.decisions`, `dev.admins`, `dev.log`). The seed is never overwritten, nothing touches client or practice records, and no new SharePoint list is needed.
* **GitHub is the source of truth for issues.** The Hub holds only extra notes about an issue (feature link, assignee, target date, checklist), never a second copy of it.

## What "status" means

Nothing is **Complete** unless it has been checked live. Setting a feature to Complete asks for an evidence note (which client, which journey, what happened) and records it with the date.

* **Ready for Testing**: the workflow is built and has automated tests. Not live-ready.
* **In Development**: code exists but there are no automated tests, or the workflow is unfinished.
* **Planned / Not Started**: not built.
* **Blocked / Broken**: with the blocker or bug recorded.
* Completion percentages are left empty ("Not assessed") until someone assesses a feature.

## Connecting GitHub

The browser never sees a GitHub token. The server function `api/devhub` holds it.

1. On GitHub, create a **fine-grained personal access token** limited to the `practice-planner` repository with: Issues read and write, Pull requests read, Contents read, Metadata read.
2. In the Azure Static Web App settings add:
   * `GITHUB_TOKEN`: the token
   * `GITHUB_REPO` (optional): defaults to `kevindbannister/practice-planner`
   * `DEVHUB_ADMINS` (optional): comma-separated Microsoft sign-in names (user principal names) allowed to use the bridge. If unset, anyone signed in to Practice Planner can
3. Open the Development Hub and choose **Refresh from GitHub**. The header badge turns green.

The board uses these labels, which GitHub creates the first time they are used: `status:ready`, `status:in-progress`, `status:blocked`, `status:testing`. Backlog is an open issue with none of them; Done is a closed issue.

What the bridge can do: read issues, create issues (refusing a title that already exists), update an issue's title, description, state and labels, close and reopen, add comments, and read pull requests and commits. Commits and pull requests are linked to tasks when their title or message mentions `#<issue number>`.

If GitHub cannot be reached or refuses a change, the card shows **not synced** with the reason and the banner explains why. Nothing fails silently.

## Who can open it

`dev.admins` holds the names allowed in (as shown in the profile menu). Until a list is saved, any signed-in user of this single-user app can open the Hub and is asked to name the administrators on the Overview. The portal runs on a separate server and has no route to the Hub.

## Keeping it useful

* Every major feature has an inventory record; add one when a module is added.
* Every GitHub issue should name a feature. The New issue form requires one.
* Mention `#<issue number>` in commits and pull requests.
* Do not put passwords, tokens or client data in issues, notes or the approvals tracker. The tracker refuses text that looks like a secret.
* Roadmap progress is calculated from the features, so it updates as statuses change.
