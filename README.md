# Sereno

**v1.8.0**

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
- **Longevity forecast** — a year-by-year simulation from the current age (derived
  from a sanitized birthdate constant) to 100, charted one bar per year by bucket
  (ETH, brokerage, 401(k), Social Security) with a hover breakdown per bar. Verdict
  up front: "You don't run out" or "Lasts to age N", plus a sensitivity table across
  spend levels and live sliders for return, inflation, and Social Security assumptions.

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
  tax treatment, liability and investable flags, withdrawal priority,
  and access age; inactive accounts stay listed with `active: false` so
  history keeps its labels).
- `POST /api/accounts` — creates an asset or liability: inserts the
  `account` row (name, emoji, `is_liability`; kind `other`, net-worth-only
  until classified) plus an initial `balance_entry` dated today. The
  initial value is set here only — later values go through the ledger. A
  blank name or negative initial value is a 422; a name matching an active
  account (case-insensitive) is a 409. Liabilities are stored positive and
  displayed negative.
- `PUT /api/accounts/{id}` — classifies an account for the planners:
  kind, tax treatment, the investable flag, withdrawal priority (1 ETH,
  2 brokerage, 3 tax-advantaged), and access age, revised in place — the
  account row is a dimension, like an envelope rename, so history is
  unaffected. This is what lets an account created through the UI feed
  Guardrails (investable), Sourcing, and Forecast (priority buckets). A
  liability can never be investable or hold a priority; unknown kinds or
  treatments, out-of-range priorities, and negative access ages are 422s.
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
  `discretionary` or `fund` (then `fund_id` is required). Fund spending
  draws the fund down in the same transaction: a `fund_entry` with
  `source = 'spend'`, the balance minus the amount, and a negative
  contribution is appended, dated the transaction — and an expense that
  exceeds the fund's balance is a 422, since a fund is an earmark over
  real cash.
- `POST /api/income` — appends an income/funding event (paycheck, transfer,
  staking, …). `budget_month` is the month the inflow funds — the seed's
  Jun 27 paycheck funds July.
