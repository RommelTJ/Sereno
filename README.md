# Sereno

**v0.2.0**

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

v0.2.0 — database layer. The append-only schema from
[docs/design/schema.sql](docs/design/schema.sql) — 13 tables, indexes, and the
`v_account_monthly` / `v_net_worth` / `v_budget_month` views — is applied by a
numbered-migration runner at app startup, so the SQLite file in the `sereno-data`
Docker volume is always current. A typed stdlib-`sqlite3` connection module
(foreign keys on, rows addressable by column name) is exposed to FastAPI via
dependency injection for the upcoming data endpoints. Liability balances are
entered as positive numbers; `v_net_worth` subtracts them. The app shell (sidebar,
header, and routed stub pages for all eight views) and the monorepo skeleton landed
in earlier releases. Remaining work, roughly in this order:

1. Dashboard reading from the DB
2. Ledger entry and monthly net-worth views
3. Safe-to-spend, envelopes, and spending/funding entry
4. Funds & goals
5. Guardrails → withdrawal sourcing engine → longevity forecast

## License

MIT — see [LICENSE](LICENSE).
