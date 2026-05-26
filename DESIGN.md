---
name: Stack
description: A lightweight, privacy-first budgeting PWA
colors:
  bg: "#141414"
  card: "#1a1a1a"
  surface: "#1e1e1e"
  surface-up: "#252525"
  border: "#2e2e2e"
  border-light: "#383838"
  text: "#d4d0c8"
  text-secondary: "#8a8780"
  text-dim: "#5c5a55"
  amber: "#c8a44e"
  amber-dim: "#a68a3a"
  green: "#5a9a6a"
  green-text: "#7bc48e"
  red: "#b05050"
  red-text: "#d47272"
  yellow: "#b89940"
  blue: "#4f86d9"
  blue-text: "#8db5f2"
typography:
  body:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  mono:
    fontFamily: "JetBrains Mono, SF Mono, Fira Code, monospace"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.03em"
  label:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.08em"
    textTransform: "uppercase"
rounded:
  sm: "4px"
  md: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "#141414"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
  button-icon:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    size: "42px"
  card-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  modal:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "0"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "inherit"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: Stack

## 1. Overview

**Creative North Star: "The Control Room"**

An operational dashboard for personal finance. Warm blacks and amber data recall industrial control panels — glowing dial indicators on dark backgrounds, purposeful illumination where attention is needed. Every surface recedes so the numbers lead.

The system is flat by default: depth comes from tonal layering (background → card → surface → surface-up), not shadows. Cards and containers are distinguished by subtle borders (`#2e2e2e`) and background shifts (`#141414` to `#1a1a1a` to `#1e1e1e`). The one shadow in the system belongs to modals (`0 20px 60px rgba(0, 0, 0, 0.5)`), pulling the user's focus to an overlay action.

**Key Characteristics:**
- Dark warm palette with amber primary: utility-brewed, not corporate-cool
- Typography hierarchy is the layout: one typeface (DM Sans) for structure, one (JetBrains Mono) for data
- Interactive elements are tactile and confident: amber glow on hover, visible press states, clear feedback
- The available amount (`24px / 700 weight / amber`) is the anchor element — the answer to "what can I spend?"
- No charts, no gauges, no data viz flourishes. The progress bar on each item is the only indicator.

## 2. Colors

Warm-neutral dark ground with a single amber voice. Every neutral is tinted toward amber-chroma (approx 0.008 in OKLCH) at very low saturation so the palette reads warm, not sterile gray.

### Primary
- **Amber** (`#c8a44e`): The active voice. Used for actionable elements (primary buttons, hover states, focus rings, the available amount, section toggles when on, accent headers). Never decorative.
- **Amber Dim** (`#a68a3a`): Hover and border variants of the primary. Used for button hover fallbacks and reduced-threshold amber signaling.
- **Amber Glow** (`rgba(200, 164, 78, 0.08)`): The hover/active background fill for interactive surfaces. Visible only on interaction — invisible at rest.

### Semantic
- **Green** (`#5a9a6a`) / **Green Text** (`#7bc48e`): Positive — asset amounts, progress bars in good territory, "paid" button.
- **Red** (`#b05050`) / **Red Text** (`#d47272`): Negative — liability amounts, overspent items, danger zone progress bars, delete buttons.
- **Yellow** (`#b89940`): Warning territory on progress bars (below 50% remaining).
- **Blue** (`#4f86d9`) / **Blue Text** (`#8db5f2`): Spend action button, secondary informational state.

### Neutral
- **Background** (`#141414`): Deepest surface. Page background and modal overlay backdrop.
- **Card** (`#1a1a1a`): Section cards and modal container. One step up from background.
- **Surface** (`#1e1e1e`): Item rows, inputs, and secondary containers within cards.
- **Surface Up** (`#252525`): Hover state for interactive surfaces.
- **Border** (`#2e2e2e`): Default stroke for cards, buttons, inputs, and dividers.
- **Border Light** (`#383838`): Hover and secondary borders.
- **Text** (`#d4d0c8`): Primary content — warmth from the amber-tinted neutrals.
- **Text Secondary** (`#8a8780`): Metadata, secondary labels, supporting text.
- **Text Dim** (`#5c5a55`): Disabled state, placeholders, section headers in uppercase.