- `GET /api/budget-month` — the computed month (`?month=`, default current):
  per-category planned/spent/remaining envelopes (overspend is allowed and
  goes negative), the Safe-to-spend headline
  (`baseline − fund_contributions − total_spent`, where the baseline is the
  month's stored funding — never recomputed from live spend), and the
  recent-activity list (spending and funding merged, newest first).
  Fund-funded expenses stay out of `total_spent` and the envelope bars —
  they were paid from parked money, and the fund's drawdown already
  released the earmark — and `fund_contributions` is the month's automatic
  monthly-plan funding: money moved into a fund is parked, so it stops
  being spendable the moment it lands. Reading the budget month applies
  the monthly-plan catch-up itself, so the headline never misses a
  contribution the funds list hasn't been asked for yet.
The funds slice:

- `GET /api/funds` — the active funds (sinking funds and goals: name, emoji,
  kind, target amount, target date, monthly plan), each with its latest
  balance from `fund_entry` and an auto-derived note ("needs $X / mo to
  finish by 2027-08", "$X / mo · ~Y yrs to target", "✓ fully funded — ready
  to spend", …). Notes are computed server-side from the fund's own numbers,
  never hand-typed, so they can't go stale; dates in notes stay ISO —
  display formatting is the frontend's job. Reading the funds applies the
  monthly plans lazily: with no scheduler in the stack, each active fund
  with a `monthly_plan` receives any missing contribution entries
  (`source = 'monthly_plan'`, one per 1st-of-month since its latest planned
  or hand-entered row) before the list is computed, idempotently — the
  append-only, derive-on-read pattern. The plan suspends at the target:
  each due month funds from the fund's balance as of that 1st, the
  crossing month's contribution is capped at the remaining amount so the
  fund lands exactly on target, and months spent at target are forgiven
  rather than owed — a drawdown resumes funding from its own month
  forward at the normal pace. An open-ended fund (no target) has no
  finish line, and a goal's target date is a deadline, never a kill
  switch: a dated goal past its date keeps funding until it hits the
  target or its plan is paused.
- `POST /api/funds` — creates a fund. `kind` is derived, never sent: a
  blank `target_date` means a sinking fund, a set date means a goal; a
  blank `target_amount` is an open-ended fund (no finish line, so no
  progress percent — just a parked balance and a monthly plan). An
  optional `emoji` labels the fund like accounts and categories have.
  Creation appends a zero `fund_entry` dated today, the way a new account
  gets its first balance row — the anchor the monthly-plan catch-up dates
  its contributions from, even before any saved amount is posted.
- `POST /api/fund-entries` — appends a dated balance row for a fund
  (append-only, like `balance_entry`); the latest entry is the fund's
  balance and earlier rows are kept as history. Entries carry a `source`
  telling their kinds apart: `'spend'` for the drawdown behind a
  fund-funded expense, `'monthly_plan'` for an automatic contribution,
  null for the hand-entered rows this endpoint appends.
- `PUT /api/funds/{id}` — revises the fund's monthly plan in place —
  the fund row is a dimension, like a category rename, so the
  append-only entry history is untouched. A null plan (0 is normalized
  to NULL, so "$0 / mo" never renders) pauses funding without
  archiving: the balance stays parked and the fund drops out of the
  monthly catch-up until a new plan is set. A negative plan is a 422;
  an unknown fund is a 404.
- `POST /api/funds/{id}/archive` — soft remove, like envelope
  archiving: flips `fund.active` to 0 so the fund drops out of the
  funds list, the dashboard parked total, and the safe-to-spend
  "Funded from" options, and appends a final zeroing `fund_entry`
  (balance 0, dated at archive time; skipped when the balance is
  already zero, so archiving twice appends nothing) — funds are
  virtual earmarks over real cash, so no dollars move: the parked
  balance simply reads as spendable again, and any query summing
  `fund_entry` stays honest without joining on `fund.active`. No hard
  delete — past expense lines keep their `fund_id` and the
  contribution history survives.

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
  then to zero. `?age=` evaluates a what-if age, defaulting to the
  current age derived from the backend's sanitized `BIRTHDATE`
  constant (January 1, 1988 — deliberately not a real birthday; no
  birthdate lives in the schema), and `?spend=` tests a what-if level
  (it also stands in for
  a missing spend plan). Each step reports gross, tax, net, and any
  gate note; whatever the waterfall cannot deliver comes back as
  `shortfall` — never a naive 4%-per-bucket draw. Null until a tax
  year, a balance, and a spend target exist. Deliberately federal-only
  and one-pass in v1: no state tax, no NIIT, and Social Security
  reduces the gap without counting as ordinary income.

The forecast slice (the third Plan engine):

- `GET /api/forecast` — the year-by-year longevity simulation, from
  the birthdate-derived current age to 100 in today's dollars. Each
  year the buckets grow by the real
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
  sliders never persist. The response carries the resolved inputs
  (including the derived `start_age`),
  the per-bucket series with each year's SS income, the run-out age
  (the first unmeetable year; null when the money lasts), the age-100
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
  projected age-100 balance from `GET /api/forecast` (muted until the
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
  trims the headline. Under the envelopes, the "Money in funds" card makes
  the formula's money-in-funds term visible where spending decisions
  happen: the total parked in its header and one row per active fund with
  its emoji-led name, available balance, and "$X / mo" plan — blank for a
  fund saving at no set pace — straight from the same `GET /api/funds`
  list the forms already load. Beside them, "Add a spending item" (amount, category,
  and funded-from: the month's discretionary budget or any active fund via
  `GET /api/funds` — funds labeled `emoji + name` like the categories;
  choosing a fund reveals the matching
  Cash-Plus-withdrawal reminder) posts to `POST /api/expenses`, and "Add a
  funding item" (amount, funds month — the current or next two, so a
  paycheck can prepay next month — and source) posts to `POST /api/income`.
  Every submit refetches the budget month, so the hero and envelopes always
  show the API's figures rather than client-side math — and adding a
  spending item refetches the funds list too, so a fund-funded spend's
  drawdown lands on the "Money in funds" card immediately.
- **Funds & goals** (<http://localhost:5173/funds>) — sinking funds and
  dated goals as one concept, in a single card: a header with the total
  parked and the "notes auto-calculate" hint, the dashed **+ New fund or
  goal** form (name, a curated emoji select, target, saved, target date —
  blank = sinking fund — and $/month), then each fund with its emoji-led
  name, meta line, `saved / target` amount, progress bar, the
  server-derived note from `GET /api/funds`, rendered verbatim, an Edit
  button that opens an inline $ / month input prefilled with the current
  plan — Save revises it via `PUT /api/funds/{id}` (a blank input pauses
  funding without archiving) and refetches so the note recalculates,
  Cancel closes without a request — and an
  Archive button that retires the fund via `POST /api/funds/{id}/archive`
  and refetches the list — a finished goal disappears from the card, the
  total parked, and the safe-to-spend "Funded from" options, and its
  balance reads as spendable again. Completed funds turn accent green; open-ended funds (no target)
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
  spend plan and balances exist, the view points at Settings & data —
  and when no account is marked investable at all, the empty state says
  so and points at the account Edit instead, since balances alone could
  never light it up.
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
  whole waterfall server-side (the age defaults to the server's
  birthdate-derived current age). Right, the per-bucket rule cards
  and the engine rule: never 0.04 × balance per bucket; solve for
  net spendable. Until tax parameters, a spend target, and balances
  exist, the view points at Settings & data — and when no account has
  a withdrawal priority, the empty state points at the account Edit
  instead.
- **Longevity forecast** (<http://localhost:5173/forecast>) — the
  "does the money last?" view, every figure from `GET /api/forecast`.
  The verdict hero ("You don't run out." / "Lasts to age N", red only
  when the money dies before 90) carries the resolved spend and the
  projected age-100 balance, beside the bridge-to-59½ card — how long
  the taxable buckets last against the bridge to the 401(k) (59½
  minus the derived current age). The balance-by-bucket chart draws
  one CSS stacked bar per simulated year, the current age → 100 with
  axis labels thinned to every fifth age: ETH, brokerage, 401(k), and
  the Social
  Security income sliver at the base, enlarged to a 7px minimum so
  the income stays visible against multi-million balances; hovering
  a bar shows the age, its calendar year, and the exact per-bucket
  dollar breakdown. The
  sensitivity table shows the server's 2–6%-of-net-worth spend levels
  with each outcome (never runs out / tight at 90+ / runs out early)
  and highlights the row nearest the current spend. The assumptions
  card — spend, return, and inflation sliders plus the editable
  Social Security panel (You $/mo, Spouse $/mo, from age) — re-runs
  the whole simulation server-side on every change; the spend
  slider's floor widens so the resolved spend is always reachable.
  All of it is transient what-if: Settings owns config writes. Until
  a tax year, assumptions, a spend target, and balances exist, the
  view points at Settings & data — and when no account has a
  withdrawal priority, the empty state points at the account Edit
  instead.
- **Settings & data** (<http://localhost:5173/settings>) — the config
  home. The Assets and Liabilities cards list every active account's
  emoji, name, and newest ledger balance (walking back through the
  months; liabilities negative in red), each with an add form (name, a
  curated emoji select, and the initial value — later values go through
  the Ledger) and a per-row Deactivate that soft-removes the account
  while its entered history keeps counting. Asset rows also carry an
  Edit that opens the classification form — kind, tax treatment, an
  Investable checkbox, the withdrawal-priority select (1 ETH /
  2 Brokerage / 3 Tax-advantaged), and an access age for retirement
  kinds — saved in place via `PUT /api/accounts/{id}`, so accounts
  created here can feed Guardrails, Withdrawal sourcing, and the
  Longevity forecast; liabilities are never classified. Adding or
  deactivating an account refreshes the header net-worth readout
  immediately, like a Ledger save. Fund rows no longer appear
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

v1.8.0 — The forecast grows up with its owner. The simulation's start
age is no longer a hardcoded 38: the backend derives the current age
from a sanitized `BIRTHDATE` constant (January 1, 1988 — deliberately
not a real birthday; the repo is public) and passes it into the
engine, the response echoes `start_age`, and the sourcing API's
`?age=` defaults to the same derived age — the Withdrawals screen
drops its client-side `DEFAULT_AGE`. The horizon extends from 95 to
100 and the verdict balance moves with it (`balance_at_90` →
`balance_at_100` through the engine, API, and frontend), while the
green/red verdict threshold stays at 90 — lasting into one's 90s
still reads as success. The chart stops sampling twelve 5-year
columns: one bar per simulated year from the current age to 100,
axis labels thinned to every fifth age, and each bar carries a hover
tooltip with the age, its calendar year, and the exact ETH,
brokerage, 401(k), and Social Security dollar breakdown. The bridge
card's "Need to cover" years are now computed as 59½ minus the start
age instead of a literal 21.5.

v1.7.0 — Fund balances finally move. Spending funded from a fund now
draws it down: the expense appends a 'spend' `fund_entry` (balance
minus amount, negative contribution, dated the transaction) in the
same transaction, and overdrawing a fund is a 422. Fund-funded
expenses leave safe-to-spend and the envelope bars alone — migration
0006 filters `v_budget_month`'s spent totals to discretionary lines
and adds `fund_spent` — and monthly plans fund themselves: with no
scheduler in the stack, reading the funds or the budget month applies
each active fund's `monthly_plan` as idempotent catch-up contributions
dated the 1st of each missed month (migration 0007 adds
`fund_entry.source`; fund creation anchors the schedule with a zero
entry), and the month's automatic contributions count against the
headline: `safe_to_spend = baseline − fund_contributions −
total_spent`, because money moved into a fund is parked, not
spendable. The Safe-to-spend screen refetches the funds list after
adding a spending item so the drawdown shows immediately.

v1.6.0 — Safe-to-spend funds card. The hero formula's money-in-funds
term is no longer invisible on the screen where spending decisions
happen: a "Money in funds" card sits under the monthly envelopes with
the total parked in its header and one row per active fund — emoji-led
name, available balance, and "$X / mo" plan, blank for a fund with no
monthly plan. Frontend-only: the card reads the `GET /api/funds` list
the screen already fetches for the "Funded from" options, and the new
`fundRows` view-model reuses the same emoji-name and `$` formatting
helpers as every other fund surface.

v1.5.0 — Fund archiving. Funds & goals gain the retirement path
envelopes got in v1.1.0: `POST /api/funds/{id}/archive` flips the
existing `fund.active` flag and appends a final zeroing `fund_entry`
dated at archive time (skipped when the balance is already zero, so
archiving twice appends nothing), releasing the parked balance back
to spendable while the append-only history stays honest. Archived
funds drop out of the Funds & goals screen, the dashboard "parked
across N funds" total, and the safe-to-spend "Funded from" options;
past expense lines keep their `fund_id`. Each fund card gains an
Archive ghost button — the button style is now a shared component —
that posts the archive and refetches the list.

v1.4.0 — Fund emojis. Funds & goals join accounts and categories in
carrying a user-chosen emoji: migration 0005 adds a nullable `emoji`
column to `fund` (backfilling the seed funds by name), `GET` and
`POST /api/funds` expose and accept it, and the new-fund form gains
a curated fund-themed emoji select. Fund cards on Funds & goals and
the safe-to-spend "Funded from" options now render `emoji + name`
like the Category picker already did; a fund without an emoji keeps
its plain name. Existing funds stay emoji-less for now — there is no
fund edit endpoint yet (#53 tracks the fund lifecycle).

v1.3.0 — Account classification. Accounts created through the UI can
finally participate in the planner: `PUT /api/accounts/{id}` sets
kind, tax treatment, the investable flag, withdrawal priority, and
access age in place (a liability can never be investable or
prioritized), and the Settings Assets rows gain a per-row Edit with
those fields, prefilled from the account. The three Plan pages'
empty states now fetch the accounts and tell apart "config and
balances missing" from "no accounts classified", pointing at the
account Edit instead of Ledger entries when classification is the
real blocker — on a fresh install every account used to sit at the
net-worth-only defaults, leaving Guardrails, Withdrawal sourcing,
and the Longevity forecast permanently null with copy that sent the
user to enter more balances.

v1.2.0 — Ledger backdating. The balance form gains an "As of" date
input (default today), passed through to `POST /api/balance-entries`
as `as_of_date`, so historical balances can be entered from the UI —
backfilling a fresh install's sparkline and YoY figure, or catching up
a missed month, no longer needs curl or the interactive docs. The date
sticks across saves and account switches so a backfill month can be
entered account by account. No backend changes: the append-only model
already handles out-of-order rows — `v_account_monthly` picks the
latest row per account per month and carry-forward fills the gaps.

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
