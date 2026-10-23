# Bank statement import (Accounts working papers)

Part of the working papers (see Working papers design). Updated 23 Oct 2026: the import now lives in its own working paper.

## Where and what
- **"Accounts working papers"** is a section in the Trial balance group, after "Year end trial balance". For clients whose records are manual.
- Three tabs:
  - **Reconciliation:** drop in a PDF or CSV statement (several files, or "add to it" for another statement). Shows the bank reconciliation (balance at the start, receipts, payments, balance at the end per transactions vs per statement, difference), any problems found, totals by category, the trial balance it would create, and the **Create the trial balance** button.
  - **Receipts** and **Payments:** every transaction listed (date, description, amount, category dropdown). "Only ones to sort" filter; "Same for all <payee>" after you set one by hand. AI suggestions are tagged "AI" (hover for why); rules from earlier statements are tagged "remembered".
- Transactions are saved as PaperLines in accwp/main (Code = category key, Remark = AI's reason, Figures = date, balance, type, bank label, how). Statement details are on the Setup of "accwp/main" (opening, closing, files, problems, bank name, balance-at-start override, remembered payee rules). Rules carry in from last year's setup.
- **Create the trial balance** replaces the "Year end trial balance" lines (after asking, if there are lines there). It is a cash-basis TB with IRIS codes so the usual mapping places it; the opening position is a balancing figure through reserves (968/1).

## Reading and checking
- PDF read in the browser with pdf.js (from the site's own /pdf folder, because the security policy allows only own scripts). Columns come from the header line (Date, Type, Transaction, Category, Value/Amount, Balance or Paid in/Paid out); wrapped descriptions joined; repeated page headers skipped. Scanned statements can't be read yet.
- Every balance must follow from the one before (newest-first statements are turned round); flagged: missing balance column, overlapping files, transactions outside the year.
- Tested on Medifox's Starling export: 41 transactions, in £81,255.48, out £68,516.58.

## Categories and AI
- About 37 categories, each with an IRIS code (lib/bankStatement.ts CATEGORIES). Rules first, then remembered payee rules, then "Ask the AI to categorise" (api/ai action `bank`), then you. HMRC payments are left unless the text says VAT, PAYE or corporation tax. Unsure ones go to "Unknown / query for client".
- Only descriptions, bank labels and amounts go to OpenAI (never account numbers), and only after ticking the consent box.

## AI model and effort (Settings › Letters and email › AI writing)
- **Model** (any the key can use) and **Effort** (Automatic = low, Minimal, Low, Medium, High) are one global setting used by letters, emails, meetings, Ask and bank statements. Stored in the `comms` setting (model, effort); sent with every request (ai.ts aiDefaults); the server validates it and passes it as reasoning_effort. Models that don't reason ignore it. Medium and High allow up to 2 minutes.

## Not yet
- Scanned statements (OCR); VAT split; receipts/invoices alongside the statement; using last year's TB as the opening position instead of a balancing figure.
- Code: lib/bankStatement.ts, lib/pdfText.ts, ui/AccountsWorkingPapers.tsx, api/ai `bank`.

## Opening balances (built 23 Oct 2026)
- **Section "Opening balances"** (key `openbal`, on by default) sits after "Year end trial balance" and before "Accounts working papers". The old "client's TB vs ours" section (`opening`) is no longer in the list.
- **Source:** the opening position is last year's closing balance sheet: the previous period's final trial balance (journals included), mapped as usual. Last year's profit and loss accounts and dividends are added to reserves (the existing reserves account, or a new "Profit and loss account - Brought forward" at IRIS 968/1).
- **First set of papers:** "Last year's trial balance" reads an .xlsx or CSV (or pasted rows) from the accounting software: a heading row with the account name and Debit/Credit (or one signed Balance), optional code. The preview shows where each account goes and whether debits equal credits; saving writes it as the previous period's `tb/main` lines (the same place Xero's comparatives and the workbook import use), asking first if there are lines there. After that, each year flows from the one before with no import.
- **Account-style trial balances** ("Turnover - Sales", "Creditors less than 1 year - Corporation tax"): the heading before the first dash says where an account goes (lib/openingBalances.ts statutoryDest); other layouts use the normal name rules.
- **In the Accounts working papers:** the trial balance starts from the opening balances. Each category merges into the opening account that goes to the same place (e.g. "Corporation tax paid" clears last year's corporation tax creditor, leaving the 0.42 over), the bank takes the closing balance on the statement, and anything that doesn't agree is shown as "Difference on opening balances". Suspense, dividends and transfers never merge.
- **Tested on Medifox's trial balance:** 15 accounts; opening balances £7,924 each side; reserves b/f £46 (4,010 + profit 28,936 − dividends 32,900); the bank is £0.79 different from the statement's opening (the trial balance is in whole pounds), shown as the difference.
- **Code:** lib/openingBalances.ts, ui/OpeningBalances.tsx.
- **Editing (23 Oct):** the opening balances table is editable: change an account's name, where it goes, its debit or credit, add or remove accounts. Edits are saved on the Setup of `openbal/main` (`custom`) and then replace the figures worked out from last year; "Go back to last year's figures" clears them. The total is checked as you go.
