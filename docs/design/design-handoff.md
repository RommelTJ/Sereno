# Handoff: Home Budget — personal finance tracker

> **Note:** every dollar amount, balance, and quantity in this bundle is a sanitized,
> illustrative placeholder — not real data.

## Overview
A private, LAN-only personal-finance web app for two users (no auth). It replaces a
column-growing spreadsheet with a **row-growing database** so the data is queryable in
SQL and by an AI agent. Core jobs:

1. **Track** net worth month-over-month, budget/spend with a Simple-Bank-style
   "Safe-to-spend", and manage funds/goals.
2. **Plan** early retirement: Guyton-Klinger spending **guardrails** (how much), a
   tax-aware **withdrawal sourcing** order (where from), and a **longevity forecast**
   (will we run out) — the emotional centerpiece for a 38-year-old early retiree.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that
show the intended look and behavior. They are **not production code to copy directly.**
The task is to **recreate these designs in the target codebase's environment** (React,
Vue, Svelte, etc.) using its established patterns, component library, router, and data
layer. If no app exists yet, pick an appropriate stack — a small SPA (React + Vite or
SvelteKit) over a SQLite/Postgres database on the LAN fits the brief well.

`Home Budget.dc.html` is authored as a "Design Component" (a streaming HTML format);
treat its **rendered UI and its logic class** as the spec, not its custom `<x-dc>` /
`{{ }}` syntax. All the real computations live in the `<script>` logic class
(`renderVals`, `simulate`, etc.) and are documented below.

## Fidelity
**High-fidelity** for visuals and layout — exact colors, typography, spacing, and
interactions are specified below and should be matched. **One caveat on the math:** the
prototype's longevity forecast uses a *simplified* flat real-return model (one rate
applied to all buckets). The **real tax-aware sourcing engine is specified but not yet
implemented** — see `schema.sql` and the "Withdrawal sourcing" screen. Implement the
sequencing algorithm (below) against real per-bucket tax rules in the production build.

---

## Design Tokens

### Typography
- Family: **Hanken Grotesk** (Google Fonts), weights 400/500/600/700/800.
- All numeric/tabular values use `font-variant-numeric: tabular-nums` (utility class `.num`).
- Scale (px): hero net worth 52/800; section hero numbers 44–56/800; page title 21/700;
  card stat 26–30/800; body 13–14/400–600; labels 11/600 uppercase `letter-spacing:1.2–1.4px`;
  micro 10–10.5/600.

### Color
| Token | Hex | Use |
|---|---|---|
| paper | `#efece5` | app background |
| header bg | `#f6f3ee` | sticky top bar |
| card | `#ffffff` | cards |
| card border | `#e9e4da` | card outline |
| hairline | `#f0ece3` / `#f4f1e9` | inner dividers |
| ink | `#1f2421` | primary text |
| muted | `#757a70` | secondary text |
| muted-2 | `#9aa093` | labels / tertiary |
| faint | `#bcb6a8` | placeholder / hints |
| input border | `#ddd7ca` | form fields |
| **sidebar bg** | `#16241d` | left nav + dark hero cards |
| sidebar text | `#cdd6cf` | nav labels |
| sidebar muted | `#9fb3a8` / `#7e948a` / `#5f7268` | nav sublabels/group headers |
| sidebar active bg | `#264334` @ ~38% | active nav item |
| **accent (primary green)** | `#2f8f6b` | buttons, active, positive — *themeable prop* |
| hero green text | `#5cc79b` | big number on dark hero |
| green soft | `#e8f2ec` / `#e3efe8` / `#f0f5f1` | positive backgrounds |
| amber | `#c79049`; text `#a9772f` | caution / 401k series |
| amber soft | `#f4ead5` / `#f8efdc` / `#faf4e8` | caution backgrounds |
| red | `#c1574d`; text `#b5524a` | negative / over-budget |
| red soft | `#f9ece9` / `#f0ddd8` / `#f6e3df` | negative backgrounds |
| **SS sliver blue** | `#5f86ad` | Social Security series in forecast chart |

