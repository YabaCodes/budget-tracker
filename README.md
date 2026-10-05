# Budget Tracker

A simple monthly budget app for the phone, built on the same design as Wealth OS. It tracks how much is in the **Bank Account** and in **Cash**, updates those balances with every income and expense, and shows what's actually **available to spend** once money set aside for goals is taken out.

Live: https://yabacodes.github.io/budget-tracker/

## Screens

- **Home**
  - *Available to spend*, with the Bank Account and Cash balances underneath and any money set aside for goals.
  - Quick add: Expense, Income, Transfer and Save.
  - This month's income, spending and savings.
  - Flexible spending limits, bills still to pay, the current goal and the last few entries.
- **Budget**
  - Plan vs actual for the month: income, bills, flexible spending and goal savings.
  - The monthly plan shows how much of the income is still unplanned.
  - Bills have a **Record** button that fills in the usual amount.
- **Activity**
  - Every entry by month, with filters and a search across all months.
  - The ⋯ menu on each entry: Repeat expense, Edit, Delete (with Undo).
- **Goals**
  - Each goal shows progress, what's left and the pace ("At NT$4,000 a month: Apr 2027").
  - **Add Money** and **Take Out** move money in and out of a goal.
- **Settings** (gear icon)
  - Theme (System / Light / Dark) and accounts (rename, update a balance, withdraw cash).
  - Categories, with one-tap suggestions: Business Payment, Phone and Transport as monthly bills; Food and Household as everyday spending. *Others* is always there.
  - Currency, backup and restore, and an activity CSV.

## How the money works

- **Balances are worked out from what's recorded:** opening balance + income − expenses ± transfers ± balance updates. Editing or deleting an entry corrects them.
- **Transfers are not spending.** An ATM withdrawal is a transfer from the bank to Cash.
- **Update balance** records the difference when the bank app or wallet shows another amount, so nothing changes silently.
- **Goal money stays in the accounts but is set aside.** Available to spend = total balance − goal savings. Setting money aside needs no bank transfer.
- **Months are calendar months.** Changing a bill or limit applies from the current month; earlier months keep theirs.

## Updating from earlier versions: a fresh start

The first time version 10 opens on a phone that already has data, it starts fresh once:

- **Kept:** the expenses recorded in version 8 (in Activity and Budget, under their month) and the categories, with their amounts.
  - Version 8 categories that were never changed or used are dropped, and *Miscellaneous* becomes *Others*.
  - Old expenses don't change the balance, because version 8 never took them off the reserve.
- **Cleared:** every other money entry, including the version 8 reserve and anything entered in version 9 (balances, income, expenses, transfers, corrections).
- **Then:** she enters today's bank and cash balances, can add any suggested categories she doesn't have yet, and Home shows a short note explaining the fresh start.
- **Nothing is lost for good.** The data from before stays on the phone until it is removed in Settings → *Previous version's data*, where it can also be downloaded.
- **This happens only once.** Restoring a backup file (from version 8, 9 or 10) never triggers it.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell; applies the saved theme before the first paint |
| `app.js` | All app logic: data, calculations, screens, forms, backup, upgrades from v8 and v9 |
| `styles.css` | The Wealth OS design system (the parts this app uses) plus a few additions at the end |
| `sw.js` | Offline support (network first, so updates show up on the next launch) |
| `manifest.json`, `icons/` | Home-screen app details |

Data is saved in the browser's `localStorage` under `budgetTracker.v10`.

## Releasing a change

Bump `APP_VERSION` in `app.js` and `CACHE` in `sw.js` together, so phones pick up the new files.
