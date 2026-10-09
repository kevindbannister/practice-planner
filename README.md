# Practice Planner

An internal practice manager for a single accounting and advisory practice, built around **planning** rather than deadlines. Every job carries three dates (records expected, planned, deadline), and the planning board is the main screen.

- **App:** single-page web app (React + TypeScript), signing in with Microsoft 365
- **Data:** SharePoint Lists on a dedicated site, read and written through Microsoft Graph; every edit saves immediately, with version history
- **Backups:** an Excel copy of every list saved to OneDrive the first time the planner opens each day, plus "Export now" and "Download a copy" (Settings › Backups)
- **Planning views:** the week board (drag with mouse or finger), months ahead (hours due against capacity, including next periods of recurring work) and a printable deadlines list
- **Suggest a plan:** fills the rest of the week from unplanned work by fixed rules (late, urgent, nearest deadline; skips work waiting for records; fills each day to a set level)
- **Outlook calendar:** meetings reduce each day's hours; planned work is kept in the calendar as time blocks
- **Chasing records:** clients whose records are due or late, with an email from a template and a log of each chase
- **Companies House:** each company checked daily through a server-side function (`api/`) that holds the API key; changes are reviewed in Settings before anything is updated

See [docs/spec.md](docs/spec.md) for the full spec and [docs/setup-microsoft.md](docs/setup-microsoft.md) for the one-off Microsoft 365 setup.

## Repository layout

| Path | What's there |
|---|---|
| `docs/` | Spec and setup guides |
| `scripts/import/` | One-off import from Engager exports (see its README) |
| `app/` | The web app (see its README) |
| `api/` | Azure Functions: the Companies House bridge (no dependencies; `npm test` to test) |

## Client data

**No client data is ever committed here.** Engager exports, import output, workbooks and the name-fixes file are all excluded by `.gitignore`. Keep them in a separate local folder.

## Build stages

1. Foundations: SharePoint site and lists; Engager data imported and checked
2. Clients: clients list, quick look, client page
3. Planning board: drag-and-drop planning, capacity, flags
4. Automation: roll-forward, Companies House checks, OneDrive export
5. Groups and polish