Chart series: ETH `#2f8f6b`, Taxable brokerage `#16241d`, 401(k) `#c79049`, Social Security `#5f86ad`.

### Radius / spacing / shadow
- Radius: cards 18px (hero 20px), inputs 8–11px, pills/badges 20px, progress bars 5–6px.
- Card padding: 22–28px. Content gutter: 30px 36px. Grid gaps: 18–20px.
- Shadows: intentionally flat — cards rely on the `#e9e4da` 1px border, not drop shadows.
- Progress bars: 7–10px tall, track `#eef0ea`, fill = accent (or `#16241d` for in-progress, red when over).

---

## App Shell / Layout
- Root: `display:flex; min-height:100vh`.
- **Sidebar**: fixed `width:248px`, `background:#16241d`, sticky full-height. Logo (30px
  rounded-9 green tile "H" + wordmark). Three groups with `letter-spacing:1.4px` uppercase
  headers: **TRACK** (Dashboard, Ledger entries, Safe-to-spend, Funds & goals), **PLAN**
  (Guardrails, Withdrawal sourcing, Longevity forecast), **SETTINGS** (Settings & data).
  Active item: light text, faint green bg, 3px left border in accent. Footer chip shows
  the current month ("June 2026 · Funding July's budget · prepay").
- **Main**: flex column. Sticky **header** (`#f6f3ee`, 1px bottom border) with page title +
  subtitle on the left and a live Net Worth readout + avatar on the right. Content area
  `max-width:1180px`, padding `30px 36px 60px`.
- Only the active view renders (single-page view switch on `state.view`).

---

## Screens / Views

### 1. Dashboard (`view: 'dashboard'`)
At-a-glance overview. Grid:
- Row 1 (`1.5fr / 1fr`): **Net worth hero** (dark `#16241d` card, 52px number, YoY pill,
  12-bar CSS sparkline) + **Safe-to-spend** card (white, 44px accent number, progress bar,
  clickable → Safe-to-spend view).
- Row 2 (3 cols): **Spend guardrail** (rate + 3-zone band + marker + status), **Longevity**
  (headline "You don't run out." + projected age-90 balance), **Funds & goals** (total +
  top-3 mini list). All three clickable → their views.
- **Recent activity** card: list of spend/funding rows with emoji tile, title/sub, signed
  amount (green credit / ink debit / red treat). Updates as you add items.

### 2. Ledger entries (`view: 'ledger'`)
The row database. Grid `1.6fr / 1fr`:
- **Monthly balance entries** table (one row per month; horizontal scroll). Columns:
  Date, **ETH, VFIAX, VTIAX, VGSH**, Retire, Home, Cash, Mortgage (red), **Net worth**.
  Current month row highlighted (`#f3f6f3`, bold); history rows muted.
- **Update this month's balances** form: per-fund inputs (VFIAX/VTIAX/VGSH in a 3-col grid),
  Retirement, ETH held + $/ETH (with a live "ETH value = qty × price" readout). Editing any
  field recomputes Net Worth live. Note: "latest entry in a month wins; earlier rows kept as history."

### 3. Safe-to-spend (`view: 'safe'`)
Grid `1fr / 1fr`:
- Left: dark **Safe-to-spend** hero (56px) with formula pill "total cash − bills due −
  money in funds"; **July envelopes** card — per-category bars (spent/left; over-budget turns
  red and shows "$X over"). Overspend is allowed and reduces Safe-to-spend.
- Right: **Add a spending item** (amount, category select, funded-from select; "fund" option
  reveals a Cash-Plus-withdrawal reminder) and **Add a funding item** (amount, funds-month,
  source) with a rollover note. Both append to Recent activity; spending decrements its
  envelope and the headline Safe-to-spend.

