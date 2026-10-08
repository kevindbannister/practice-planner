# Practice Planner app

Single-page app (React + TypeScript), bundled with esbuild. It signs in with Microsoft 365 and keeps all its data in SharePoint Lists on the Practice Planner site.

## Commands

```bash
npm install          # react, esbuild, tsx, typescript
npm run build        # production build into dist/
npm run dev          # http://localhost:5173 against an in-browser demo data store
npm test             # data-layer tests against a fake SharePoint
```

## Layout

| Path | What's there |
|---|---|
| `src/config.ts` | Tenant, app registration and site address (not secrets) |
| `src/lib/auth.ts` | Microsoft sign-in (authorisation code + PKCE), tokens in sessionStorage |
| `src/lib/graph.ts` | Graph client: paging, `$batch`, retries on throttling |
| `src/lib/schema.ts` | The SharePoint lists and columns |
| `src/lib/sharepoint.ts` | Creates lists and columns; reads, creates and updates items |
| `src/lib/importer.ts` | Loads the Engager import bundle, skipping rows already there |
| `src/lib/fakeGraph.ts` | In-memory SharePoint used by the demo build and tests |
| `src/ui/` | Screens: clients list and quick look, client page, groups, setup |
| `public/staticwebapp.config.json` | Azure Static Web Apps routing and security headers |

## Notes

- Dates are stored as ISO text (`2026-10-31`). SharePoint shifts date-only values by time zone; text doesn't.
- Every list has an indexed `Key` used to link records. Lists are named `PP …` on the site.
- Edits save immediately and show in the top bar; if SharePoint refuses, the change is undone on screen.
