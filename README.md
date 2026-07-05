# Sereno

**v0.11.0**

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
- **Ledger entries** — one row per month per account. Enter fund balances, retirement,
  and ETH holdings (quantity × price auto-translates to USD); the latest entry in a month
  wins, and earlier rows are kept as history.
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

- `GET /api/accounts` — the account dimension rows (name, kind, liability and
  investable flags).
- `POST /api/balance-entries` — appends a dated balance row for an account.
  Send `balance_usd` for USD accounts, or `quantity` + `unit_price` for
  ETH-style holdings (USD is derived as quantity × price). Rows are never
  updated — history is kept.
- `GET /api/ledger` — one group per month, newest first, with the canonical
  per-account balances (latest entry in a month wins) and that month's net
  worth.
- `GET /api/net-worth` — current net worth, year-over-year change vs. the same
  month a year earlier (`null` until 12 months of history exist), and the
  last-12-months series for the sparkline.

The budget slice:

- `GET /api/categories` — the category dimension with each envelope's planned
  amount for a month (`?month=YYYY-MM`, default the current month). Plans are
  effective-dated: the latest `category_plan` row on or before the month wins.
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
  every visit as items are added elsewhere. The Spend guardrail and
  Longevity cards remain static placeholders until their Phase 2 slices
  land.
- **Ledger entries** (<http://localhost:5173/ledger>) — the monthly balance
  table (one row per month, newest first, current month highlighted; the two
  cash accounts share one column and the mortgage shows as a negative figure)
  beside the "Update this month's balances" form. Fund and retirement balances
  are entered in USD; ETH is entered as quantity + $/ETH with a live
  quantity × price readout, and every edit recomputes the displayed net worth
  before anything is saved. Saving appends one dated row per account via
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
- **Settings & data** (<http://localhost:5173/settings>) — the config
  home. Accounts & buckets lists every account's newest ledger balance
  (walking back through the months; liabilities negative in red) with
  each fund beneath, above the Assumptions summary (return, inflation,
  ETH growth, planned spend), the Social Security panel (You/Spouse
  $/mo and start age), the latest year's tax parameters (LTCG ceilings,
  NIIT, standard deduction, ordinary brackets), and the dark append-only
  data-model note pointing at `docs/design/schema.sql`. Settings is
  where config changes are *persisted*: saving the Assumptions or
  Social Security cards appends new rows effective today (only configs
  whose values actually changed are posted), the tax card's Edit
  revises the displayed year in place, and + Add creates the next year
  prefilled from the current one. The Forecast screen's future sliders
  stay transient what-if overrides.

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

v0.11.0 — Planning config. The four config tables now have typed
endpoints — assumptions, spend plan, and Social Security resolve the
latest effective-dated row on or before today (per person for Social
Security) and only ever append; tax parameters are per-year rows with
POST to load a year and PUT to reconcile it against the CPA's numbers.
The Settings & data screen replaces its stub (see
[Screens](#screens)): accounts & buckets with live balances, editable
Assumptions and Social Security cards that append dated rows, the
tax-parameter editor, and the append-only data-model note. This gives
the three Plan engines one tested input source. The Dashboard v2
landing view, the Funds & goals screen, the Safe-to-spend screen, the
budget API, the Ledger entries screen, the balances API, seed data,
the append-only schema (migrations at startup), the typed SQLite
connection module, and the app shell landed in earlier releases.
Remaining work:

1. Guardrails → withdrawal sourcing engine → longevity forecast

## License

MIT — see [LICENSE](LICENSE).
