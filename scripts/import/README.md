# Engager import

One-off scripts that turn Engager exports into the tables loaded into SharePoint. Run them from a **local data folder outside this repository**; none of their inputs or outputs belong in git.

## Inputs (in your data folder)

| File | From |
|---|---|
| `raw/clients.csv` | Engager → Clients list export |
| `raw/jobs_open.csv` | Engager → Jobs list export |
| `raw/jobs_completed.csv` | Engager → Completed jobs report |
| `raw/ch_snapshot.csv` | Companies House dates per company (columns: `company_number, ch_name, ch_status, next_accounts_made_up_to, accounts_due, last_accounts_made_up_to, next_cs_date, cs_due, last_cs_dated, ch_warning`) |
| `raw/name_fixes.json` | Optional: words Engager title-cased that should be capitals, e.g. `{"xyz": "XYZ"}` |
| `raw/decisions.xlsx` | The import-check workbook, filled in |
| `raw/extra_jobs.csv` | Optional: `client, service, period_end, deadline, why` |
| `raw/extra_group_members.csv` | Optional: `group, member, kind, why` |

## Steps

```bash
# 1. Import and check
python3 import_engager.py --clients raw/clients.csv --jobs raw/jobs_open.csv \
    --completed raw/jobs_completed.csv --ch raw/ch_snapshot.csv \
    --name-fixes raw/name_fixes.json --out out --today 2026-10-08

# 2. Build the import-check workbook for review
python3 build_report.py --out out --file "Engager import check.xlsx"

# 3. Once the yellow cells are filled in, apply the decisions
python3 apply_decisions.py --out out --decisions raw/decisions.xlsx --ch raw/ch_snapshot.csv \
    --extra raw/extra_jobs.csv --extra-members raw/extra_group_members.csv \
    --final final --today 2026-10-08
```

`final/` then holds the tables to load (clients, contacts, groups, group members, service and stage templates, client services, jobs, job history) plus `import_log.csv`, listing every change the decisions made.

## What the import does

- Companies House is the source of truth for accounts and confirmation statement dates.
- Engager's business profile fields are skipped: they hold the same form defaults on every record.
- Jobs already filed at Companies House are closed and next year's job is created.
- Monthly jobs never ticked off are closed and the current period is created.
- Individuals are matched between files by first name and surname ("Smith, Jane Mary" ↔ "Jane Smith").
- Groups are suggested from Engager's Relationships, using primary contacts and company links only.

Requires Python 3.10+ and `openpyxl`.
