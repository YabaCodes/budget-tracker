# Budget Tracker

A simple monthly budget app for the phone. It keeps track of how much is in **Cash** and in the **Bank Account**, and every income and expense updates those balances automatically.

Live: https://yabacodes.github.io/budget-tracker/

## What it does

- **Balances.** Two accounts, Cash and Bank Account (the bank one can be renamed). Income adds to an account, expenses take from it, and *Move money* moves money between them. Balances are always worked out from what was recorded, so they can't drift.
- **Fix balance.** If the bank app or wallet shows a different amount, enter the real number. The difference is recorded as a correction, so nothing changes silently.
- **Income types.** Salary, Stipend, Gift, Reimbursement, Other.
- **Budget, in two groups.**
  - *Fixed*: the same every month (phone, monthly transport pass, …). Home shows what's paid and has a **Pay** button that fills in the usual amount.
  - *Flexible*: everyday spending (food, household, …), with an optional monthly limit. Home shows **Left to spend**.
  - Nothing is pre-filled. During setup, and on the Budget screen, there are one-tap suggestions (Business Payment, Phone, Transport, Food, Household). *Others* is always there for anything else.
  - Changing an amount applies from the current month; past months keep what they had.
- **Activity.** Every entry by month, with filters, a spending breakdown and six months of money in vs. money out.
- **Backup.** Export a backup file (or a CSV for a spreadsheet) and import it on a new phone. Home reminds you when a backup is overdue.
- **Private and offline.** Data stays on the phone (no account, no server). It works offline once installed. *Hide* masks the amounts on screen.

## Install on iPhone

Open the link in Safari, tap **Share**, then **Add to Home Screen**.

## Updating from version 8

The first time version 9 opens, it converts the old data on the phone automatically:

- The old **reserve** becomes the Bank Account balance, plus any money still set aside in an unfinished Special Budget. Cash starts at 0. Use **Move money** if part of it is actually cash.
- Categories you created or changed are kept as Flexible items. Untouched default categories are dropped. *Miscellaneous* becomes *Others*. Items can be moved to Fixed from the Budget screen.
- Past expenses stay in Activity and Budget under their month. They don't change the balance, because the old version never took them off the reserve.
- Special Budgets and currency conversion are not part of version 9. The old data stays on the phone as a safety copy (**More → Previous version's data**), where it can be downloaded or removed.

Backup files from version 8 can also be imported.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell: header, month switcher, bottom navigation, pop-up form |
| `app.js` | All app logic: data, calculations, screens, forms, backup, upgrade from v8 |
| `styles.css` | Styles, light and dark mode |
| `sw.js` | Offline support (network first, so updates show up on the next launch) |
| `manifest.json`, `icons/` | Home-screen app details |

Data is saved in the browser's `localStorage` under `budgetTracker.v9`.

## Releasing a change

Bump `APP_VERSION` in `app.js` and `CACHE` in `sw.js` together, so phones pick up the new files.
