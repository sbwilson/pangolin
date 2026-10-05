---
name: Pangolin Money
description: Self-hosted household finance PWA for Simon and Carissa. Calm layout, cheeky voice. shadcn/ui (new-york) on Tailwind 4 with CSS variables; this file is the brand-layer delta, with Clay & Linen as the default theme and five more switchable themes.
status: final
created: 2026-10-05
updated: 2026-10-05
sources:
  - .memlog.md
  - ../../../specs/spec-pangolin-money/SPEC.md
  - ../../../specs/spec-pangolin-money/data-model.md
  - ../../../specs/spec-pangolin-money/security-and-recovery.md
  - ../../architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md
  - ../../../../apps/web/src/styles.css
  - ../../../../apps/web/components.json
colors:
  # Default theme: Clay & Linen, light. Keys extend shadcn semantic names.
  # Values lifted from mockups/color-themes-1.html <style> comments.
  background: '#F6EFE6'
  foreground: '#2A1F17'
  card: '#FFFAF3'
  card-foreground: '#2A1F17'
  popover: '#FFFAF3'
  popover-foreground: '#2A1F17'
  muted: '#F6EFE6'            # [ASSUMPTION] shadcn muted fill = background; no separate value was rendered
  muted-foreground: '#6A594B'
  border: '#E3D6C5'
  input: '#E3D6C5'
  ring: '#B85A1E'
  primary: '#A3441D'
  primary-foreground: '#FFFFFF'
  accent: '#F6E8DE'           # "tint": primary 10% over card; active nav, hidden-name row, celebration wash
  accent-foreground: '#A3441D'
  destructive: '#A3283A'      # [ASSUMPTION] destructive actions reuse money-out red
  destructive-foreground: '#FFFFFF'
  sidebar: '#F6EFE6'
  money-in: '#3D6B2D'
  money-out: '#A3283A'
  warning: '#8A5600'
  warning-bg: '#F0E5D3'
  person-simon: '#2C6681'
  person-carissa: '#9C4277'
  mascot-scale-1: '#BD785C'
  mascot-scale-2: '#D1A28E'
  chart-1: '#6F8A3D'
  chart-2: '#B5562B'
  chart-3: '#D9A13B'
  chart-4: '#2E8C88'
  chart-5: '#C97B63'
  chart-6: '#8A5A7A'
  chart-7: '#7E6A4F'
  chart-8: '#4F5D85'
  chart-9: '#A3B18A'
  # Clay & Linen, dark
  background-dark: '#1C1713'
  foreground-dark: '#F3E9DD'
  card-dark: '#26201A'
  card-foreground-dark: '#F3E9DD'
  popover-dark: '#26201A'
  popover-foreground-dark: '#F3E9DD'
  muted-dark: '#1C1713'
  muted-foreground-dark: '#B5A391'
  border-dark: '#3E342A'
  input-dark: '#3E342A'
  ring-dark: '#F0A070'
  primary-dark: '#E58457'
  primary-foreground-dark: '#1C1713'
  accent-dark: '#453024'
  accent-foreground-dark: '#E58457'
  destructive-dark: '#F28E8E'
  destructive-foreground-dark: '#1C1713'
  sidebar-dark: '#1C1713'
  money-in-dark: '#94C47E'
  money-out-dark: '#F28E8E'
  warning-dark: '#E6B455'
  warning-bg-dark: '#493B25'
  person-simon-dark: '#7DB7D3'
  person-carissa-dark: '#E39BC6'
  mascot-scale-1-dark: '#ECA686'
  mascot-scale-2-dark: '#F2C2AB'
  chart-1-dark: '#9DBA62'
  chart-2-dark: '#E07F52'
  chart-3-dark: '#EBC066'
  chart-4-dark: '#6FB3B5'
  chart-5-dark: '#E3A38E'
  chart-6-dark: '#C08AB0'
  chart-7-dark: '#B19C7E'
  chart-8-dark: '#B3B8D8'
  chart-9-dark: '#B7C9A8'
  mascot-ink: '#1F2328'       # eyes and claws; fixed in every theme
typography:
  # One family: the system UI stack already in apps/web (no web fonts; strict CSP, no third-party assets).
  page-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 26px
    fontWeight: '600'
    lineHeight: '1.15'
    letterSpacing: -0.01em
  greeting:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.3'
  card-title:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 15px
    fontWeight: '600'
    lineHeight: '1.3'
  body:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.45'
  body-sm:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
  caption:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.35'
  label-caps:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: 0.06em
  figure-kpi:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  figure-stat:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 19px
    fontWeight: '600'
    lineHeight: '1.25'
  figure-glimpse:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 34px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  figure-hero:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 52px
    fontWeight: '600'
    lineHeight: '1.05'
    letterSpacing: -0.025em
  chart-label:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 12.5px
    fontWeight: '600'
    lineHeight: '1.2'
  chart-value:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 11.5px
    fontWeight: '400'
    lineHeight: '1.2'
  wordmark:
    fontFamily: '{typography.page-title.fontFamily}'
    fontSize: 16px
    fontWeight: '650'
    lineHeight: '1.2'
rounded:
  sm: 6px # see § Shapes
  md: 8px # see § Shapes
  DEFAULT: 10px # see § Shapes
  lg: 12px # see § Shapes
  full: 9999px # see § Shapes
spacing:
  # Tailwind 4 4px scale inherited. Named layout tokens below are lifted from the locked mock.
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '9': 36px
  sidebar-width: 232px
  page-padding-x: 36px
  page-padding-top: 28px
  card-padding-y: 18px
  card-padding-x: 22px
  grid-gap: 16px
  margin-phone: 16px   # phone gutter (from mock: key-*-phone)
  date-column: 50px    # transaction row date column (fixed)
  stress-track: 10px   # rate stress bar track height (fixed)
  progress-track: 8px  # budget, goal and category bar height (from mock)
  auth-card-width: 380px # sign-in / setup / recover card (from mock)
  settings-menu-width: 188px # Settings side menu column (from mock: key-settings)
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
    fontWeight: '600'
  button-secondary:
    background: '{colors.card}'
    foreground: '{colors.foreground}'
    border: '{colors.border}'
    radius: '{rounded.md}'
  nav-item:
    foreground: '{colors.muted-foreground}'
    radius: '{rounded.md}'
  nav-item-active:
    background: '{colors.accent}'
    foreground: '{colors.primary}'
    fontWeight: '600'
  nav-badge:
    background: '{colors.warning-bg}'
    foreground: '{colors.warning}'
    radius: '{rounded.full}'
  segmented-control:
    background: '{colors.muted}'
    activeBackground: '{colors.card}'
    activeShadow: '0 1px 2px rgba(0,0,0,.08)' # fixed literal, all themes
    radius: '{rounded.md}'
  kpi-tile:
    background: '{colors.card}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
    valueType: '{typography.figure-kpi}'
  card:
    background: '{colors.card}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
    paddingY: '{spacing.card-padding-y}'
    paddingX: '{spacing.card-padding-x}'
  stat-tile:
    background: '{colors.background}'
    border: '{colors.border}'
    radius: '{rounded.DEFAULT}'
    valueType: '{typography.figure-stat}'
  category-chip:
    border: '{colors.border}'
    foreground: '{colors.muted-foreground}'
    radius: '{rounded.sm}'
  amount-in:
    foreground: '{colors.money-in}'
  amount-out:
    foreground: '{colors.money-out}'
  hidden-name-row:
    background: '{colors.accent}'
    radius: '{rounded.DEFAULT}'
    tagForeground: '{colors.primary}'
    tagBackground: '{colors.card}'
  celebration-banner:
    background: '{colors.accent}'
    radius: '{rounded.lg}'
  warning-line:
    background: '{colors.warning-bg}'
    foreground: '{colors.warning}'
    radius: '{rounded.md}'
  rate-pill:
    border: '{colors.border}'
    radius: '{rounded.full}'
  rate-pill-active:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
  stress-bar-active:
    fill: '{colors.primary}'
  person-dot-simon:
    fill: '{colors.person-simon}'
    size: 8px
  person-dot-carissa:
    fill: '{colors.person-carissa}'
    size: 8px
  focus-ring:
    color: '{colors.ring}'
    width: 2px
    offset: 2px
  sankey:
    renderer: 'ECharts canvas'
    linkOpacityLight: '0.32'
    linkOpacityDark: '0.42'
    nodeLabel: '{typography.chart-label}'
    valueLabel: '{typography.chart-value}'
    otherNode: '{colors.muted-foreground}'
    uncategorisedNode: '{colors.warning}'  # [ASSUMPTION] colours for Other / Uncategorised nodes
  progress-track:
    background: '{colors.border}'
    height: '{spacing.progress-track}'
    radius: '{rounded.full}'
  progress-fill:
    fill: '{colors.primary}'
  progress-fill-over:
    fill: '{colors.warning}'
  projection-line:
    stroke: '{colors.muted-foreground}'
    dash: '4 3'
  threshold-line:
    stroke: '{colors.warning}'
    dash: '2 2'
  banner-demo:
    background: '{colors.warning-bg}'
    foreground: '{colors.warning}'
  banner-offline:
    background: '{colors.card}'
    border: '{colors.border}'
    foreground: '{colors.foreground}'
  confidence-meter:
    track: '{colors.border}'
    fill: '{colors.primary}'
    width: 42px
    height: 6px
    radius: '{rounded.full}'
  loan-chart:
    actual: '{colors.primary}'
    actualWidth: 2.25px
    projected: '{colors.muted-foreground}'
    projectedDash: '4 3'
    withExtras: '{colors.foreground}'
    withExtrasWidth: 1.25px
  checkbox-checked:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
  auth-card:
    background: '{colors.card}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
    width: '{spacing.auth-card-width}'
