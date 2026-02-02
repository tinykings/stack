# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
    accounts: [],
    budget: [],   // recurrence-based (every-month / every-check)
    bills: [],    // day-of-month due dates
    goals: []     // target date-based
  }
}
```

Each budget/bill/goal item has: `{id, name, amount, neededAmount, due, spent[], enableSpending}`. The `due` field varies by category: `{type:'recurrence', value}` for budget, `{type:'day', value:1-31}` for bills, `{type:'date', value:'YYYY-MM-DD'}` for goals.

### Key Patterns

- **Rendering:** `render()` → `renderLists()` + `computeTotals()`. All DOM updates go through this path.
- **Available calculation:** `(Assets - Liabilities) - Budget Total - Bills Total - Goals Total`
- **Persistence:** localStorage for local data; optional GitHub Gist sync via personal access token (file: "budget-data.json"). Auto-saves to Gist on changes; auto-refreshes when app regains foreground focus.
- **Modals:** Forms for add/edit/spend/transfer use `.modal-overlay` with blur backdrop, wired up in `setupUI()`.

### CSS Layout

Four-column grid on desktop (one per category), two on tablet, single column on mobile. Fonts: DM Sans (UI) and JetBrains Mono (numbers).