### Named Rules
**The One Voice Rule.** Amber is the only accent. Green, red, yellow, and blue are semantic (positive / negative / warning / action) — never decorative. If a color can't be described as "signaling X", it doesn't belong.

**The Surface Stack Rule.** Four neutral steps define depth: bg (farthest) → card → surface → surface-up (closest). No shadows needed. This stack is the elevation system.

## 3. Typography

**Body Font:** DM Sans (with -apple-system, BlinkMacSystemFont fallback)
**Mono Font:** JetBrains Mono (with SF Mono, Fira Code fallback)

**Character:** A functional pairing with editorial warmth. DM Sans provides clear, neutral information hierarchy without the clinical chill of popular geometric grotesques. JetBrains Mono brings precision to numbers — open counters, clear punctuation, distinct `0`/`O` and `1`/`l`/`I`. The pairing says "designed with care for the person reading it."

### Hierarchy
- **Available Amount** (`JetBrains Mono 700`, `24px`, `1.1 line-height`, `-0.03em tracking`): The single most important number on screen. Anchored at the bottom in amber. Resets the user's mental model.
- **Item Name** (`DM Sans 500`, `15px`, `1.5 line-height`): Primary content of every list item. Truncated with ellipsis when overflow.
- **Item Amount** (`JetBrains Mono 600`, `14px`, `-0.03em tracking`): Data alongside each name. Right-aligned in the flex row.
- **Section Header** (`DM Sans 600`, `12px`, `0.08em tracking`, uppercase): Category title above each column. Dim color signals "structure, not content."
- **Section Total** (`JetBrains Mono 500`, `13px`, `-0.02em tracking`): Subtotal per category in the header row.
- **Body / Label** (`DM Sans 400`, `15px`): Form labels, descriptions, secondary text. `65-75ch` max line length in modals.
- **Metadata** (`JetBrains Mono 400`, `12px`, `-0.01em tracking`): Due dates, needed amounts, last-spend info. The quietest text on screen.

### Named Rules
**The Mono-for-Data Rule.** All numeric values render in JetBrains Mono. Not just financial figures — percentages, dates in display, ordinal days. If it's a number, it's mono.

## 4. Elevation

Zero shadows at rest. Depth is communicated exclusively through the four-step tonal layering of the neutral palette: background (`#141414`) → card (`#1a1a1a`) → surface (`#1e1e1e`) → surface-up (`#252525`). Each step is a ~4% lightness increase in the same warm-neutral tonality.

The only shadow in the system is on the modal overlay backdrop (`rgba(0, 0, 0, 0.65)`) and the modal card itself (`0 20px 60px rgba(0, 0, 0, 0.5)`). Modals are the single "lifted" surface — a deliberate departure that signals "this is a temporary decision layer."

### Named Rules
**The Flat-by-Default Rule.** Surfaces are flat at rest. The surface stack handles depth. The shadow on modals is the exception that proves the rule — use it sparingly enough that it still feels like an exception.

## 5. Components

### Buttons
- **Shape:** Slightly square (`4px` radius). No pill shapes, no rounded rectangles.
- **Primary (`button-primary`):** Amber fill (`#c8a44e`), dark text (`#141414`), `10px 20px` padding, `42px` min-height, uppercase 12px/600 weight. Hover: amber dim (`#a68a3a`). Active: opacity 0.8 with no transform.
- **Secondary (`button-secondary`):** Surface background (`#1e1e1e`), border (`#2e2e2e`), secondary text (`#8a8780`). Hover: border lightens (`#383838`), text lifts to primary (`#d4d0c8`). Active: surface-up background.
- **Icon (`button-icon`):** Square `42px`. Same hover/active as secondary. Used for utility actions (settings, autofill).
- **Delete (`delBtn`):** Transparent background, red border (`#b05050`), red text (`#d47272`). Hover: red-tinted background fill at 10% opacity.
- **Action variants:** Spend button uses blue (`#4f86d9`), Paid button uses green (`#5a9a6a`). Fill style like primary but with semantic color.

