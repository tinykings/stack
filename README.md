<p align="center">
  <img src="images/icon.png" alt="Stack Logo" width="120" />
</p>

<h1 align="center">Stack</h1>

<h3 align="center">A lightweight budgeting PWA hosted on GitHub Pages.</h3>
<h4 align="center">https://tinykings.github.io/stack/</h4>

---

## Features

- **Accounts** — Track assets (checking, savings) and liabilities (credit cards, loans). Net worth is computed automatically.
- **Budget** — Recurring envelope-style budget items. Set a needed amount, track spending against it, and see a progress bar. Recurrence options: every month or every paycheck.
- **Bills** — Fixed expenses tied to a day of the month, sorted by upcoming due date.
- **Goals** — Savings targets with a target date, sorted chronologically.
- **Available** — A running total showing `(assets − liabilities) − budget − bills − goals`, animated on change.
- **Spending** — Log individual purchases against any budget/bill/goal item. Optionally charge to an account simultaneously to keep balances accurate.
- **Transfers** — Move funds between any two accounts or envelope items.
- **History** — Last 10 actions shown in the footer and viewable in a history modal.
- **Auto Fill** — Paycheck-aware allocation tool (⚡ in the footer). Set your next paycheck date and pay frequency (weekly, biweekly, monthly); the date auto-advances once it passes. Opens a modal showing:
  - *Due by next paycheck* — bills whose due day falls before the next paycheck, goals with a target date before the next paycheck, and budget items (every-check items always included; every-month items included if not yet fully funded). Items are checked and funded in priority order (every-check budget → dated items by due date → every-month budget) against your current available balance. Items you can't afford are shown unchecked in red.
  - *Recommendations* — future bills and goals beyond the next paycheck, sorted by soonest due date, with a suggested per-check contribution calculated as `remaining ÷ paychecks until due`. Recommendations share the available funds left over after due items, with the closest item getting priority. A **Check All / Uncheck All** toggle controls the whole section.
  - Confirming fills only checked items by topping each one up to its needed amount.

## Data & Sync

Data lives in `localStorage` by default — nothing leaves your device. Optional GitHub Gist sync is available for cross-device access:

1. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) (classic) with **Gist** scope.
2. Create a new Gist (any name; Stack will create `budget-data.json` inside it).
3. Open Settings (⚙️) in the app and enter the Gist ID and token.

Once configured, changes auto-save to the Gist and auto-load when the app regains focus.

### Backup & Restore

Use **Export Data** in Settings to download a JSON backup file. Use **Import Data** to restore from one.

## Install as PWA

Stack is a full Progressive Web App. Install it for offline access, faster loads, and a full-screen experience:

| Browser | Steps |
|---|---|
| Chrome / Edge | Menu (⋮) → *Install app* or *Add to Home screen* |
| Safari (iOS) | Share button → *Add to Home Screen* |
| Firefox | Menu (⋯) → *Install* or *Add to Home screen* |

The **Install as App** button in Settings shows step-by-step instructions.

## Tech Stack

- Vanilla JavaScript, HTML, CSS — zero dependencies, no build step.
- Fonts: [DM Sans](https://fonts.google.com/specimen/DM+Sans) (UI) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) (numbers).
- Dark editorial theme with amber accents.
- Service worker for offline caching.
- GitHub Gist API for optional cloud sync.

## Development

No tooling required. Open `index.html` in a browser or serve with any static file server:

```bash
npx serve .
# or
python3 -m http.server
```

The app is three files: `app.js` (~1300 lines), `style.css`, and `index.html`.
