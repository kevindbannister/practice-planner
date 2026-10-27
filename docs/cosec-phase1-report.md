# Co Sec Phase 1 report: corporate data foundation

Branch `cosec-foundation` (not merged to main, nothing deployed).

## Built
- **Service level per company** (`CoSecProfiles`): managed, specific filings, ad hoc, monitoring only, historical. Defaults keep today's behaviour (active client = managed, Archived = historical, Co Sec only = monitoring). Monitoring never implies the practice files anything. Optional override for confirmation statements.
- **Add company** from Companies House lookup, an existing XProFlow client, or by hand. Duplicate company numbers are refused. A company that isn't a client is one Clients row with Status `cosec-only`, so there is no second company database (it may show in the Clients list).
- **Portfolio summary** counts, a role filter and a role chip on each company.
- **Share ledger** (`CoSecLedger`) tab for limited companies: opening balance, allotment, bonus, transfer, redemption, cancellation. Holdings and ownership are replayed for any date, so they are never typed in. Negative balances are refused, including against later-dated entries. Entries are never edited: a correction supersedes with a reason and the old entry stays visible. Timeline entries are written for each change.
- **Reconciliation** with the existing working register, with an option to carry the register in as opening balances. Nothing is overwritten.

## Testing
- Unit: 586 app tests pass (18 new: ledger replay, corrections, reconciliation, profiles, duplicates).
- Browser, demo data only (no SharePoint, no Companies House filing): added a company by hand, recorded an opening balance and a transfer, checked holdings change by as-at date.
- Not tested live: SharePoint list creation (lists are created automatically by the existing setup, additive only), Companies House lookup (needs the live proxy).

## Known limits
- Percentages are by share count only; voting and dividend rights and PSC thresholds come later.
- The existing Shareholders register still overwrites balances on transfer; it is not yet driven by the ledger.

## Needed before Phase 2
Decisions in the Phase 0 audit: secure store for client approvals and presenter credentials, Companies House test account, and whether Co Sec only companies should appear in Clients.