### Inputs / Fields
- **Style:** Surface background (`#1e1e1e`), border stroke (`#2e2e2e`), `4px` radius, `42px` min-height, `10px 12px` padding.
- **Focus:** Border shifts to amber dim (`#a68a3a`) with amber glow box-shadow (`0 0 0 1px rgba(200, 164, 78, 0.08)`). No outline.
- **Monetary/date inputs:** Use JetBrains Mono at `14px` with `-0.02em` tracking.

### Cards / Containers (`.list`)
- **Corner Style:** `6px` radius.
- **Background:** Card (`#1a1a1a`).
- **Shadow Strategy:** None — flat by default.
- **Border:** `1px solid #2e2e2e`.
- **Internal Padding:** `14px`.

### List Items (`.item`)
- **Corner Style:** `4px` radius.
- **Background:** Surface (`#1e1e1e`).
- **Border:** `1px solid transparent` (visible `#2e2e2e` on hover).
- **Internal Padding:** `10px 12px`.
- **Content:** Three-row layout — name + amount row, metadata row (due + needed + last spend), optional progress bar.

### Progress Bar
- **Height:** `2px`.
- **Background:** Border (`#2e2e2e`), `1px` radius overflow.
- **Fill Colors:** Green (good, >50% remaining), Yellow (warning, 25-50%), Red (danger, <25%).
- **Easing:** `0.4s cubic-bezier(0.4, 0, 0.2, 1)`.

### Modal
- **Mobile:** Top-anchored sheet with `0 20px 60px rgba(0,0,0,0.5)` shadow, `6px` bottom radius only, slide-down entrance.
- **Desktop (≥600px):** Centered dialog with full `6px` radius, slide-up entrance.
- **Overlay:** `rgba(0, 0, 0, 0.65)` with `4px` blur. Click-to-dismiss.
- **Animation:** `0.2s cubic-bezier(0.16, 1, 0.3, 1)` (exponential ease-out).

### Footer Bar
- **Style:** Fixed bottom bar, card background (`#1a1a1a`), border-top (`#2e2e2e`).
- **Layout:** Two-column — available amount (left) + utility icon buttons (right).
- **Available Amount:** The anchor typography treatment — amber, `24px` JetBrains Mono 700.

### Autofill Modal (`.autofill-item`)
- **Row:** Surface background, border-bottom separator, `7px 12px` padding, cursor-pointer.
- **State:** Checked → full opacity. Unchecked → dimmed to 35% opacity.
- **Amount:** Green when affordable, red (`autofill-item-amount--unaffordable`) when not.

## 6. Do's and Don'ts

### Do:
- **Do** use tonal layering for depth. Four steps (bg → card → surface → surface-up) are enough.
- **Do** make interactive elements visible on hover — amber border glow or surface-up background, clearly scoped.
- **Do** set all monetary values in JetBrains Mono with consistent `-0.03em` tracking.
- **Do** use progress bars as the only data indicator. One bar per item, `2px` tall.
- **Do** keep the available amount in the footer at `24px` amber — it's the primary answer the user came for.
- **Do** use animateNumberChange with color flash (green for up, red for down) as the single animated feedback.
- **Do** use `ease-out-quart` / `cubic-bezier(0.16, 1, 0.3, 1)` for motion. No bounce, no elastic.

### Don't:
- **Don't** use SaaS-cream fintech aesthetics. No rounded cards with gradients, no hero-metric templates, no onboarding wizards.
- **Don't** use dashboard treatments: no gauges, sparklines, charts, data viz flourishes, or "insights" panels.
- **Don't** use Notion-style design: no dot-grid backgrounds, pastel accents, or playful illustration.
- **Don't** use `#000` or `#fff`. Every neutral is tinted warm.
- **Don't** use em dashes ever. Commas, colons, semicolons, periods, or parentheses only.
- **Don't** add side-stripe borders. No `border-left` >1px colored accent on cards, items, or callouts. Use full borders, background tints, or nothing.
- **Don't** use gradient text (`background-clip: text` with gradient). One solid color per text element.
- **Don't** use glassmorphism as a default. No decorative backdrop-blur.
- **Don't** animate CSS layout properties (width, height, position, margin, padding, gap, grid).
- **Don't** wrap everything in a container. Most things don't need one.
- **Don't** nest cards. One container layer per surface.
