# Sereno

**v3.14.0**

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
- **Ledger entries** — one row per month per account, the twelve newest months on
  screen and older ones loaded as you scroll. Pick any active account and
  enter its value (ETH as quantity × price, auto-translated to USD); the latest entry
  in a month wins, earlier rows are kept as history, and balances carry forward until
  the next entry. Every figure carries its change from the previous month
  beside it — green where the month went the right way, red where it
  didn't — and the brokerage funds carry a derived subtotal column.
- **Safe-to-spend** — total cash − bills due − money in funds. Monthly category envelopes
  with progress bars; overspending is allowed and simply reduces the headline number.
- **Funds & goals** — sinking funds and dated goals as one concept. Notes are
  auto-derived, never hand-typed: "needs $X/mo to finish by June", "~2 yrs to target",
  "fully funded".

### Plan

- **Spending guardrails** — Guyton-Klinger withdrawal-rate bands (Cut / Hold / Raise)
  around your at-retirement anchor rate, measured against the trailing year of
  *actual* spending once a year of history exists (the planned target stands in
  until then, labeled), with a live spend slider and explicit raise/cut trigger
  portfolios. A drawdown-start date turns the zone from a readiness check into
  a live control and stamps the anchor rate from actuals the moment real
  drawdown begins.
- **Withdrawal sourcing** — a tax-aware sequencing waterfall: fill the spending gap by
  selling ETH to exhaustion first — tax-free inside the 0% long-term-capital-gains
  headroom, then at 15% on the gain — then taxable brokerage, then the 401(k), then
  HSAs last and untaxed. Every gate is the account's own `access_age`,
  read against its owner's age, so two people of different ages unlock on different
  years. Solves for *net spendable*, not a naive 4%-per-bucket draw.
- **Mortgage** — the loan's terms as effective-dated config, and the payoff date
  solved from them rather than typed: balance from the ledger, rate, and P&I plus
  extra principal give the month the payment stops, the age then, the interest
  left, and what the extra buys against the P&I-only schedule. Escrow is stored
  apart because it survives payoff, and the payment's real value at payoff makes
  the nominal-vs-real gap visible instead of implicit.
- **Longevity forecast** — a year-by-year simulation from the current age (derived
  from a sanitized birthdate constant) to 100, charted one bar per year by bucket
  (ETH, brokerage, 401(k), HSA, Social Security) with a hover breakdown per bar, led by
  that year's portfolio total and its change against the year before. Every bar is
  that year's opening balance — its January 1 — so the first is the money actually
  held today, labeled "Today", and the projected age-100 figure in the verdict is
  exactly the rightmost bar. Verdict
  up front: "You don't run out" or "Lasts to age N", plus a sensitivity table across
  spend levels and live sliders for return, ETH growth, inflation, and Social
  Security assumptions. Planned one-off purchases (a house in 2036, a car in 2041)
  drop dated lumps into the simulation as transient what-ifs, and a max-affordable
  solver answers "how much can I afford in year N?" — naming whether the year's own
  liquidity or long-run longevity is the ceiling. Spending needn't be flat: an
  age-banded spend schedule — "from year, to year, annual amount" rows in today's
  dollars — steps the simulation up through peak years and down when known costs
  end, with uncovered years falling back to the plan's target, editable inline as
  rows or a draggable step-chart and saveable to the plan.

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
docs/api.md         every HTTP route and what it returns
docs/screens.md     what each view shows and what it reads
CHANGELOG.md        every release, newest first
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

Both services carry `restart: unless-stopped`, so a long-running deployment
comes back on its own after a crash or a host reboot — and stays down once you
stop it deliberately with `docker compose down` or `docker compose stop`.

### Deploying behind a reverse proxy

A long-running deployment is a plain clone of this repo, updated with
`git pull && docker compose up -d --build`. Everything host-specific lives
in `compose.override.yaml` — gitignored, and merged automatically by
Compose — so `git status` on the deploy box stays clean, real drift stays
visible, and a reflexive `git reset --hard` can't delete the deployment's
config. A typical override drops the host port mappings and joins the
frontend to the proxy's shared network:

```yaml
services:
  frontend:
    ports: !reset []
    networks:
      - default
      - proxy
    environment:
      SERENO_PUBLIC_HOST: finance.example.com

  backend:
    ports: !reset []

networks:
  proxy:
    external: true
```

- `SERENO_PUBLIC_HOST` is the public hostname the proxy serves the app as.
  `frontend/vite.config.ts` reads it to allow the host (Vite's
  DNS-rebinding protection answers unknown hosts with a 403) and to point
  HMR at it over `wss` on 443, where the proxy terminates TLS. Unset — the
  local-dev and CI case — the server config is exactly what it was before
  the variable existed.
- `!reset []` drops the base file's port mappings, so the services are
  reachable only through the proxy. The tag needs Compose >= 2.24.
- Environment maps merge per key, so the base file's `SERENO_API_URL`
  survives the override untouched.

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

Every route, what it returns, and why — in [docs/api.md](docs/api.md).
Interactive docs at <http://localhost:8000/docs>.

### Screens

What each view shows and which endpoints it reads — in
[docs/screens.md](docs/screens.md).

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

Every release and what it changed — in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