---

> **Spines win.** This file and `EXPERIENCE.md` win on any conflict with a mock, wireframe or import in `mockups/`, `wireframes/` or `imports/`.
>
> **Key-screen mocks:** [mockups/index.html](mockups/index.html) (19 `key-*.html` screens, every information-architecture (IA) surface; each is also linked at the section it informs). Rules marked **(from mock)**, or with Source **Mock** or **Mixed** in § Components, were lifted from these mocks where the spine was silent; they are committed, not assumptions.
>
> **Visual references:** [mockups/direction-calm-cheeky.html](mockups/direction-calm-cheeky.html) (locked direction: Cash flow hero, Home buying glimpse and planner, empty state) · [mockups/color-themes-1.html](mockups/color-themes-1.html) (all six themes, light and dark, with contrast notes) · [imports/inspiration-sharkfin.webp](imports/inspiration-sharkfin.webp) · [imports/inspiration-smartspend.webp](imports/inspiration-smartspend.webp). The earlier and rejected directions are listed in `EXPERIENCE.md` § Inspiration & Anti-patterns.

## Brand & Style

Pangolin is a tidy notebook, written by a mate who's good with money. Simon and Carissa sit down with it every month or two to see where the money went and plan what's next (a home, mostly). It should feel calm enough for numbers and fun enough that they want to open it.

The locked direction is **Calm + Cheeky**, a merge of two earlier directions described in `EXPERIENCE.md` § Inspiration & Anti-patterns. The layout, density, type scale and quiet single accent of Direction A (Calm) carry all the information. The personality of Direction C (Cheeky) rides on top as copy, a slim confetti banner when everything is sorted, a winking pangolin guarding secrets, cheeky tooltips and the "Biggest little leaks" row. The numbers stay the star.

UI system: **shadcn/ui, new-york style, Tailwind 4, CSS variables, lucide icons** (per `apps/web/components.json`). Tokens above extend shadcn's semantic names; unlisted shadcn tokens and components inherit defaults. This file replaces the placeholder tokens in `apps/web/src/styles.css`.

**Mascot.** A small pangolin, drawn inline as SVG (no image assets; strict CSP). It appears in exactly these places:

| Where | What it does |
|---|---|
| Sidebar logo | Static, beside the "Pangolin" wordmark |
| Page header greeting | Small, beside "G'day, Simon" |
| Empty states | Curious pose, beside the headline |
| Celebrations | "Small victory roll" in the celebration banner |
| Hidden-name rows | Winking, guarding the secret |

Its scales use `{colors.mascot-scale-1}` / `{colors.mascot-scale-2}` (primary tints, so it follows the theme); eyes and claws use `{colors.mascot-ink}`. It never appears in errors, security or re-auth surfaces, money warnings (over budget, goal shortfall, large withdrawal, low balance), the Cover an expense sheet or charts; it never animates when reduced motion is on.

## Colors

Every theme maps onto the same token names, so components never know which theme is active. Default is **Clay & Linen** (warm and earthy: a slow Sunday arvo in a sun-baked courtyard, terracotta pots and linen), shown in the frontmatter; light-mode keys have no suffix, and dark-mode keys end in `-dark`.

