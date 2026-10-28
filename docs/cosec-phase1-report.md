# Co Sec Phase 1 report: corporate data foundation

Branch `cosec-foundation` (not merged to main, nothing deployed).

## Built
- **Service level per company** (`CoSecProfiles`): managed, specific filings, ad hoc, monitoring only, historical. Defaults keep today's behaviour (active client = managed, Archived = historical, Co Sec only = monitoring). Monitoring never implies the practice files anything. Optional override for confirmation statements.
- **Add company** from Companies House lookup, an existing XProFlow client, or by hand. Duplicate company numbers are refused. A company that isn't a client is added to the prospect list (Sales › Leads) with its company number, and joins Co Sec when it becomes a client. Existing clients can be added to Co Sec directly.
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

## Decisions made
- Everything is stored in SharePoint for now (including client approvals). Presenter credentials and authentication codes must still not be stored there; they wait for a proper secure store before live filing.
- Extra companies go to the prospect list, not the client list.

## Still needed before live filing
A Companies House test account and presenter set-up.
