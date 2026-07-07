# Sereno

**v1.1.1**

A private, LAN-only personal finance tracker for two people. No auth, no cloud, no bank
integrations — just a calm, queryable picture of your money: net worth month over month,
a Simple-Bank-style "Safe-to-spend" number, and a longevity forecast that answers the
question that actually matters: **does the money last?**

Sereno replaces a column-growing spreadsheet with a **row-growing, append-only database**.
Every balance, expense, and assumption is an effective-dated row — never updated, only
appended — so you can diff any two dates, replay history, and let an AI agent query the
whole thing in plain SQL.

## Features

### Track

- **Net worth dashboard** — at-a-glance hero number with year-over-year change and a
  monthly sparkline, computed live from every account and liability.
- **Ledger entries** — one row per month per account. Pick any active account and
  enter its value (ETH as quantity × price, auto-translated to USD); the latest entry
  in a month wins, earlier rows are kept as history, and balances carry forward until
  the next entry.
- **Safe-to-spend** — total cash − bills due − money in funds. Monthly category envelopes
  with progress bars; overspending is allowed and simply reduces the headline number.
- **Funds & goals** — sinking funds and dated goals as one concept. Notes are
  auto-derived, never hand-typed: "needs $X/mo to finish by June", "~2 yrs to target",
  "fully funded".

### Plan

- **Spending guardrails** — Guyton-Klinger withdrawal-rate bands (Cut / Hold / Raise)
  around your at-retirement anchor rate, with a live spend slider and explicit
  raise/cut trigger portfolios.
- **Withdrawal sourcing** — a tax-aware sequencing waterfall: fill the spending gap from
  ETH first inside the 0% long-term-capital-gains headroom, then taxable brokerage, then
  401(k) after 59½. Solves for *net spendable*, not a naive 4%-per-bucket draw.
- **Longevity forecast** — a year-by-year simulation from age 38 to 95, charted by bucket
  (ETH, brokerage, 401(k), Social Security). Verdict up front: "You don't run out" or
  "Lasts to age N", plus a sensitivity table across spend levels and live sliders for
  return, inflation, and Social Security assumptions.

## Design principles