- **Background / card / foreground / muted-foreground / border** — the warm canvas, raised card, ink, secondary text and hairlines. Cards are distinguished from the canvas by tone and a 1px border, not shadow.
- **Primary** — the single accent. Primary buttons (one per page; § Components › Button), active nav text, the "Kept" KPI figure, the selected rate pill, the active stress bar, links. Not used for money-in/out meaning.
- **Accent ("tint")** — primary at 10% (light) / 16% (dark) over card. Active nav background, hidden-name rows, celebration banner. Text on accent uses only `{colors.primary}` or `{colors.foreground}`.
- **Money in / money out** — positive and negative amounts, Money in / Money out KPI figures. Always paired with a sign (`+` / `−`) so meaning is never colour-only.
- **Warning / warning-bg** — the gentle "look at this" colour: duplicate flags, Needs review count badge, stale-data notes, rate-stress callouts, **over-budget bar fill**, **goal shortfall** (not money-out red), **large withdrawal** items, the **Protected warning** and **Left to cover** in Cover an expense, **low-balance** threshold and warning on Forecast, Uncategorised Sankey node, demo banner.
- **Destructive** — [ASSUMPTION] reuses money-out red for delete/reset confirmations; no separate value was rendered.
- **Person colours** — Simon and Carissa each own a colour, used for person dots on rows, on income nodes and income bar rows ("Simon's pay", "Carissa's pay", and rent from a property in its owner's colour) and on Partner pending chips. Interest and other income use `{colors.muted-foreground}`. Both pass 4.5:1 against card in every theme.
- **Ring** — the focus ring, drawn 2px with a 2px `{colors.background}` gap. At least 3:1 against background in every theme (see the contrast table).
- **Chart ramp (`{colors.chart-1}`…`{colors.chart-9}`)** — nine categorical colours for Sankey nodes and links, profit-and-loss (P&L) squares and category bars. The nine largest expense groups in the viewed period take slots 1–9 in descending amount order (a property's costs node, for example "35 Hawthorne St costs", is an expense group and takes its slot like any other, plus a house icon); the rest fold into an expandable **Other** node in `{components.sankey.otherNode}`; **Uncategorised** uses `{components.sankey.uncategorisedNode}`. Sankey nodes are labelled, so ramp colours only need to differ from each other: light-mode ramp contrast against card is 1.69–2.36:1 (accepted compromise, mitigated by labels and table equivalents); dark-mode is at least 5.6:1.

Avoid: a second accent, gradients on surfaces, colour as the only carrier of meaning, red for "spending" in general (money-out is for amounts, not decoration).

### Theme sets

**Machine source.** The frontmatter holds the default theme (Clay & Linen). The two core tables and the chart-ramp table below are the machine source for the other five: row = token name, column = theme, light and dark tables separate. The generator emits one `[data-theme="<slug>"]` block per theme and mode (`clay-linen`, `harbour-morning`, `fern-gully`, `galah-party`, `gelato-bar`, `black-opal`), then fills the remaining shadcn tokens per the "Derived per theme" paragraph below.

Six themes ship, each light and dark, chosen per person in Settings (light / dark / system). Same token names; values below are exact hex from [mockups/color-themes-1.html](mockups/color-themes-1.html) (every theme in light and dark, with contrast notes). `accent` = the mock's `--tint`, `warning-bg` = `--warnbg`, `primary-foreground` = `--onprimary`, `ring` = `--focus`.

**Implementation.** Theme switching is a class/attribute on the root element, with every token set in the compiled stylesheet (the CSP forbids inline styles). Charts re-read tokens on theme change (ECharts re-inits with the new ramp).

**Core tokens — light**

| Token | Clay & Linen | Harbour Morning | Fern Gully | Galah Party | Gelato Bar | Black Opal |
|---|---|---|---|---|---|---|
| background | #F6EFE6 | #F3F6F9 | #F2F5EE | #FAF7F8 | #F8F5FC | #F4F1EC |
| card | #FFFAF3 | #FFFFFF | #FCFDF9 | #FFFFFF | #FFFFFF | #FFFDF9 |
| foreground | #2A1F17 | #0E1A26 | #18261B | #1A1020 | #231C33 | #1A1722 |
| muted-foreground | #6A594B | #526070 | #526454 | #5E5367 | #625975 | #5D5765 |
| border | #E3D6C5 | #D8E0E8 | #D7E0D2 | #E8DEE6 | #E6E0F0 | #E2DCD3 |
| primary | #A3441D | #0A5CBD | #2B7446 | #C11574 | #6A4FCF | #0D6669 |
| primary-foreground | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF |
| ring | #B85A1E | #2F7FE6 | #3F9A5A | #E0337A | #8B70F0 | #138A8E |
| accent | #F6E8DE | #E6EFF8 | #E7EFE7 | #F9E8F1 | #F0EDFA | #E7EEEB |
| money-in | #3D6B2D | #0A7457 | #186A63 | #00784F | #1F7556 | #187244 |
| money-out | #A3283A | #BE2F48 | #AE3644 | #C8291D | #B3385B | #A3213F |
| warning | #8A5600 | #935600 | #875E00 | #8A5B00 | #855A00 | #855600 |
| warning-bg | #F0E5D3 | #F1E9DE | #EDE8D9 | #F0EADE | #EFEADE | #EFE7D9 |
| person-simon | #2C6681 | #0D7482 | #2F6690 | #155EEF | #2F70B4 | #2B4FA8 |
| person-carissa | #9C4277 | #BC4279 | #A3457A | #7A2ECC | #AF4577 | #8A2E8F |
| mascot-scale-1 / -2 | #BD785C / #D1A28E | #4F8ACF / #84AEDE | #669B7A / #95BAA2 | #D2579B / #E08ABA | #9480DC / #B4A7E7 | #519193 / #86B2B4 |

**Core tokens — dark**

| Token | Clay & Linen | Harbour Morning | Fern Gully | Galah Party | Gelato Bar | Black Opal |
|---|---|---|---|---|---|---|
| background | #1C1713 | #0B121B | #111A14 | #120B16 | #19152A | #0D0E14 |
| card | #26201A | #121C28 | #18241C | #1D1322 | #221D36 | #161722 |
| foreground | #F3E9DD | #E5EDF5 | #E4EEE3 | #F8EEF6 | #EEEAF8 | #ECE8F2 |
| muted-foreground | #B5A391 | #95A5B6 | #9DB09E | #B8A7BF | #ABA3C2 | #A49FB3 |
| border | #3E342A | #233244 | #2A3A2E | #3A2A40 | #362F4E | #2A2B3A |
| primary | #E58457 | #5EA6FF | #6CC48A | #FF4FA3 | #B6A2FF | #35C2C0 |
| primary-foreground | #1C1713 | #0B121B | #0F1A12 | #120B16 | #19152A | #0D0E14 |
| ring | #F0A070 | #8CC0FF | #8EE0A8 | #FF8CC4 | #CDBEFF | #6FE0DC |
| accent | #453024 | #1E324A | #253E2E | #411D37 | #3A3256 | #1B323B |
| money-in | #94C47E | #4FD1A5 | #5CC7B8 | #3CE0A0 | #7FE0BC | #4FD08A |
| money-out | #F28E8E | #FF7A8E | #FF8A8F | #FF7062 | #FF9AB5 | #FF6F8F |
| warning | #E6B455 | #F2B84B | #E8C060 | #FFC53D | #F5CE6B | #F2B640 |
| warning-bg | #493B25 | #3A382E | #3D4028 | #463327 | #483D40 | #3E3427 |
| person-simon | #7DB7D3 | #4CC9D6 | #7FB2E0 | #5B9BFF | #8EC3F5 | #7C9BFF |
| person-carissa | #E39BC6 | #F08DBA | #E79AC6 | #B98CFF | #F5A3CA | #D58AF0 |
| mascot-scale-1 / -2 | #ECA686 / #F2C2AB | #8BBFFF / #AED2FF | #95D5AB / #B6E2C4 | #FF80BD / #FFA7D1 | #CABCFF / #DAD0FF | #6ED3D2 / #9AE0E0 |

Derived per theme as in Clay & Linen: `card-foreground` / `popover-foreground` / `secondary-foreground` / `sidebar-foreground` = foreground; `popover` = card; `muted`, `secondary` and `sidebar` = background [ASSUMPTION]; `input` / `sidebar-border` = border; `accent-foreground` / `sidebar-primary` / `sidebar-accent-foreground` = primary; `sidebar-accent` = accent; `destructive` = money-out [ASSUMPTION]; `destructive-foreground` / `sidebar-primary-foreground` = primary-foreground. No shadcn token falls back to its neutral default.

**Chart ramp (`chart-1`…`chart-9`)**

| Theme · mode | chart-1 | chart-2 | chart-3 | chart-4 | chart-5 | chart-6 | chart-7 | chart-8 | chart-9 |
|---|---|---|---|---|---|---|---|---|---|
| Clay & Linen · light | #6F8A3D | #B5562B | #D9A13B | #2E8C88 | #C97B63 | #8A5A7A | #7E6A4F | #4F5D85 | #A3B18A |
| Clay & Linen · dark | #9DBA62 | #E07F52 | #EBC066 | #6FB3B5 | #E3A38E | #C08AB0 | #B19C7E | #B3B8D8 | #B7C9A8 |
| Harbour Morning · light | #0A5FC2 | #1E3A6E | #14A3B8 | #E2735A | #6B5CD6 | #2E9E7A | #8394AB | #D6A73A | #E58FB0 |
| Harbour Morning · dark | #5EA6FF | #8196C8 | #3CC7DB | #FF9478 | #9C8FFF | #4FC79E | #A6B3C4 | #F2C55C | #F5A9C6 |
| Fern Gully · light | #2E7A4B | #8B6B4A | #7FA650 | #8E5BB5 | #D06A4E | #E28FA6 | #4E8F8A | #C9A227 | #5E7FB0 |
| Fern Gully · dark | #6CC48A | #BE9B78 | #A8CF72 | #B98EE0 | #F09378 | #F4AFC0 | #4FA89E | #E6C553 | #8FAEE0 |
| Galah Party · light | #C11574 | #155EEF | #00A389 | #F79009 | #7A5AF8 | #12B76A | #854D0E | #0BA5EC | #F04438 |
| Galah Party · dark | #FF4FA3 | #5B9BFF | #2EE6C4 | #FFA43A | #A48BFF | #8BE04B | #FFD84D | #4CC7FF | #FF6B5E |
| Gelato Bar · light | #A08CF0 | #F59E86 | #6CC6A6 | #EBC352 | #7FB8EE | #F28DB8 | #A8CC6A | #8E9AAF | #E3B5F2 |
| Gelato Bar · dark | #A08CF0 | #F59E86 | #6CC6A6 | #EBC352 | #7FB8EE | #F28DB8 | #A8CC6A | #8E9AAF | #E3B5F2 |
| Black Opal · light | #0E6B6E | #2B4FA8 | #1B8A55 | #8A2E8F | #B8325A | #E0A526 | #D46A3C | #3E9DB8 | #D4869C |
| Black Opal · dark | #35C2C0 | #6F8FFF | #3FCB7F | #C77BE0 | #F2617F | #F2B640 | #FF8A54 | #9FB4FF | #F0A6BA |

The theme mock labels the slots with category names (1 Savings, 2 Housing, 3 Groceries, 4 Travel, 5 Eating out, 6 Lifestyle, 7 Transport, 8 Utilities, 9 Health). Those names are illustrative only: slots are assigned by amount, largest expense group first (§ Colors).

**Contrast (WCAG 2.x, from the mock's notes).** All text roles (foreground, muted-foreground, primary, money-in, money-out, warning) are at least 4.5:1 on background *and* card in both modes, in every theme.

| Theme · mode | fg (bg/card) | muted (bg/card) | primary | primary-foreground | ring against bg | warning on warning-bg | primary on accent | ramp min against card | closest ramp pair (ΔE OKLab) |
|---|---|---|---|---|---|---|---|---|---|
| Clay · light | 14.1 / 15.5 | 5.86 / 6.43 | 5.4 | 6.2 | 4.1 | 4.94 | 5.15 | 2.19 | chart-6 / chart-7 9.4 |
| Clay · dark | 14.8 / 13.4 | 7.29 / 6.61 | 6.0 | 6.6 | 8.4 | 5.70 | 4.57 | 5.62 | chart-5 / chart-7 8.6 |
| Harbour · light | 16.2 / 17.6 | 5.93 / 6.43 | 5.9 | 6.4 | 3.7 | 4.89 | 5.51 | 2.22 | chart-3 / chart-7 8.8 |
| Harbour · dark | 15.9 / 14.5 | 7.47 / 6.82 | 6.9 | 7.5 | 9.9 | 6.57 | 5.20 | 5.83 | chart-1 / chart-2 8.6 |
| Fern · light | 14.3 / 15.4 | 5.76 / 6.21 | 5.2 | 5.7 | 3.2 | 4.72 | 4.85 | 2.36 | chart-7 / chart-9 8.8 |
| Fern · dark | 14.9 / 13.5 | 7.73 / 6.99 | 7.6 | 8.4 | 11.3 | 6.19 | 5.48 | 5.68 | chart-1 / chart-3 7.9 |
| Galah · light | 17.3 / 18.4 | 6.78 / 7.22 | 5.4 | 5.8 | 4.0 | 4.90 | 4.92 | 2.35 | chart-3 / chart-6 8.4 |
| Galah · dark | 17.1 / 15.9 | 8.59 / 7.97 | 5.9 | 6.4 | 9.0 | 7.55 | 4.74 | 5.90 | chart-2 / chart-5 9.3 |
| Gelato · light | 15.1 / 16.3 | 6.07 / 6.55 | 5.4 | 5.8 | 3.4 | 5.06 | 5.01 | 1.69 | chart-4 / chart-7 9.1 |
| Gelato · dark | 15.0 / 13.7 | 7.40 / 6.75 | 7.4 | 8.1 | 10.5 | 6.90 | 5.42 | 5.70 | chart-4 / chart-7 9.1 |
| Opal · light | 15.7 / 17.4 | 6.18 / 6.85 | 6.0 | 6.7 | 3.7 | 5.14 | 5.71 | 2.16 | chart-1 / chart-3 11.7 |
| Opal · dark | 16.0 / 14.7 | 7.51 / 6.94 | 8.2 | 8.8 | 12.3 | 6.69 | 6.15 | 5.76 | chart-1 / chart-3 10.2 |

Closest pairs to watch, taken from the last column (the lowest ΔE values in either mode): Fern Gully dark chart-1 / chart-3 (7.9), Galah Party light chart-3 / chart-6 (8.4), then Clay & Linen dark chart-5 / chart-7 and Harbour Morning dark chart-1 / chart-2 (both 8.6).

## Typography

One family, the platform system UI stack (already `system-ui` in `apps/web`; no web fonts under the strict CSP). Headings use Direction A's semibold weight (600), not Direction C's rounded 800.

| Role | Token | Used for |
|---|---|---|
| Page title | `{typography.page-title}` | "Cash flow", "How much can we borrow?" |
| Greeting | `{typography.greeting}` | "G'day, Simon" above the page title |
| Card title | `{typography.card-title}` | "Where the money went", "Biggest little leaks" |
| Body | `{typography.body}` | Rows, paragraphs, controls |
| Body small / caption | `{typography.body-sm}` / `{typography.caption}` | Sub-lines, KPI notes, dates, chips |
| Label caps | `{typography.label-caps}` | Rare section labels only |
| KPI figure | `{typography.figure-kpi}` | Money in / out / Kept / Savings rate; Net worth / Assets / Liabilities |
| Stat figure | `{typography.figure-stat}` | Repayments, Left for actual life, leak totals, budget spent, goal balance, empty-state headline |
| Wordmark | `{typography.wordmark}` | "Pangolin" beside the sidebar logo |
| Glimpse figure | `{typography.figure-glimpse}` | Home buying card on Cash flow |
| Hero figure | `{typography.figure-hero}` | The borrowing-power number on the planner |
| Chart label / value | `{typography.chart-label}` / `{typography.chart-value}` | Sankey node name, amount + percentage |

All figures use `font-variant-numeric: tabular-nums`. Money is formatted en-AU (`$41,661.40`, `−$142.85` with a true minus). Big headline numbers may drop cents (`$780,000`).

## Layout & Spacing

Tailwind's 4px scale, inherited. Named layout tokens come from the locked mock.

- **Breakpoints:** [ASSUMPTION] Tailwind defaults; sidebar at `md` (768px) and up, bottom tabs below `md`.
- **Desktop shell:** fixed left sidebar `{spacing.sidebar-width}` (logo, nav, Planning group, person footer "Simon · Signed in with passkey"); main column padded `{spacing.page-padding-top}` top, `{spacing.page-padding-x}` sides.
- **Page header:** on every view (anatomy in § Components › Page header); the date-range control appears only where it filters.
- **Gaps** `{spacing.grid-gap}` everywhere. Multi-column rows in the table below use fr ratios at `lg` and up; each stacks to one column below `lg`.

| View | Desktop order (top → bottom) | Mock (what it shows) |
|---|---|---|
| Cash flow | 4-up KPI row → share line (+ toggle) → full-width Sankey card → two-column Income / Expense bar lists → two-column latest transactions (1.25fr) / Home buying glimpse (1fr) → 4-up Biggest little leaks | [key-cash-flow.html](mockups/key-cash-flow.html) (desktop: KPIs, Sankey, bar lists, glimpse, leaks) · [key-cash-flow-phone.html](mockups/key-cash-flow-phone.html) (phone header, P&L table, tab bar) |
| Net worth (from mock) | 3-up KPI row → trend card → two-column Assets / Liabilities lists → Forecast link card | [key-net-worth.html](mockups/key-net-worth.html) (KPIs, trend, grouped assets and liabilities) |
| Spending | share line → two-column Income / Expense bar lists → spending category bars → leaks | [key-spending.html](mockups/key-spending.html) (bar lists, category bars with flexible tags, leaks) |
| Transactions | filters row → summary line (or bulk select bar) → date-grouped rows | [key-transactions.html](mockups/key-transactions.html) (filters, selection, owner and partner hidden-name rows) |
| Needs review | summary line → one card per item | [key-needs-review.html](mockups/key-needs-review.html) (every item kind, bulk AI accept, set-aside rows with an AI-read rate change) |
| Accounts (from mock) | stale warning line (if any) → one "Accounts" card (account rows by type, "Add loan by hand" top-right) → "Properties" card, one row per property linking to Property detail | [key-accounts.html](mockups/key-accounts.html) (grouped account rows, stale row, Properties card) |
| Loan detail (from mock) | "← Accounts" back link → header line → progress line → estimate note → 4-up KPI tiles → row: Balance over time (1.6fr) / stacked Where your repayments went + Who owns this loan (1fr) → row: What if I pay extra? / Your offset (1fr 1fr) → Property section card | [key-loan-detail.html](mockups/key-loan-detail.html) (partway through a what-if: extra repayments, a bigger offset, property section) |
| Property detail (from mock) | "← Accounts" back link → header line → 4-up KPI tiles (Value · Equity · Net cash this FY · Net cash last FY) → row: Rent in, costs out chart (1.6fr) / stacked Gearing + Who owns it (1fr) → row: Rent and costs by financial year table (1.2fr) / Value and loan card with the linked-loan row (1fr) | [key-property-detail.html](mockups/key-property-detail.html) (net cash chart and FY table, gearing, ownership, value and loan) |
| Budgets / Goals | summary line with the entry button at its right ("New budget" / "Add a goal", `{components.button-secondary}` with a plus icon) (from mock); Goals adds a **Cover an expense** `{components.button-secondary}` beside Add a goal → Goals only: shared-savings stage card with 3 stat tiles (In shared savings · Set aside for goals · Buffer) and the shortfall line → two-column card grid | [key-budgets.html](mockups/key-budgets.html) (over, on track, projected over, rollover; editor sheet) · [key-goals.html](mockups/key-goals.html) (stage card; kind badges; shortfall line with Cover it) · [key-cover-expense.html](mockups/key-cover-expense.html) (Cover an expense sheet, desktop) · [key-cover-expense-phone.html](mockups/key-cover-expense-phone.html) (bottom sheet on phone) |
| Forecast | segmented control (Cash flow · Net worth) → full-width chart card (horizon control in the card header) → assumption chips → table disclosure | [key-forecast.html](mockups/key-forecast.html) (per-account cash flow with a dip, net worth range) |
| Home buying (from mock) | data-scope line → row: result (1.1fr) / "What's left if rates misbehave" (1fr) → Lender-style estimate card (assumption chips, then 3 stat tiles: Simple calculator · Lender-style estimate · Debt-to-income) → Scenarios card (A/B/C + dashed "Add scenario" tile) → row: "What we're working with" inputs / Repayment calculator → row: Properties you already own / Saved plans | [key-home-buying.html](mockups/key-home-buying.html) (full planner, desktop) · [key-home-buying-phone.html](mockups/key-home-buying-phone.html) (stacked planner, sliders, scenarios) |
| Settings (from mock) | side menu (`{spacing.settings-menu-width}`, sticky, "On this page" label) beside one long column of settings cards, column max 640px | [key-settings.html](mockups/key-settings.html) (side menu, theme picker, security, failed backup) |
| Sign-in (from mock) | centred auth card on the background, no sidebar | [key-sign-in.html](mockups/key-sign-in.html) (passkey, password + TOTP, recovery, re-auth dialog) |

- **Phone (from mock):** single column, `{spacing.margin-phone}` side gutters, bottom tab bar; header per § Components › Phone header. KPIs 2-up. Planner cards stack in desktop order; scenarios stack vertically.

## Elevation & Depth

Flat by default, as in the mock. Cards and KPI tiles sit on `{colors.card}` with a 1px `{colors.border}` (`{components.card}`); hierarchy comes from tone and layout, not shadow. Exceptions: the active segment in a segmented control lifts with `{components.segmented-control.activeShadow}`; popovers, dialogs and toasts keep shadcn's default shadow. Nested panels (stat tiles, leak tiles) step back to `{colors.background}` rather than forward.

## Shapes

Soft and friendly without being bubbly (Direction C's 20px radius was not chosen). This list is the single source for radius usage.

- `{rounded.sm}` 6px — category chips, tags, assumption chips.
- `{rounded.md}` 8px — buttons, inputs, nav items, segmented control, warning line.
- `{rounded.DEFAULT}` 10px — stat tiles, leak tiles, hidden-name row and other inner panels.
- `{rounded.lg}` 12px — cards, KPI tiles, popovers, dialogs, celebration banner. Set shadcn `--radius` to this.
- `{rounded.full}` — rate-scenario pills, count badges, person dots, light/dark/system toggle, progress tracks.

## Components

shadcn components used as-is with the tokens above: Button (`{components.button-primary}`, `{components.button-secondary}`), Card (`{components.card}`), Dialog, AlertDialog, Popover, Sheet, Tabs, ToggleGroup, Select, Input, Checkbox, Switch, Slider, Table, Tooltip, Toast (Sonner, presentational: default shadcn look on the theme tokens), Skeleton, Badge, Separator, DropdownMenu, Calendar. Names below are canonical and match `EXPERIENCE.md` § Component Patterns.

Conventions in this section: "muted" text means `{colors.muted-foreground}` (`{colors.muted}` is a fill, never text); "in caption" means `{typography.caption}`. **Source** says where each spec comes from: **Mock** (lifted from the linked mock), **Spine** (written in the spine; the linked mock illustrates it), **Mixed** (spine rules plus rules lifted from the linked mock), or **Spine only** (no mock shows it).

### Shell

| Component | Visual spec | Source |
|---|---|---|
| **App sidebar** | `{colors.sidebar}` background, right border. Logo row: mascot + "Pangolin" in `{typography.wordmark}`. Nav items `{components.nav-item}` with lucide icons; active `{components.nav-item-active}`. Order: Cash flow, Net worth, Spending, Transactions, Needs review, Accounts; hairline; Planning group (Budgets, Goals, Home buying, Forecast); Settings at the bottom. Footer: person dot + name + "Signed in with passkey", then a quiet "Sign out" link in muted text. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Nav count badge** | `{components.nav-badge}` on Needs review ("7") and Transactions (uncategorised count). At zero, a small check on an `{colors.accent}` disc replaces it. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Bottom tab bar** (phone) | Five tabs: Cash flow · Transactions · Needs review · Planning · More; lucide icon above a caption label. Active tab in `{colors.primary}`; badge as above. | Spine · [key-cash-flow-phone](mockups/key-cash-flow-phone.html) |
| **Page header** | Greeting row (mascot + "G'day, Simon" in `{typography.greeting}`), title in `{typography.page-title}`, freshness sub-line in muted text with import provenance ("imported up to 30 Sep from CommBank CSV, 9:14 pm"), prefixed with the range where one applies ("Jul – Sep 2026 · imported up to 30 Sep…"). Right: date-range control (only where it filters) + `{components.button-primary}` "Import". Partner pending chip, when shown, sits under the sub-line. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Phone header** | Greeting row; title in `{typography.page-title}` with a compact `{components.button-primary}` "Import" (icon + label) right-aligned on the title row; freshness sub-line; date-range control (where it filters) stacked below as chevrons + label above the presets; partner chip. | Mock · [key-cash-flow-phone](mockups/key-cash-flow-phone.html) |
| **Date-range control** | Previous/next chevrons around the range label, plus a segmented control: Quarter · FY to date · Custom. Rendered only on Cash flow, Spending, Transactions and Account detail. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Segmented control** | `{components.segmented-control}`. Used for Groups/Categories/Both, Sankey/Profit & loss, share toggle, Forecast Cash flow/Net worth, bar-list breakdowns. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Share toggle** | Segmented control, two options: "My share" · "Everything I can see". Sits at the right end of the apportioned share line. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Apportioned share line** | One line under the KPI row in `{typography.body-sm}`, muted: person dot + "Your share: $X of $Y shared (54%)". | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Settings section menu** | Sticky column `{spacing.settings-menu-width}` wide, 28px from the settings column: an "On this page" `{typography.label-caps}` label, then section links on a 1px `{colors.border}` left rail, each in `{typography.body-sm}` muted. Active (section in view): 600-weight `{colors.primary}` text, 2px `{colors.primary}` left bar, `{colors.accent}` fill, right corners `{rounded.sm}`. Below `md`: a horizontally scrolling row of `{components.category-chip}` links under the title [ASSUMPTION]. | Mock · [key-settings](mockups/key-settings.html) |
| **Demo banner** | Full-width strip above the page header, `{components.banner-demo}`, info glyph + text. Not dismissible. | Spine only |
| **Offline banner** | Full-width strip, `{components.banner-offline}`, wifi-off glyph + text. | Spine only |

### Reports

| Component | Visual spec | Source |
|---|---|---|
| **KPI tile** | `{components.kpi-tile}`. Label (in caption, muted), figure (`{typography.figure-kpi}`), cheeky note (in caption, muted). Money in figure `{components.amount-in}`, Money out `{components.amount-out}`, Kept `{colors.primary}`. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Sankey card** | ECharts `series-sankey`, canvas renderer, `richText` tooltips (CSP). Plain two-line labels: name in `{typography.chart-label}`, amount · percentage in `{typography.chart-value}` muted (no pills). Node fills per § Colors (person colours for income, ramp slots for expense groups, then Other and Uncategorised). Property rent and cost nodes carry a lucide house icon before the name; links at `{components.sankey.linkOpacityLight}` / `{components.sankey.linkOpacityDark}`. Footer note in caption above a hairline. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **P&L table** | shadcn Table: Category · % of income · Amount, Income and Expenses sections, groups expandable, colour square per category from the ramp (SharkFin phone pattern). | Spine · [key-cash-flow-phone](mockups/key-cash-flow-phone.html) |
| **Income / expense bar lists** | Two cards side by side, on Cash flow (below the Sankey) and on Spending. Card header: title, period total (`+$47,901.40 this quarter`) and a segmented control (Income: Category · Merchant; Expenses: Group · Category · Merchant). Each row: colour square, name (house icon for property rows), horizontal bar (`{components.progress-track}`), amount right. Fill = the row's Sankey colour, per § Colors. | Spine · [key-cash-flow](mockups/key-cash-flow.html), [key-spending](mockups/key-spending.html) |
| **Spending category bars** | Row per category: name + "flexible" tag where applicable, bar on `{components.progress-track}` in the ramp colour, amount, change against the previous period in caption ("↑ $120"). | Spine · [key-spending](mockups/key-spending.html) |
| **Leak tile** | Stat tile with an icon + title row ("Coffee, 41 times"), total, note ("Eating out · about $5 a weekday"). | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Net worth view** | KPI tiles (Net worth in `{colors.primary}`, Assets, Liabilities). Trend card: ECharts line, net worth solid `{colors.primary}`. Assets and Liabilities cards list account rows by type with group subtotals: assets grouped Cash, Savings, Property, Investments, Super; liabilities grouped Loans, Cards. | Spine · [key-net-worth](mockups/key-net-worth.html) |

### Transactions & review

| Component | Visual spec | Source |
|---|---|---|
| **Transaction filters** | Row above the list: search Input (lucide search icon, placeholder "Search merchant, notes, category or amount") with a `{components.button-secondary}` "Import" at its right, then filter chips (All · Needs review · Uncategorised · Transfers) as `{components.category-chip}` toggles (selected: `{colors.accent}` fill, `{colors.primary}` text), then Type / Account / Category Selects. | Mixed · [key-transactions](mockups/key-transactions.html) |
| **Transactions summary line** | `{typography.body-sm}` muted: "134 transactions · $8,039.95 in · $7,028.79 out · 2 need review"; amounts in `{components.amount-in}` / `{components.amount-out}`. | Spine · [key-transactions](mockups/key-transactions.html) |
| **Date-group header** | Date in `{typography.label-caps}`, day's net subtotal right-aligned tabular, hairline below. | Spine · [key-transactions](mockups/key-transactions.html) |
| **Transaction row** | Checkbox column (desktop only) · date (muted, `{spacing.date-column}`) · merchant logo or initial disc (24px, `{colors.accent}` disc with `{colors.primary}` initial) · person dot + payee + category chip + inline tags (for example "Impulse", `{rounded.sm}`, muted) · Account column (desktop only) · amount right-aligned tabular in `{components.amount-in}` / `{components.amount-out}`. Hairline between rows. Selected: checkbox filled `{components.checkbox-checked}`; the row itself takes no fill (`{colors.accent}` stays reserved for hidden-name rows); header checkbox shows a dash when some rows are selected. | Mixed · [key-transactions](mockups/key-transactions.html) |
| **Bulk select bar** | Appears in place of the summary line when at least one row is selected: "3 selected" + Categorise · Tag · Mark shared buttons (`{components.button-secondary}`) + Clear. `{colors.accent}` background, `{rounded.md}`. | Spine · [key-transactions](mockups/key-transactions.html) |
| **Hidden-name row** | `{components.hidden-name-row}`. Partner's view: winking mascot, "Hidden until 12 Mar 2027" with a "Little secret" tag, and beneath it in caption the wink line (the cheeky one-liner from `EXPERIENCE.md` § Voice and Tone). Owner's view: same tinted row and winking mascot, the real payee + category chip, a lock + "Hidden from Carissa until 12 Mar 2027" tag (`{colors.primary}` on `{colors.card}`), caption "Carissa sees 'Hidden until 12 Mar 2027'. Your secret's safe. Lifts on its own on the day." Amount, date, category stay visible in both. | Mixed · [key-transactions](mockups/key-transactions.html) |
| **Category chip** | `{components.category-chip}`. Idle: border + muted text. Editable (hover/focus): `{colors.foreground}` text and a chevron. Selected (filter): `{colors.accent}` fill, `{colors.primary}` text. Uncategorised: `{colors.warning}` text on `{colors.warning-bg}`. | Spine · [key-transactions](mockups/key-transactions.html) |
| **Transaction sheet** | shadcn Sheet from the right (desktop) / bottom (phone) [ASSUMPTION]. Header: payee, amount, date, account. Split editor as a compact table: amount input (tabular), category Select, beneficiary, activity, tags. Remaining amount line in `{colors.warning}` until zero, then muted. | Spine only |
| **Needs review item** | See below. | Mixed · [key-needs-review](mockups/key-needs-review.html) |
| **Partner pending chip** | Person dot + "Carissa: 12 left" in caption on `{colors.background}`, `{rounded.full}`. | Spine · [key-needs-review](mockups/key-needs-review.html) |

#### Needs review item

- **Anatomy:** card per item: icon tile by kind, one-line summary + caption, the transaction row(s) inside, actions right-aligned (primary for the suggested action, secondary for the alternative, plain text button for Dismiss / Got it). A rule offer is a nested `{colors.accent}` strip ("Always do this?").
- **By kind:**
  - AI suggestion (from mock): a **confidence meter** after the summary, `{components.confidence-meter}` + caption "Fairly sure · 78%". Suggestions at 90% confidence or more are grouped into one card "N more we're very sure about" ("Very sure · 90%+"), each row pre-ticked with its % caption, one primary "Accept all" ("Accept both" for two).
  - Duplicate pair: the two rows as side-by-side `{colors.background}` panels with file provenance.
  - Transfer pair: both legs as rows, "Not a transfer" / "Yes, it's a transfer".
  - Import hand-off: file chip (name · rows) + account Select + Dismiss + primary Import.
  - Set-aside rows: list of raw lines (row number, raw text, reason in `{colors.warning}`), each with an editable fix; when AI has read a line, a nested `{colors.accent}` strip proposes the event ("Looks like a rate change to 6.49% from 1 Nov") with Confirm / Not that.
  - Over budget and goal shortfall: a `{colors.warning}` icon.
  - Large withdrawal: a `{colors.warning}` icon, with the withdrawal row inside; actions Cover it (primary) · It's for a goal · Take it from the buffer (only when the buffer covers it) · Not an expense (plain text button). Spine only until [key-needs-review](mockups/key-needs-review.html) shows it.
- **Source:** Mixed · [key-needs-review](mockups/key-needs-review.html).

### Planning

| Component | Visual spec | Source |
|---|---|---|
| **Budget card** | See below. | Mixed · [key-budgets](mockups/key-budgets.html) |
| **Budget editor** | shadcn Sheet: Select (category/group), segmented controls for scope and period, limit Input with the suggestion caption beneath in `{typography.body-sm}` muted, rollover Switch, `{components.button-primary}` Save. | Spine · [key-budgets](mockups/key-budgets.html) |
| **Goal card** | See below. | Mixed · [key-goals](mockups/key-goals.html) |
| **Goal editor** | shadcn Sheet (right on desktop, bottom on phone), as the Budget editor: name Input; pool segmented control (Shared / own name); target Input (tabular); kind ToggleGroup **Flexible · Protected** (selected item `{colors.accent}` fill, `{colors.primary}` text; Protected item carries the lucide shield icon), with the selected option's caption beneath in `{typography.body-sm}` muted; **Emergency fund** Switch, its disabled caption ("Shared savings already has one: Rainy day") in `{typography.body-sm}` muted; `{components.button-primary}` Save. | Spine only |
| **Goal kind badges** | shadcn Badge after the scope badge, always with text, `{rounded.sm}`, `{typography.caption}` 600-weight. **Protected:** outline (`{colors.border}`), `{colors.foreground}` text, lucide shield icon. **Emergency fund:** `{colors.accent}` fill, `{colors.primary}` text, lucide life-buoy icon [ASSUMPTION: icon]. Flexible shows no badge. Used on Goal cards, Goal editor and Cover an expense rows. | Spine only |
| **Cover an expense** | See below. | Spine · [key-cover-expense](mockups/key-cover-expense.html), [key-cover-expense-phone](mockups/key-cover-expense-phone.html) |
| **Forecast chart** | See below. | Mixed · [key-forecast](mockups/key-forecast.html) |
| **Assumption chips** | `{rounded.sm}` chips on `{colors.background}`; a passed check ("Survives a 3% rate jump") uses `{colors.accent}` with `{colors.primary}` text; a changed value shows a `{colors.primary}` dot. Shared by planner and Forecast. | Spine · [key-forecast](mockups/key-forecast.html), [key-home-buying](mockups/key-home-buying.html) |
| **Home buying glimpse** | Card: lead sentence, `{typography.figure-glimpse}` amount, sub-line ("and still have $3,506 a fortnight for actual life"), rate pills, two stat tiles (Repayments; Left for actual life, monthly), "Open planner →" link. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Planner result** | `{typography.figure-hero}` borrowing power (the lender-style estimate), "left to live on" sentence, deposit sub-line, rate slider with paired input, rate pills, stat tiles (Repayments monthly + fortnightly; Left for actual life monthly, figure in `{colors.primary}`). Recalculating: figures at 60% opacity. | Spine · [key-home-buying](mockups/key-home-buying.html) |
| **Simple vs lender-style** | Never two hero numbers. The Lender-style estimate card shows three stat tiles side by side: Simple calculator (figure in `{colors.foreground}`, caption "Income, spending and rate only"), Lender-style estimate (figure in `{colors.primary}`, caption "Used for the number above"), Debt-to-income ("5.1×"; the caption compares it with the lender's cap). | Mock · [key-home-buying](mockups/key-home-buying.html) |
| **Planner inputs** | "What we're working with" card: two-column grid of money Inputs; each label carries a source tag in caption — "from Pangolin" (`{colors.primary}`) or "typed" (muted); a caption beneath explains how derived figures were built. | Mock · [key-home-buying](mockups/key-home-buying.html) |
| **Rate stress bars** | Row per rate: rate · track (`{spacing.stress-track}`, `{rounded.full}`) · amount. Selected row bold with `{components.stress-bar-active}`; others in `{colors.border}`; the stress-test row (+3 percentage points) hatched. | Spine · [key-home-buying](mockups/key-home-buying.html) |
| **Rate pills** | `{components.rate-pill}`; selected `{components.rate-pill-active}`; "today" suffix in small text. | Spine · [key-home-buying](mockups/key-home-buying.html) |
| **Slider** (rate / offset / extra repayment) | shadcn Slider, track `{colors.border}`, range and thumb `{colors.primary}`, value in an adjacent input. | Spine · [key-home-buying-phone](mockups/key-home-buying-phone.html) |
| **Scenario compare** | Named scenario columns (A / B / C) as cards side by side: letter disc + name + edit pencil, rows Rate / Repayments / Left for actual life, caption with term and property choice; selected scenario outlined `{colors.primary}` with "Drives the number above"; a dashed "Add scenario · Three at most" tile fills the fourth column. | Mixed · [key-home-buying](mockups/key-home-buying.html) |
| **Property card** (planner) | Card: property name, value, loan balance, rent per month, ownership share ("Yours: 100%"), and a two-option segmented control "Use equity" / "Sell it". Sell shows a caption "after 2.5% selling costs and a CGT estimate — estimate, not tax advice". A property not shared-visible shows muted with a lock and "Not in shared plans". | Spine · [key-home-buying](mockups/key-home-buying.html) |
| **Ownership split input** | Two number inputs with person dots (Simon % / Carissa %), summing to 100; a quick 100 / 0 · 50 / 50 · 0 / 100 segmented control above. Used in loan and property setup. | Spine · [key-loan-detail](mockups/key-loan-detail.html) |
| **Saved plan row** | Name in `{typography.card-title}`, date and headline borrowing figure in `{typography.body-sm}` muted, open chevron. Reopened view puts the saved headline (borrow, repayment, left to live on) and today's recalculation in side-by-side stat tiles; "Some inputs are no longer shared" in a `{components.warning-line}` when inputs dropped out. | Spine · [key-home-buying](mockups/key-home-buying.html) |
| **Stat tile** | `{components.stat-tile}`: label in caption, `{typography.figure-stat}`, note in caption. Presentational. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |

#### Budget card

- **Anatomy:** `{components.card}`. Title row: category/group name in `{typography.card-title}`, scope badge (person dot + name, or "Shared"), period caption ("Fortnight to 17 Oct"). Figure: spent in `{typography.figure-stat}` + "of $400" muted. Mini chart (64px tall) below the bar.
- **Tokens:** bar is `{components.progress-track}` with `{components.progress-fill}`, a 2px pace tick in `{colors.foreground}` at today, and a projected-end segment hatched beyond the fill. Mini chart: cumulative spent solid `{colors.primary}`, projection to period end `{components.projection-line}`, limit as a `{colors.border}` horizontal rule.
- **States:** over budget: fill becomes `{components.progress-fill-over}`, plus a `{components.warning-line}` nudge.
- **Source:** Mixed · [key-budgets](mockups/key-budgets.html). Entry point placement: § Layout & Spacing (Budgets / Goals).

#### Goal card

- **Anatomy:** `{components.card}`. Name + scope badge, then the kind badge (`Badge`, outline, shield icon, "Protected") or the emergency-fund badge (`Badge`, `{colors.accent}` fill, "Emergency fund") per § Planning › Goal kind badges; badges sit after the scope badge and always carry text; edit pencil at the title row's right; stage tag (`{rounded.sm}`, muted); balance in `{typography.figure-stat}` + "of $60,000"; `{components.progress-track}` + `{components.progress-fill}`; arrival line in `{typography.body-sm}` ("At the current rate, you'll arrive by Mar 2027").
- **States:**
  - Shortfall: `{components.warning-line}` under the stage card's stat tiles, with **Cover it** as a `{components.button-secondary}` inside it, plus a plain-text **Move $50/fortnight from the buffer** when the active stage gives the buffer a share. The Buffer stat tile's note says which ("Gets 5% of each fortnight" / "No share of each fortnight comes here") (from mock).
  - Complete: `{colors.accent}` card fill + check.
- **Source:** Mixed · [key-goals](mockups/key-goals.html). Entry point placement: § Layout & Spacing (Budgets / Goals).

#### Cover an expense

- **Anatomy:** shadcn Sheet (right on desktop, bottom on phone). Header: amount in `{typography.figure-stat}`, label and pool in `{typography.body-sm}` muted, reason caption ("Large purchase" / "Shortfall"); at most one light line beneath. Section labels (Emergency fund · Flexible · Protected, in the reason's order) in `{typography.label-caps}`.
- **Rows:** name and badges (§ Planning › Goal kind badges), balance tabular, `Slider` (as § Planning › Slider) with an adjacent tabular amount input, and the arrival line in `{typography.body-sm}` muted (moved dates in `{colors.foreground}`). Hairline between rows.
- **Footer:** sticky; Left to cover (tabular; `{colors.warning}` when above $0, otherwise `{colors.foreground}`), a "Back to Pangolin's split" link in `{colors.primary}` once adjusted, and `{components.button-primary}` **Confirm cover** (the overlay's commit button), enabled when Left to cover is $0 or every eligible goal is at its maximum (Protected goals are not eligible while locked).
- **States:** Protected section collapsed and disabled (muted, sliders inert) until unlocked; when needed, a `{components.warning-line}` with a warning glyph names each Protected goal and its new arrival date, with **Use protected goals** as a `{components.button-secondary}` inside it, never `destructive` or money-out red. Can't cover it all: a `{components.warning-line}` above the footer ("Goals can cover $X of $Y. The rest stays with the buffer." / "…The rest stays flagged."), with Confirm cover enabled for the partial cover; unlocking Protected is optional. Recalculating: figures at 60% opacity.
- The mascot is absent.
- **Source:** Spine · [key-cover-expense](mockups/key-cover-expense.html) (desktop, both orders, protected warning, Left to cover) · [key-cover-expense-phone](mockups/key-cover-expense-phone.html) (bottom sheet).

#### Forecast chart

- **Anatomy:** ECharts line chart in a card; horizon segmented control in the card header.
- **Cash flow mode (from mock):** only transaction accounts are plotted (for example Everyday and Shared bills; savings, loans and cards are not), one line per account in its own ramp colour, actual history solid, projection in the same colour dashed `4 3`, a "Today" divider. The low-balance `{components.threshold-line}` is drawn only for the account that dips (all thresholds are listed in an assumption chip); the first dip is a `{colors.warning}` dot with label ("$140 · 12 Nov").
- **Net worth mode:** three projection lines (low / mid / high return) in `{colors.muted-foreground}` / `{colors.primary}` / `{colors.muted-foreground}`, mid bold.
- **Source:** Mixed · [key-forecast](mockups/key-forecast.html).

### Accounts & loans

| Component | Visual spec | Source |
|---|---|---|
| **Account row** | Rows sit in one "Accounts" card with "Add loan by hand" (`{components.button-secondary}`) at its top-right, grouped Cash · Savings · Cards · Loans under `{typography.label-caps}` group labels with a count. Row: institution initial disc · account name + type caption · owner person dot (or "Shared") · lock icon when private (owner only) · balance right tabular · freshness caption ("to 30 Sep"); stale freshness in `{colors.warning}`. Loans show balance in `{components.amount-out}` with a "15% repaid of $580,000" caption beneath; a stale row adds a small secondary "Import" button under its freshness caption; chevron at row end. | Mixed · [key-accounts](mockups/key-accounts.html) |
| **Property row** (Accounts) | House icon disc · address ("35 Hawthorne St, Geelong VIC") + type caption ("Investment property · rented") · labelled columns Value (with valuation month) · Loan (link in `{colors.primary}`) · Rent per month · owner dot + share ("Simon 100%") · chevron to Property detail. | Mock · [key-accounts](mockups/key-accounts.html) |
| **Loan detail** | See below. | Mixed · [key-loan-detail](mockups/key-loan-detail.html) |
| **Property section** (Loan detail) | `{components.card}` "The property behind it": house icon disc, property name + place + owner dot and share, then Value ("entered Jun 2026") · Net cash this FY (signed, per-month caption) · Gearing as three stat tiles, "View property →" link. Sub-line says rent and running costs come from imports and loan interest from entered statements. | Mock · [key-loan-detail](mockups/key-loan-detail.html) |
| **Property detail** | See below. | Mock · [key-property-detail](mockups/key-property-detail.html) |

#### Loan detail

- **Anatomy:** SmartSpend pattern ([imports/inspiration-smartspend.webp](imports/inspiration-smartspend.webp)); layout per § Layout & Spacing.
  - Header line in `{typography.body-sm}` muted: lender · loan type · nominal and effective rates · term · start date · ownership share.
  - Progress line "54% repaid · next $2,140 on 1 Nov" with `{components.progress-track}`.
  - Four KPI tiles: Still owed, Paid off, Interest paid, Interest still to pay.
  - "Balance over time": ECharts line per `{components.loan-chart}`.
  - "Where your repayments went": stacked bars for entered periods only, with an "Add from a statement" button.
  - "What if I pay extra?" card with a yearly-cap caption.
  - "Your offset" card: two stat tiles (Interest it saves, Time it saves) and a slider with a "today" tick.
  - "Who owns this loan" card: the Ownership split input.
- **Tokens:** Balance over time (from mock): actual solid `{colors.primary}`, projected dashed `{colors.muted-foreground}`, with extras thin `{colors.foreground}`; a dotted "Today" divider; payoff dates labelled at the zero line. Repayment bars: principal `{colors.primary}`, interest `{colors.muted-foreground}`.
- **Source:** Mixed · [key-loan-detail](mockups/key-loan-detail.html).

#### Property detail

- **Anatomy:** back link and header line as Loan detail: type in 600-weight `{colors.foreground}` · place · "rented at $480 a week" · owner dot + share. Then:
  - Four KPI tiles: Value ("you entered it 30 Jun 2026 · Update"), Equity ("value less the $493,241 loan (65% of value)"), Net cash this FY and Net cash last FY.
  - "Rent in, costs out" chart card: ECharts monthly bars, dashed FY divider, legend labelling interest "(entered from statements)", "View as table".
  - Gearing card: "Negatively geared" / "Positively geared" in `{typography.figure-stat}`, a rent-against-costs bar pair on `{components.progress-track}`, caption ending "estimate, not tax advice".
  - "Who owns it" card: Ownership split input.
  - "Rent and costs by financial year" table, columns Rent · Loan interest (caption "entered from statements") · Agent's fees · Rates, water & insurance · Repairs · Net cash (bold) · Net cash per month; last FY beside this FY to date; the caption beneath shows principal separately as out of pocket.
  - "Value and loan" card: value and as-of inputs with an "Update value" `{components.button-secondary}`, then the linked-loan row (institution disc, loan name, lender · type · rate · offset, balance in `{components.amount-out}`, "View loan →").
- **Tokens:** net cash tiles signed, `{components.amount-in}` / `{components.amount-out}`, per-month figure in caption. Figures are always for the whole property; when the viewer owns part of it, a "Your share (X%)" line in caption sits beneath each money tile and FY table total (a non-owner sees whole-property figures only). Chart: rent above zero in the owner's person colour; below zero, loan interest in `{colors.muted-foreground}` stacked with running costs in the property's ramp colour; net cash as a `{colors.foreground}` line with dots.
- **Source:** Mock · [key-property-detail](mockups/key-property-detail.html).

### Settings & auth

| Component | Visual spec | Source |
|---|---|---|
| **Settings card** | `{components.card}` with `{typography.card-title}` heading (id = section anchor), one-line description in `{typography.body-sm}` muted, content. Security-related cards show a lock icon in the heading; no mascot. Row anatomy (from mock): small lucide icon · label + caption ("iCloud Keychain · added 2 Oct 2026 · used today") · one `{components.button-secondary}` action at the row's right (Remove, Change, Sign out, Make new codes). Add actions ("Add a passkey", "Create a reset link") sit below their list as `{components.button-secondary}` with an icon. A caption at the card's foot lists which actions need re-authentication (Re-auth dialog). | Mixed · [key-settings](mockups/key-settings.html) |
| **Appearance card** (theme picker) | Six swatch tiles (background + primary + three ramp dots) with names; selected tile ringed `{colors.ring}`; light / dark / system segmented control. | Spine · [key-settings](mockups/key-settings.html) |
| **Signed-in devices card** | List rows: device + browser, "This device" tag (`{rounded.sm}`, `{colors.accent}`), last used caption, "Sign out" `{components.button-secondary}` per row. | Spine · [key-settings](mockups/key-settings.html) |
| **System status card** | Rows with a status glyph + label + time: Health, Last backup, Last restore drill, Failed jobs (count), and the recovery-bundle warning until its safe storage is confirmed. OK glyph `{colors.money-in}`; failure glyph and text `{colors.warning}` in a `{components.warning-line}`. A caption notes restore runs from the server CLI. | Spine · [key-settings](mockups/key-settings.html) |
| **Sign-in form** | Centred `{components.auth-card}` on `{colors.background}`; mascot + wordmark above; primary "Sign in with passkey"; "Use password instead" link reveals email, password, then TOTP step. Same card for `/setup` and `/recover`. | Spine · [key-sign-in](mockups/key-sign-in.html) |
| **Re-auth dialog** | shadcn Dialog: lock icon, plain heading, passkey button primary, "Use password instead" link. No mascot. | Spine · [key-sign-in](mockups/key-sign-in.html) |

### Feedback & primitives

| Component | Visual spec | Source |
|---|---|---|
| **Button** | `{components.button-primary}` / `{components.button-secondary}`. One `{components.button-primary}` per page: the header Import. Page-level actions (New budget, Add a goal, Cover an expense, Add loan by hand, the Transactions-search Import) are `{components.button-secondary}`. Exceptions: a card's own suggested action (a Needs review item, Save plan, an empty-state action) and an overlay's commit button may be primary within that card or overlay. | Spine |
| **Celebration banner** | `{components.celebration-banner}`: mascot, bold line + sub-line, count pill "186 / 186 categorised" on `{colors.card}`, dismiss ×. Confetti pieces from the chart ramp; plays once. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Warning line** | `{components.warning-line}` with a circled "!" glyph. | Spine · [key-budgets](mockups/key-budgets.html) |
| **Empty state** | Card with mascot left, headline in `{typography.figure-stat}`, body, one primary action; a dashed ghost of the content that will appear ("Your Sankey lands here"); KPI figures shown as `$—` in muted. | Spine · [direction-calm-cheeky](mockups/direction-calm-cheeky.html) |
| **Import popover** | shadcn Popover anchored to Import: dashed drop zone (`{rounded.lg}`, `{colors.border}` dashed, `{colors.accent}` on drag-over), account Select below, a collapsible "How to export from <bank>" note in caption, primary "Import" button. Result tiles: New (count, "in Transactions now"), Look like duplicates, Set aside (count, `{colors.warning}`, "waiting in Needs review"). A set-aside list shows each bad row (row number · reason) with an "Ask Pangolin to read these" `{components.button-secondary}`. | Spine · [key-import-popover](mockups/key-import-popover.html) (drag-over, picker, progress, clean and partial results, hand-off, fixing set-aside rows) |
| **Person dot** | `{components.person-dot-simon}` / `{components.person-dot-carissa}`. Presentational. | Spine · [key-cash-flow](mockups/key-cash-flow.html) |
| **Focus ring** | `{components.focus-ring}`: `box-shadow: 0 0 0 2px {colors.background}, 0 0 0 4px {colors.ring}` on every focusable element, including chart focus targets. | Spine only |

## Do's and Don'ts

| Do | Don't |
|---|---|
| One accent per theme (`{colors.primary}`) | Add a second accent or decorative gradients |
| Pair money colour with a sign (`+` / `−`) and a label | Rely on green/red alone |
| Keep the mascot to the logo, greeting, empty states, celebrations and hidden-name rows | Put the mascot in errors, security or re-auth prompts, charts or money warnings |
| Plain Sankey labels: name, then amount · % | Pill labels or legends detached from nodes |
| 600-weight system headings, tabular figures | Rounded heavy display type or web fonts |
| Draw charts with ECharts canvas and `richText` tooltips | HTML tooltips, inline styles or SVG libraries that break the CSP |
| Use theme tokens in every component | Hard-code a theme's hex anywhere in components |
| Flat cards with hairline borders | Shadows for hierarchy |
| `{colors.warning}` for over budget, goal shortfall, large withdrawal, the Protected warning and low balance | `{colors.money-out}` for anything but negative amounts |
| Ramp colours to the top nine groups, then Other | Recycle ramp colours for a tenth group |
| Show the date-range control only where it filters (Cash flow, Spending, Transactions, Account detail) | A range control on Net worth, Accounts, Loan or Property detail, Needs review, Budgets, Goals, Home buying or Settings |
| One `{components.button-primary}` per page (§ Components › Button) | A second primary in the page header or summary row |
