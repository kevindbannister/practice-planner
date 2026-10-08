# Practice Planner

An internal practice manager for a single accounting and advisory practice, built around **planning** rather than deadlines. Every job carries three dates (records expected, planned, deadline), and the planning board is the main screen.

- **App:** single-page web app (React + TypeScript), signing in with Microsoft 365
- **Data:** SharePoint Lists on a dedicated site, read and written through Microsoft Graph; every edit saves immediately, with version history
- **Backups:** nightly Excel export to OneDrive, plus an "Export now" button
- **Background jobs:** Companies House checks and the scheduled export (stage 4)

See [docs/spec.md](docs/spec.md) for the full spec and [docs/setup-microsoft.md](docs/setup-microsoft.md) for the one-off Microsoft 365 setup.

## Repository layout

| Path | What's there |
|---|---|
| `docs/` | Spec and setup guides |
| `scripts/import/` | One-off import from Engager exports (see its README) |
| `app/` | The web app (from stage 2) |

## Client data

**No client data is ever committed here.** Engager exports, import output, workbooks and the name-fixes file are all excluded by `.gitignore`. Keep them in a separate local folder.

## Build stages

1. Foundations: SharePoint site and lists; Engager data imported and checked
2. Clients: clients list, quick look, client page
3. Planning board: drag-and-drop planning, capacity, flags
4. Automation: roll-forward, Companies House checks, OneDrive export
5. Groups and polish