1. **Append-only.** Never `UPDATE` a balance; insert a new dated row.
2. **Effective-dated.** Every fact carries a date, so any month can be reconstructed.
3. **Tidy long.** One fact per row. Months are rows, never columns.
4. **AI-queryable.** The schema separates dimensions (what things are), facts (what
   happened), and config (each year's tax and forecast assumptions), so an agent can
   answer "what changed, and when?" straight from SQL.

## Tech stack

- **Backend** — [FastAPI](https://fastapi.tiangolo.com/) on Python 3.13, fully typed.
  Tooling is all-[Astral](https://astral.sh/): [uv](https://docs.astral.sh/uv/) for
  packaging, [ruff](https://docs.astral.sh/ruff/) for linting/formatting, and
  [ty](https://docs.astral.sh/ty/) for type checking. Tests with pytest.
- **Database** — SQLite, append-only schema (see
  [docs/design/schema.sql](docs/design/schema.sql)), stored in a Docker volume.
- **Frontend** — React 19 + [Vite](https://vite.dev/) + TypeScript (strict), styled
  with [Tailwind CSS v4](https://tailwindcss.com/) using the design tokens from the
  design handoff. Linted with [oxlint](https://oxc.rs/), tested with
  [Vitest](https://vitest.dev/).
- **CI** — GitHub Actions runs linters, type checkers, and tests for both halves on
  every pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Project structure

```
backend/            FastAPI app (uv project)
  src/sereno/
    api/            HTTP routers
    engine/         pure financial engines (guardrails, sourcing, forecast)
    db/             SQLite access layer, migrations, seed
  tests/            pytest suite
frontend/           React + Vite + TypeScript app
  src/              components, routes, Tailwind theme (src/index.css)
docs/design/        design handoff, schema.sql, prototypes, screenshots
compose.yaml        Docker Compose — dev servers and checks run through this
```

## Running with Docker

Requires [Docker](https://www.docker.com/) with Compose. From the repository root:

```sh
docker compose up --build
```

- Frontend (Vite dev server): <http://localhost:5173>
- Backend API: <http://localhost:8000/api/health> (interactive docs at
  <http://localhost:8000/docs>)

Both containers hot-reload when you edit source files. Stop with `Ctrl-C` or
`docker compose down`.

### Seeding sample data

For development, populate the database with the sanitized, illustrative values
from the design handoff — twelve months of balances, June 2026 envelopes and
activity, funds, and a year of planning config:

```sh
docker compose run --rm backend uv run python -m sereno.db.seed
```

Seeding is **opt-in**: `docker compose up` alone always starts with an empty,
migrated database. Every seeded number is a placeholder from
[docs/design/design-handoff.md](docs/design/design-handoff.md) — never real
finances. The command is a no-op on any database that already has data, so it
can't clobber a real deployment; to re-seed from scratch, remove the volume
first with `docker compose down -v`.

### API endpoints

Interactive docs at <http://localhost:8000/docs>.

The balances slice:

- `GET /api/accounts` — the account dimension rows (name, emoji, kind,
  liability and investable flags; inactive accounts stay listed with
  `active: false` so history keeps its labels).
- `POST /api/accounts` — creates an asset or liability: inserts the
  `account` row (name, emoji, `is_liability`; kind `other`, net-worth-only)
  plus an initial `balance_entry` dated today. The initial value is set
  here only — later values go through the ledger. A blank name or negative
  initial value is a 422; a name matching an active account
  (case-insensitive) is a 409. Liabilities are stored positive and
  displayed negative.
- `POST /api/accounts/{id}/deactivate` — soft remove: the account drops out
  of the pickers and stops carrying forward, but the months it was really
  entered keep counting in net worth and its name frees up for reuse. No
  hard delete — history is append-only.
- `POST /api/balance-entries` — appends a dated balance row for an account.
  Send `balance_usd` for USD accounts, or `quantity` + `unit_price` for
  ETH-style holdings (USD is derived as quantity × price). Rows are never
  updated — history is kept.
- `GET /api/ledger` — one group per month, newest first, with the canonical
  per-account balances and that month's net worth. A month's balance for an
  account is the latest entry **on or before** the month's end
  (carry-forward), so an account entered in January still counts in March;
  within a month the latest entry wins.
- `GET /api/net-worth` — current net worth, year-over-year change vs. the same
  month a year earlier (`null` until 12 months of history exist), and the
  last-12-months series for the sparkline.

The budget slice:

- `GET /api/categories` — the category dimension with each envelope's planned
  amount for a month (`?month=YYYY-MM`, default the current month). Plans are
  effective-dated: the latest `category_plan` row on or before the month wins.
- `POST /api/categories` — creates an envelope: inserts the `category` row
  (name, emoji) plus its initial `category_plan` row (`effective_month`
  defaults to the current month). A blank name or negative planned amount is
  a 422; a name matching an active category (case-insensitive) is a 409.
- `POST /api/categories/{id}/plan` — appends a new effective-dated plan row
  (the append-only config pattern — revisions never update in place; the
  latest row per month wins). New and revised envelopes flow into the
  Safe-to-spend select, envelope bars, and budget-month math with no
  further wiring.
- `PUT /api/categories/{id}` — renames an envelope's name and emoji in
  place (a null emoji clears it). The category row is a dimension, not a
  fact, so its identity is mutable; plans and expense lines keep their
  history. A blank name is a 422; a name matching another active
  category (case-insensitive) is a 409 — the check excludes the category
  itself, so case-only renames work.
- `POST /api/categories/{id}/archive` — soft remove, like account
  deactivation: flips `category.active` to 0 so the envelope drops out
  of listings and the budget-month envelope list, while its plans and
  expense lines keep counting in history and its name frees up for
  reuse. No hard delete.
- `POST /api/expenses` — appends a spending line. `budget_month` defaults to
  the transaction's month; pass a later month to prepay. `funded_from` is
  `discretionary` or `fund` (then `fund_id` is required).
- `POST /api/income` — appends an income/funding event (paycheck, transfer,
  staking, …). `budget_month` is the month the inflow funds — the seed's
  Jun 27 paycheck funds July.
- `GET /api/budget-month` — the computed month (`?month=`, default current):
  per-category planned/spent/remaining envelopes (overspend is allowed and
  goes negative), the Safe-to-spend headline (`baseline − total_spent`, where
  the baseline is the month's stored funding — never recomputed from live
  spend), and the recent-activity list (spending and funding merged, newest
  first).
The funds slice:

- `GET /api/funds` — the active funds (sinking funds and goals: name, kind,
  target amount, target date, monthly plan), each with its latest balance
  from `fund_entry` and an auto-derived note ("needs $X / mo to finish by
  2027-08", "$X / mo · ~Y yrs to target", "✓ fully funded — ready to
  spend", …). Notes are computed server-side from the fund's own numbers,
  never hand-typed, so they can't go stale; dates in notes stay ISO —
  display formatting is the frontend's job.
- `POST /api/funds` — creates a fund. `kind` is derived, never sent: a
  blank `target_date` means a sinking fund, a set date means a goal; a
  blank `target_amount` is an open-ended fund (no finish line, so no
  progress percent — just a parked balance and a monthly plan).
- `POST /api/fund-entries` — appends a dated balance row for a fund
  (append-only, like `balance_entry`); the latest entry is the fund's
  balance and earlier rows are kept as history.

The config slice (the one input source for the Plan engines):

- `GET /api/assumptions` / `GET /api/spend-plan` — the effective
  planning config: the latest effective-dated row on or before today
  wins, ties break by insertion order, and future-dated rows can be
  staged without taking effect early. `null` until a row exists.
- `GET /api/social-security` — the same rule resolved per person
  (`you` first, then `spouse`).
- `GET /api/tax-params` — every tax year ascending, with
  `ordinary_brackets` parsed into typed `{rate, upto}` pairs.
- `POST /api/assumptions` / `/api/spend-plan` / `/api/social-security` —
  appends a new effective-dated row; config rows are never updated, so
  every raise, cut, and revised estimate stays queryable history.
- `POST /api/tax-params` — loads a new tax year (a duplicate year is a
  409). `PUT /api/tax-params/{year}` revises that year in place —
  `tax_param` is keyed by year, the one config table that replaces
  rather than appends.

The guardrails slice (the first Plan engine):

- `GET /api/guardrails` — the Guyton-Klinger evaluation: the withdrawal
  rate (spend ÷ the latest month's investable total, every
  `is_investable` account), the guardrails at the stored at-retirement
  `initial_rate` × (1 ± the configured band), the zone (`cut` above the
  upper rail, `raise` below the lower, else `hold` — the ±band is the
  trigger, the ~10% change is the response, never a reset to the band),
  the raise/cut trigger portfolios, and the 4% rate as a sanity
  ceiling, not a binding rule. `?spend=` evaluates a what-if level
  instead of the plan's annual target. `null` until a spend plan with
  an initial rate and at least one balance month exist.

The sourcing slice (the second Plan engine):

- `GET /api/sourcing` — the tax-aware withdrawal waterfall: target net
  spend minus non-portfolio income leaves a gap, filled from ETH
  inside the 0% long-term-capital-gains headroom (the ceiling minus
  taxable ordinary income, converted to sale proceeds through each
  bucket's gain fraction), then taxable brokerage (leftover headroom
  first, then 15% on the gain portion), then 401(k) only at age ≥ 59½
  with ordinary-income treatment (the unused standard deduction
  shelters the first dollars, then a walk up the year's brackets).
  Buckets aggregate accounts by `withdrawal_priority`; each account
  contributes its newest balance row from any month and its basis
  from open tax lots, falling back to the balance row's `cost_basis`,
  then to zero. `?age=` is required — no birthdate lives in the
  schema — and `?spend=` tests a what-if level (it also stands in for
  a missing spend plan). Each step reports gross, tax, net, and any
  gate note; whatever the waterfall cannot deliver comes back as
  `shortfall` — never a naive 4%-per-bucket draw. Null until a tax
  year, a balance, and a spend target exist. Deliberately federal-only
  and one-pass in v1: no state tax, no NIIT, and Social Security
  reduces the gap without counting as ordinary income.

The forecast slice (the third Plan engine):

- `GET /api/forecast` — the year-by-year longevity simulation, age 38
  to 95 in today's dollars. Each year the buckets grow by the real
  rate (return − inflation), Social Security (per person, from that
  person's start age) and staking income (while the ETH stake stays
  above $50k) reduce the year's need, and the remainder is withdrawn
  through the sourcing waterfall — the 0% LTCG headroom, the
  gross-ups, and the 59½ gate apply every simulated year. Growth is
  all gain (basis stays put); sales reduce basis pro-rata. Spend
  defaults to the plan's annual target, the rates to the assumptions
  row, and Social Security to the stored rows; `?spend=`,
  `?return_pct=`, `?inflation_pct=`, `?ss_you=`, `?ss_spouse=`, and
  `?ss_start=` override each transiently — the Forecast screen's
  sliders never persist. The response carries the resolved inputs,
  the per-bucket series with each year's SS income, the run-out age
  (the first unmeetable year; null when the money lasts), the age-90
  balance, and the sensitivity table: whole percentages of the
  latest month's net worth from 2% to 6% — the 4% rule of thumb dead
  center — rounded to the nearest $1,000 and each simulated at the
  same assumptions. The current tax year's parameters apply to every
  simulated year; null until a tax year, balances, a spend target,
  and return/inflation figures exist.

### Screens

- **Dashboard** (<http://localhost:5173/>) — the landing view. The net-worth
  hero reads `GET /api/net-worth` live: the current figure, a year-over-year
  pill vs. the same month a year earlier (omitted until 12 months of history
  exist), and a 12-bar sparkline of the last year. Beside it, the
  Safe-to-spend card shows the month's live headline from
  `GET /api/budget-month` with its share of the funding baseline as a
  progress bar, and the Funds & goals card shows the total parked and a
  top-3 mini list (percent to target; an open-ended fund shows its
  balance) from `GET /api/funds` — both deep-link to their views. Recent
  activity lists the month's five newest spending and funding items as
  emoji-tile rows with signed amounts — credits in green, debits in ink,
  and expenses whose envelope is over budget in red — and refreshes on
  every visit as items are added elsewhere. The Spend guardrail card
  shows the live withdrawal rate, mini band, and zone status from
  `GET /api/guardrails` (muted until a spend plan exists), and the
  Longevity card shows the live verdict, the resolved spend, and the
  projected age-90 balance from `GET /api/forecast` (muted until the
  forecast's inputs exist) — every dashboard card now reads the API.
- **Ledger entries** (<http://localhost:5173/ledger>) — the monthly balance
  table (one row per month, newest first, current month highlighted) with one
  column per active account — assets then liabilities, liabilities negative
  in red — plus the net-worth column, horizontally scrollable as accounts
  grow. Beside it, the "Update this month's balances" form: an account picker
  over the active accounts with a single value input prefilled from the
  newest month (the ETH account swaps to quantity + $/ETH inputs with a live
  quantity × price readout), an "As of" date defaulting to today — pick an
  earlier date to backfill history or catch up a missed month, and the date
  sticks across saves so a backfill month can be entered account by
  account — and a live net-worth figure that tracks the
  draft before anything is saved. Saving appends one dated row via
  `POST /api/balance-entries` — the latest entry in a month wins and earlier
  rows are kept as history — then the table and the header net-worth readout
  refresh from the API.
- **Safe-to-spend** (<http://localhost:5173/safe-to-spend>) — the daily-use
  view. The dark hero shows the month's Safe-to-spend headline from
  `GET /api/budget-month` (stored funding baseline − total spent) with the
  "total cash − bills due − money in funds" formula pill, above the monthly
  envelopes card: one progress bar per category, "spent · left" while under
  budget, "$X over" in red once over — overspending is allowed and simply
  trims the headline. Beside them, "Add a spending item" (amount, category,
  and funded-from: the month's discretionary budget or any active fund via
  `GET /api/funds`; choosing a fund reveals the matching
  Cash-Plus-withdrawal reminder) posts to `POST /api/expenses`, and "Add a
  funding item" (amount, funds month — the current or next two, so a
  paycheck can prepay next month — and source) posts to `POST /api/income`.
  Every submit refetches the budget month, so the hero and envelopes always
  show the API's figures rather than client-side math.
- **Funds & goals** (<http://localhost:5173/funds>) — sinking funds and
  dated goals as one concept, in a single card: a header with the total
  parked and the "notes auto-calculate" hint, the dashed **+ New fund or
  goal** form (name, target, saved, target date — blank = sinking fund —
  and $/month), then each fund with its meta line, `saved / target` amount,
  progress bar, and the server-derived note from `GET /api/funds`, rendered
  verbatim. Completed funds turn accent green; open-ended funds (no target)
  show just their balance, with no bar. Submitting the form posts the
  dimension row to `POST /api/funds`, appends any initial saved amount via
  `POST /api/fund-entries`, and refetches the list.
- **Guardrails** (<http://localhost:5173/guardrails>) — the "how much
  can we spend?" view, every figure from `GET /api/guardrails`: KPIs
  (investable portfolio, planned spend, and the withdrawal rate —
  colored by zone — beside the ±band and 4% ceiling), the three-zone
  Cut / Hold / Raise band with a marker at the current rate, the
  recommendation banner (trim ~10% above the upper guardrail, raise
  ~10% below the lower, hold steady inside), a spend slider that
  re-evaluates everything server-side at each level, and raise/cut
  trigger cards naming the portfolio levels where the next rule fires.
  The slider's bounds derive from the band edges, so both rails are
  always reachable whatever the portfolio and plan sizes are. Until a
  spend plan and balances exist, the view points at Settings & data.
- **Withdrawal sourcing** (<http://localhost:5173/withdrawals>) — the
  "where does the money come from?" view, every figure from
  `GET /api/sourcing`. Left, the sequencing waterfall: target net
  spend, minus non-portfolio income (Social Security past its start
  age, staking while the ETH stake stays meaningful), the gap from
  the portfolio, then the three bucket steps — ETH sold tax-free
  inside the 0% LTCG headroom, brokerage next (inheriting leftover
  headroom, then 15% on the gain portion), 401(k) last and only at
  59½ — down to the net delivered, with a shortfall banner when the
  gap goes unfilled. Age and what-if spend inputs re-evaluate the
  whole waterfall server-side (the screen defaults to age 38 — no
  birthdate lives in the schema). Right, the per-bucket rule cards
  and the engine rule: never 0.04 × balance per bucket; solve for
  net spendable. Until tax parameters, a spend target, and balances
  exist, the view points at Settings & data.
- **Longevity forecast** (<http://localhost:5173/forecast>) — the
  "does the money last?" view, every figure from `GET /api/forecast`.
  The verdict hero ("You don't run out." / "Lasts to age N", red only
  when the money dies before 90) carries the resolved spend and the
  projected age-90 balance, beside the bridge-to-59½ card — how long
  the taxable buckets last against the 21.5-year bridge to the
  401(k). The balance-by-bucket chart samples twelve ages (38 → 93)
  as CSS stacked bars: ETH, brokerage, 401(k), and the Social
  Security income sliver at the base, enlarged to a 7px minimum so
  the income stays visible against multi-million balances. The
  sensitivity table shows the server's 2–6%-of-net-worth spend levels
  with each outcome (never runs out / tight at 90+ / runs out early)
  and highlights the row nearest the current spend. The assumptions
  card — spend, return, and inflation sliders plus the editable
  Social Security panel (You $/mo, Spouse $/mo, from age) — re-runs
  the whole simulation server-side on every change; the spend
  slider's floor widens so the resolved spend is always reachable.
  All of it is transient what-if: Settings owns config writes. Until
  a tax year, assumptions, a spend target, and balances exist, the
  view points at Settings & data.
- **Settings & data** (<http://localhost:5173/settings>) — the config
  home. The Assets and Liabilities cards list every active account's
  emoji, name, and newest ledger balance (walking back through the
  months; liabilities negative in red), each with an add form (name, a
  curated emoji select, and the initial value — later values go through
  the Ledger) and a per-row Deactivate that soft-removes the account
  while its entered history keeps counting. Adding or deactivating an
  account refreshes the header net-worth readout immediately, like a
  Ledger save. Fund rows no longer appear
  on Settings — funds live on Funds & Goals, where their targets and
  progress already are. Below them sit the Envelopes card, the
  Assumptions summary
  (return, inflation, ETH growth, planned spend), the Social Security
  panel (You/Spouse $/mo and start age), the latest year's tax
  parameters (LTCG ceilings, NIIT, standard deduction, ordinary
  brackets), and the dark append-only data-model note pointing at
  `docs/design/schema.sql`. The Envelopes card manages the spending
  categories: each envelope's emoji, name, and current planned amount
  with a per-row Edit covering all three (the name and emoji revise the
  row in place; a changed planned amount appends an effective-dated
  plan revision — only what actually changed is sent), a per-row
  Archive that soft-removes the envelope while its plans and spending
  history keep counting, and an add form (name, a curated emoji select,
  $ / month) that creates the category with its initial plan — new
  envelopes appear in Safe-to-spend immediately. Settings is where config changes are
  *persisted*: saving the Assumptions or Social Security cards appends
  new rows effective today (only configs whose values actually changed
  are posted), the tax card's Edit revises the displayed year in place,
  and + Add creates the next year prefilled from the current one. The
  Forecast screen's future sliders stay transient what-if overrides.

### Tests, linters, and type checkers

Backend (ruff, ty, pytest):

```sh
docker compose run --rm backend uv run ruff check .
docker compose run --rm backend uv run ruff format --check .
docker compose run --rm backend uv run ty check
docker compose run --rm backend uv run pytest
```

Frontend (oxlint, tsc, vitest):

```sh
docker compose run --rm --no-deps frontend npm run lint
docker compose run --rm --no-deps frontend npm run typecheck
docker compose run --rm --no-deps frontend npm test
```

## Status

v1.1.1 — Bug fix: the header net-worth readout now refreshes as soon
as an account is added or deactivated on Settings & data. The Settings
account handlers refresh the net-worth context the way a Ledger save
already did, so a fresh install no longer shows the `$—` placeholder
(or a stale figure) until a hard reload.

v1.1.0 — Envelope rename & archive. Envelopes are no longer immutable
after creation: `PUT /api/categories/{id}` renames an envelope's name
and emoji in place (the category row is a dimension, so plans and
expense lines keep their history), and
`POST /api/categories/{id}/archive` soft-removes one via the existing
`active` flag — it drops out of Settings and the budget month while
its spending keeps counting and its name frees up for reuse. The
Settings Envelopes card's per-row Edit now covers name, emoji, and
planned amount (only what actually changed is sent), and each row
gains an Archive button.

v1.0.0 — Asset & liability management. Accounts are no longer
seed-only: `POST /api/accounts` creates an asset or liability — name,
emoji, and an initial balance entry dated today — and
`POST /api/accounts/{id}/deactivate` soft-removes one with its history
intact. Settings replaces the mixed Accounts & buckets card with
separate Assets and Liabilities cards (add form, curated emoji select,
per-row Deactivate; fund rows moved off to Funds & Goals). The Ledger's
fixed-field form becomes an account picker — one value input, or
quantity + $/ETH for the ETH account — the table grows one column per
active account, and migration 0004 makes the SQL views carry balances
forward: a month's balance is the latest entry on or before that
month's end, so single-entry accounts like Home keep counting in every
later month.

v0.16.0 — Responsive layout. The frontend is now mobile-first rather
than a fixed ~1180px desktop shell. The capped main column is centered
(`mx-auto`) so ultra-wide screens no longer leave a right-side dead
zone, and its padding tightens on small screens. Every view and form
grid stacks into a single column below its breakpoint (`sm`/`lg`), the
net-worth and Safe-to-spend hero figures scale down on narrow screens,
and the 248px sidebar collapses below `lg` behind a hamburger button in
the header that opens it as a slide-over drawer (closing on navigation
or a backdrop tap).

v0.15.0 — Envelope management. Spending categories can now be created
and revised on a real database, not just seeded: `POST /api/categories`
inserts the category with its initial effective-dated plan row
(blank/duplicate active names and negative amounts rejected), and
`POST /api/categories/{id}/plan` appends a plan revision — the
append-only pattern, with an id tiebreak so same-month revisions
resolve to the latest row. The Settings & data screen gains the
Envelopes card (see [Screens](#screens)): the envelope list with
per-row planned-amount edits and an add form with a curated emoji
select. New envelopes flow into Safe-to-spend, the envelope bars, and
the budget-month math with no further wiring.

v0.14.0 — Longevity forecast. The third and final Plan engine lands:
a pure, typed year-by-year simulation in `engine/forecast.py` — ages
38 through 95 in today's dollars, buckets grown by the real rate,
each year's need reduced by Social Security and staking income and
withdrawn through the sourcing waterfall, so the 0% LTCG headroom
and the 59½ gate apply every simulated year — exposed through
`GET /api/forecast` with transient override params and a
2–6%-of-net-worth sensitivity table. The Longevity forecast screen
replaces the last stub (see [Screens](#screens)): the verdict hero,
the bridge-to-59½ card, the balance-by-bucket chart, the sensitivity
table, and live assumptions sliders with the editable Social
Security panel. The Dashboard's Longevity card now reads the same
simulation, completing the dashboard — every card is live. This
closes out the design handoff's screen list.

v0.13.0 — Withdrawal sourcing. The second Plan engine lands: a pure,
typed waterfall in `engine/sourcing.py` — target net spend minus
non-portfolio income, then ETH inside the 0% LTCG headroom, taxable
brokerage, and the age-gated 401(k), each step grossed up from basis
and the year's brackets, solving for net spendable rather than a flat
per-bucket rate — exposed through `GET /api/sourcing?age=&spend=`.
The Withdrawal sourcing screen replaces its stub (see
[Screens](#screens)): the sequencing waterfall with per-step amounts
and tax detail, age and what-if spend inputs re-evaluated
server-side, a shortfall banner when the gap goes unfilled, and the
bucket-rule cards. Deliberately federal-only and one-pass in v1 (no
state tax, no NIIT); the longevity forecast consumes this engine
next.

v0.12.1 — Bug fix: SQLite connections are now opened with
`check_same_thread=False`, so a request's connection can be opened,
used, and closed on different FastAPI threadpool threads. Concurrent
dashboard API calls no longer hit intermittent 500s from
`sqlite3.ProgrammingError`; each connection still serves exactly one
request at a time.

v0.12.0 — Guardrails. The first Plan engine lands: a pure, typed
Guyton-Klinger module in `engine/guardrails.py` (the ±band around the
stored at-retirement rate is the trigger, the ~10% change is the
response) exposed through `GET /api/guardrails`, which evaluates the
plan's annual target — or a `?spend=` what-if — against the latest
month's investable total. The Guardrails screen replaces its stub
(see [Screens](#screens)): KPIs, the three-zone Cut / Hold / Raise
band with a marker at the current rate, the recommendation banner,
band-derived spend slider, and raise/cut trigger cards; the
Dashboard's Spend guardrail card now reads the same evaluation live.
Planning config, the Dashboard v2 landing view, the Funds & goals
screen, the Safe-to-spend screen, the budget API, the Ledger entries
screen, the balances API, seed data, the append-only schema
(migrations at startup), the typed SQLite connection module, and the
app shell landed in earlier releases. No remaining roadmap items —
the design handoff is fully implemented.

## License

MIT — see [LICENSE](LICENSE).
