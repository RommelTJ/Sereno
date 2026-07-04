# Sereno

**v0.4.0**

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

The balances vertical slice (interactive docs at <http://localhost:8000/docs>):

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

### Screens

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

v0.4.0 — balances and net worth API. The first vertical-slice backend: typed
FastAPI endpoints for the account dimension, append-only balance entries
(USD sent directly or derived from ETH quantity × price; rows are never
updated), the monthly ledger grouped by month with net worth per row, and
the net-worth summary (current, year-over-year vs. the same month a year
earlier, last-12-months sparkline series) — see
[API endpoints](#api-endpoints). All reads go through the schema's SQL views,
so "latest entry in a month wins" lives in one place. Seed data, the
append-only schema (migrations at startup), the typed SQLite connection
module, and the app shell with routed stub pages landed in earlier releases.
Remaining work, roughly in this order:

1. Dashboard and Ledger screens reading from these endpoints
2. Safe-to-spend, envelopes, and spending/funding entry
3. Funds & goals
4. Guardrails → withdrawal sourcing engine → longevity forecast

## License

MIT — see [LICENSE](LICENSE).