### 4. Funds & goals (`view: 'funds'`)
Single card, `max-width:760px`. Header: total parked + "notes auto-calculate" hint.
**+ New fund or goal** form (dashed card): name, target $, saved $, target date (blank =
sinking fund, set = goal), $/month. Below: each fund as name + meta + amount + progress bar
+ an **auto-derived** note (see "Fund note derivation"). Completed funds render in accent.

### 5. Guardrails (`view: 'guard'`)
`max-width:860px`. KPIs: investable portfolio, planned spend, withdrawal rate (colored).
Three-zone band (Cut / Hold / Raise) with a marker at the current rate; recommendation
banner; a **spend slider** that recomputes everything; raise/cut trigger cards.

### 6. Withdrawal sourcing (`view: 'source'`)
`max-width:980px`, 2 cols. Left: sequencing waterfall (target net → − non-portfolio income
→ gap → fill ETH-first at 0% LTCG → brokerage → 401k → net delivered). Right: bucket rules
and the engine rule ("never 0.04 × balance per bucket; solve for net spendable"). **This view
is the spec for the production sourcing engine.**

### 7. Longevity forecast (`view: 'forecast'`)
`max-width:1000px`. Hero verdict card ("You don't run out." / "Lasts to age N") + projected
age-90 balance; bridge-to-59½ card. **Balance-by-bucket chart** (age 38→95, 12 bars; ETH /
brokerage / 401k / **SS sliver from age 67** at the base — SS is income, enlarged to stay
visible). **Sensitivity** table (spend levels → lasts / outcome). **Assumptions** card:
spend / return / inflation sliders + editable **Social Security** panel (You $/mo, Spouse $/mo,
start age). Everything recomputes the simulation live.

### 8. Settings & data (`view: 'settings'`)
Accounts & buckets list (each fund/account with value), Assumptions summary, Social Security
(mirrors the Forecast values), and an append-only data-model note pointing to `schema.sql`.

---

## Interactions & Behavior
- **Nav**: clicking a sidebar item sets `state.view`; only that view renders. Dashboard cards
  deep-link to their views.
- **Live recompute**: all derived numbers come from one `renderVals()` pass — editing any
  input or slider re-renders the whole view. No async; everything is synchronous in-memory.
- **Add spending**: parse amount, add to that category's `spent`, prepend to activity, clear
  field. Envelopes and Safe-to-spend update. Over-budget allowed (negative remaining, red bar).
- **Add funding**: parse amount, prepend a credit to activity, clear field.
- **Add fund**: build a fund object; blank date ⇒ `kind:'sinking'`, set date ⇒ `kind:'goal'`.
- **Ledger edits**: per-fund / retirement / ETH qty / ETH price update state; Net Worth and
  the live ledger row recompute (ETH auto-translates qty × price → USD).
- **Sliders/SS**: spend (guardrails + forecast), return, inflation, and SS amounts/age all
  feed `simulate()`; the chart, verdict, sensitivity table, and guardrail bands move together.
- No hover-only affordances are required; cursor:pointer on clickable cards/nav. No loading or
  error states (local data). Not responsive — designed for desktop/laptop width.

## State Management
In-memory object (seed values illustrative). Key fields:
- `view` — active screen.
- Portfolio: `ethQty`, `ethPrice`, `vfiax`, `vtiax`, `vgsh`, `retire`, `home`, `chase`,
  `cashPlus`, `car`, `mortgage`, `janNW` (prior Jan-1 net worth for YoY).
- Planning: `spend`, `ret`, `infl`, `ssYou`, `ssWife`, `ssStart`.
- Budget: `cats[]` ({key, emoji, name, planned, spent}), `funds[]`
  ({name, kind, date, target, bal, monthly}), `activity[]`.
- Transient form fields: `sAmt/sCat/sFund`, `iAmt/iSrc/iMonth`, `fName/fTarget/fBal/fDate/fMonthly`.

