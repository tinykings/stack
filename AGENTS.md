# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Stack is a lightweight, self-contained static budgeting PWA hosted on GitHub Pages at https://tinykings.github.io/stack/. It uses vanilla JavaScript, HTML, and CSS with zero dependencies and no build tools.

## Development

No build step, package manager, or tooling required. Open `index.html` directly in a browser or serve with any static file server. No tests or linting are configured.

## Architecture

The entire app lives in three files:

- **`app.js`** — All application logic (~1300 lines). Single-page app with state-based rendering.
- **`style.css`** — Complete styling with CSS variables. Editorial dark theme with amber accents.
- **`index.html`** — HTML structure and modal templates.

### State Model

```javascript
state = {
  balances: { checking: 0, savings: 0, credit: 0 },
  accounts: [],  // {id, name, amount, isPositive}
  items: {
    accounts: [], // legacy placeholder
    budget: [],   // unified expenses
    bills: [],    // legacy; migrated into budget on load
    goals: []     // legacy; migrated into budget on load
  }
}
```

Each current expense item in `items.budget` has: `{id, name, amount, neededAmount, due, spent[], enableSpending}`. The current `due` field is `{date:'YYYY-MM-DD', recurring:boolean}`. Legacy budget/bill/goal due formats are normalized by `migrateToUnifiedItems()`.

### Key Patterns

- **Rendering:** `render()` → `renderLists()` + `computeTotals()`. All DOM updates go through this path.
- **Available calculation:** `(Assets - Liabilities) - Remaining Expenses`
- **Persistence:** localStorage for local data; optional GitHub Gist sync via personal access token (file: "budget-data.json"). Auto-saves to Gist on changes; auto-refreshes when app regains foreground focus.
- **Modals:** Forms for add/edit/spend/import/sync use `.modal-overlay` with blur backdrop, wired up in `setupUI()`.

### CSS Layout

Three-column grid on desktop (Accounts, Expenses, History), two on tablet, single column on mobile. Fonts: DM Sans (UI) and JetBrains Mono (numbers).
