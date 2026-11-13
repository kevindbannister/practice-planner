# Co Sec: temporary "Reset filings" button (V26.2)

**Temporary.** Remove `app/src/lib/cosecReset.ts`, `app/tests/cosecReset.test.ts` and the `ResetFilings` component in `app/src/ui/CoSecPage.tsx` once Co Sec's filings are settled.

Where: Co Sec › Filings, at the top. Shown to people who can approve (manager or partner).

What it does, for all companies at once:
1. Reads every company that isn't dissolved from Companies House again.
2. Removes the drafts that were never sent to Companies House and that the planner prepared itself (from a year end, name or office difference). That means statuses awaiting review, needs information, approved, declined and cancelled.
3. Removes the records that stopped the same difference being picked up again (the draft's change-detection events). Without this the drafts would not come back.
4. Saves what Companies House shows now against each company, then prepares the filings that adding each company fresh would give.

What it never touches: filings that were submitted, accepted, filed externally, completed or rejected by Companies House, and filings a person started by hand in Co Sec (appointments, share transfers, confirmation statements, a change of accounting reference date on request). Those can't be worked out again from Companies House. Pending officer and shareholder rows are left alone too.

It asks for confirmation first, with the numbers. Nothing is sent to Companies House. The removal is permanent. A company Companies House can't be read for is compared with its last recorded data, and the result says which.