## Key Computations (port these exactly)
- **Net worth** = ETH(qty×price) + vfiax + vtiax + vgsh + retire + home + chase + cashPlus +
  car + mortgage(negative). **Investable** = ETH + (vfiax+vtiax+vgsh) + retire.
- **YoY** = netWorth / janNW − 1.
- **Safe-to-spend** = fixed discretionary baseline − Σ category.spent. (Baseline is a
  CONSTANT seeded once — do NOT recompute it from live spend, or it cancels to a constant.)
- **Guardrails (Guyton-Klinger)**: `rate = spend / investable`; `initialRate ≈ 0.0294`
  (the at-retirement rate, stored); bands = initialRate × (1 ± 0.20). rate > upper ⇒ cut ~10%;
  rate < lower ⇒ raise ~10%; else hold. Trigger portfolios = spend / lower (raise) and
  spend / upper (cut). Also show the 4% rate as a sanity ceiling, not a binding rule.
- **Fund note derivation** (no hand-typed strings): remaining = max(0, target − bal).
  If remaining ≤ 0 → "fully funded". If goal with date → required = remaining ÷
  monthsUntil(date) → "needs $X/mo to finish by <date>". Else if monthly > 0 → "$X/mo · ~Y
  yrs to target" (yrs = remaining/monthly/12; show months if <1yr). Else → "add a monthly plan".
- **Longevity simulation** (today's dollars), per year age 38→95:
  1. real = (return − inflation)/100; grow eth, brk, r401 by `real`.
  2. record balances; ss = age ≥ ssStart ? (ssYou+ssWife)×12 : 0; staking = eth>50k ? 3000 : 0.
  3. need = max(0, spend − ss − staking). Withdraw need in order: **ETH first**, then brokerage,
     then 401(k) **only if age ≥ 60** (59½ gate). First year need can't be met ⇒ that's the run-out age.
  4. Output: series for the chart, run-out age (or "never"), balance at 90.
  *Production:* replace the flat `real` rate with per-bucket tax-aware sourcing — see `schema.sql`
  and the Sourcing screen (0% LTCG headroom = ceiling − ordinary income; gross-up per bucket).

## Design Tokens for the chart
Bars are CSS flex columns, `justify-content:flex-end`, 4 stacked segments top→bottom:
ETH `#2f8f6b`, brokerage `#16241d`, 401k `#c79049`, SS `#5f86ad` (base). Heights = value ÷
maxTotal × 190px; SS uses `max(7px, …)` so the income sliver stays visible.

## Assets
No image/icon assets — the UI uses Unicode glyphs (◎ ▦ ◐ ◇ ⚖ ⤵ ✦ ⚙) for nav and emoji for
categories. Replace nav glyphs with your icon set (Lucide/Phosphor recommended). Font:
Hanken Grotesk via Google Fonts (or self-host). No brand assets.

## Files in this bundle
- `Home Budget.dc.html` — the hi-fi interactive prototype (UI + logic class = the spec).
- `schema.sql` — the **append-only** database DDL (dimensions / dated facts / per-year config),
  with views for "latest row per month" and net worth, plus example AI-agent queries. Build the
  data layer from this.
- Earlier lo-fi wireframes existed (`Finance Tracker Wireframes.dc.html`) but are omitted
  from the repo — context only.

## Implementation order (suggested)
1. Stand up `schema.sql` (SQLite is fine for a LAN app) + seed.
2. Build the app shell + nav + Dashboard reading from the DB.
3. Ledger entry + the `v_account_monthly` "latest per month" rule; net-worth view.
4. Safe-to-spend + envelopes + add spending/funding (prepay `budget_month`).
5. Funds & goals (unified goal/sinking model, derived notes).
6. Guardrails (GK) → Sourcing (real tax engine) → Forecast (sim using the sourcing engine).
