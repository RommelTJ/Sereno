# Sereno

**v3.11.0**

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
- **Withdrawal sourcing** — a tax-aware sequencing waterfall: fill the spending gap from
  ETH first inside the 0% long-term-capital-gains headroom, then taxable brokerage, then
  the 401(k), then HSAs last and untaxed. Every gate is the account's own `access_age`,
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
  that year's portfolio total and its change against the year before. Verdict
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

Interactive docs at <http://localhost:8000/docs>.

The balances slice:

- `GET /api/accounts` — the account dimension rows (name, emoji, kind,
  tax treatment, owner, liability and investable flags, withdrawal
  priority, and access age; inactive accounts stay listed with
  `active: false` so
  history keeps its labels), ordered by `sort_order` then id, so every
  consumer — the ledger columns, the balance form picker, the Settings
  cards — renders the user-defined order.
- `POST /api/accounts` — creates an asset or liability: inserts the
  `account` row (name, emoji, `is_liability`; kind `other`, net-worth-only
  until classified) plus an initial `balance_entry` dated today. The
  initial value is set here only — later values go through the ledger. A
  blank name or negative initial value is a 422; a name matching an active
  account (case-insensitive) is a 409. Liabilities are stored positive and
  displayed negative.
- `PUT /api/accounts/{id}` — classifies an account for the planners:
  kind, tax treatment, the investable flag, withdrawal priority (1 ETH,
  2 brokerage, 3 401(k), 4 HSA), access age, and owner (`you`, `spouse`,
  or `joint`), revised in place — the account row is a dimension, like an
  envelope rename, so history is unaffected. This is what lets an account
  created through the UI feed Guardrails (investable), Sourcing, and
  Forecast (priority buckets). Owner is what decides *whose* age a gate is
  read against, so it matters wherever `access_age` is set. A liability
  can never be investable or hold a priority; unknown kinds, treatments or
  owners, out-of-range priorities, and negative access ages are 422s.
- `PUT /api/accounts/order` — persists a user-defined display order:
  the body's `ids` must be exactly the active account ids (a 422
  otherwise), and each id's position becomes its `sort_order`. Accounts
  created afterwards append at the end (`MAX(sort_order) + 1` — SQLite
  sorts NULLs first, so an unset order would jump to the top), and
  inactive accounts keep their stale order, since they never render in
  an ordered surface.
- `POST /api/accounts/{id}/deactivate` — soft remove: the account drops out
  of the pickers and stops carrying forward, but the months it was really
  entered keep counting in net worth and its name frees up for reuse. No
  hard delete — history is append-only.
- `POST /api/balance-entries` — appends a dated balance row for an account.
  Send `balance_usd` for USD accounts, or `quantity` + `unit_price` for
  ETH-style holdings (USD is derived as quantity × price). Rows are never
  updated — history is kept.
- `GET /api/ledger` — one page of months, newest first: `months`, one group
  per month with the canonical per-account balances and that month's net
  worth, plus `has_more`. A month's balance for an account is the latest
  entry **on or before** the month's end (carry-forward), so an account
  entered in January still counts in March; within a month the latest entry
  wins. `limit` (default 12, max 120) sizes the page and `before=YYYY-MM`
  asks for the months older than that one, so a caller walks back through
  history by handing back the page's oldest month; `has_more` says when to
  stop. A page is whole months — one month is one row per account, so a row
  limit would cut a month in half — which is also what bounds the work: the
  monthly view joins every month against every entry, so an unbounded read
  grows quadratically with history.
- `GET /api/net-worth` — current net worth, year-over-year change vs. the same
  month a year earlier (`null` until 12 months of history exist), and the
  last-12-months series for the sparkline.

The quick links slice (the Ledger's bookmarks):

- `GET /api/quick-links` — the user-managed institution URLs shown
  beside the Ledger's balance form, ordered by `sort_order` then id.
- `POST /api/quick-links` — creates a link. Label and URL are stripped
  and must be non-blank (a 422 otherwise); a URL without a scheme gets
  `https://` prefixed — host, path, and query stored verbatim — so it
  opens absolutely instead of resolving relative to the app. New links
  append at the end of the order.
- `PUT /api/quick-links/order` — persists a user-defined display
  order, the mirror of the account and category reorder endpoints:
  the body's `ids` must be exactly the quick link ids (a 422
  otherwise), and each id's position becomes its `sort_order`.
- `PUT /api/quick-links/{id}` — revises a link's label and URL in
  place, under the same validation as creation.
- `DELETE /api/quick-links/{id}` — removes the link outright, the
  API's one hard delete: quick links are navigation utilities with no
  facts attached, so there is no history for a soft flag to protect.

The budget slice:

- `GET /api/categories` — the category dimension with each envelope's planned
  amount for a month (`?month=YYYY-MM`, default the current month). Plans are
  effective-dated: the latest `category_plan` row on or before the month wins.
  Ordered by `sort_order` then id, like accounts, and the budget month's
  envelope list follows the same order.
- `POST /api/categories` — creates an envelope: inserts the `category` row
  (name, emoji) plus its initial `category_plan` row (`effective_month`
  defaults to the current month). A blank name or negative planned amount is
  a 422; a name matching an active category (case-insensitive) is a 409.
- `POST /api/categories/{id}/plan` — appends a new effective-dated plan row
  (the append-only config pattern — revisions never update in place; the
  latest row per month wins). New and revised envelopes flow into the
  Safe-to-spend select, envelope bars, and budget-month math with no
  further wiring.
- `PUT /api/categories/order` — persists a user-defined envelope order,
  the exact mirror of `PUT /api/accounts/order`: `ids` must be exactly
  the active category ids, positions become `sort_order`, and new
  envelopes append at the end.
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
  the transaction's month; pass a later month to prepay. An optional `note`
  ("Anniversary dinner") titles the row in the activity feeds, with the
  category moving to the subtitle. An optional `pending` flag (default
  false) marks a provisional amount — Lyft consolidates a day's rides
  into one charge, bars add tips after settlement — rendered as a ⚠️
  beside the row's title until the settled amount is trued up; pending
  lines still count in every total, since the money has already left
  and the known amount is a floor. `funded_from` is
  `discretionary` or `fund` (then `fund_id` is required, and `category_id`
  is normally omitted — the fund itself says what the spend was for, and
  the envelope math never counts fund-funded lines). Fund spending
  draws the fund down in the same transaction: a `fund_entry` with
  `source = 'spend'`, the balance minus the amount, and a negative
  contribution is appended, dated the transaction — and an expense that
  exceeds the fund's balance is a 422, since a fund is an earmark over
  real cash.
- `POST /api/income` — appends an income/funding event (paycheck, transfer,
  staking, …). `budget_month` is the month the inflow funds — the seed's
  Jun 27 paycheck funds July. An optional `source_label` ("Spouse paycheck")
  is the row's display title — the context the `source` enum can't carry —
  and `note` is a true note beside it; migration 0008 moved the old
  title-style notes into `source_label`, so existing rows kept their titles.
  `pending` marks a provisional inflow the same way — flagged with ⚠️ in
  the feed while still counting toward the month's funding.
- `PUT /api/expenses/{id}` / `DELETE /api/expenses/{id}` — corrects or
  removes a spending line: pending charges settle (Lyft consolidates a
  day's rides into one charge, bars add tips) and typos happen, and
  nothing references an expense row, so the edit revises in place and the
  delete is a hard delete. The edit is a full replace under the create
  body's validation, `budget_month` and `pending` included — an edit
  that omits `pending` clears the flag, which is how a settled charge
  drops its ⚠️ — so an item can be
  reassigned to the right month (the prepay pattern). A fund-funded row
  never touches its paired `'spend'` entry — each fund entry snapshots a
  balance, so removing a mid-chain row would not restore it; instead a
  compensating `'spend'`-source entry is appended, dated today (snapshots
  resolve newest-first, so a backdated correction would corrupt the
  chain): a full reversal on delete or a funding-source change, a single
  delta on a same-fund amount edit, with the overdraw guard re-applied
  either way — a 422 writes nothing. `'spend'` entries stay out of the
  headline, the feed, and the budget-year actual, so a correction never
  moves safe-to-spend and nothing double-counts.
- `PUT /api/income/{id}` / `DELETE /api/income/{id}` — the same for income
  events: a full replace (an omitted title or note really clears),
  `budget_month` defaulting from the txn date, and a hard delete — the
  month's funding baseline follows immediately.
- `GET /api/budget-month` — the computed month (`?month=`, default current):
  per-category planned/spent/remaining envelopes (overspend is allowed and
  goes negative), the Safe-to-spend headline
  (`baseline − fund_contributions − total_spent`, where the baseline is the
  month's stored funding — never recomputed from live spend), and the
  activity list — expense lines, income events, and fund entries merged
  newest first. A category-less fund-funded expense carries its fund's
  name in the category slot — the fund itself says what the spend was
  for; rows carrying both keep the category name. A fund entry carries
  its fund's name and its source, and
  only `monthly_plan` and `top_up` rows are listed — exactly the set the
  `fund_contributions` headline subtracts, so the feed reconciles with the
  number above it: a `spend` drawdown would double-count its expense line,
  and hand-entered rows are balance restatements that never touched the
  headline. Having no `budget_month` column, fund entries scope by
  calendar month, the way the headline already does. Every activity row
  carries the fields its edit form pre-fills (category, fund, account,
  fixed flag, budget month, tax treatment, and the pending flag behind
  the feed's ⚠️), so a tap costs no GET-by-id
  round trip; fund rows carry them null — they have no edit affordance.
  Fund-funded expenses stay out of `total_spent` and the envelope bars —
  they were paid from parked money, and the fund's drawdown already
  released the earmark — and `fund_contributions` is the month's automatic
  monthly-plan funding plus its one-time top-ups: money moved into a fund
  is parked, so it stops being spendable the moment it lands, and a
  release's negative contribution reads as spendable again.
  `rollover_assigned` sums the month's `rollover` entries — last
  month's leftover being given a job. It never joins the safe-to-spend
  subtraction, and rollover entries stay out of the feed: their
  visibility surfaces are the paged-back previous month's own hero
  (its closing safe-to-spend is the leftover) and the fund's entry
  history — the field rides in the response unread by the frontend
  since the leftover line retired.
  Reading the budget month applies
  the monthly-plan catch-up itself, so the headline never misses a
  contribution the funds list hasn't been asked for yet.
- `GET /api/budget-year` — the yearly plan-vs-actual report (`?year=`,
  default the current year): one row per month with `planned`
  (`annual_target / 12` from the spend plan effective for that month —
  the latest row on or before the month's end, so a mid-year revision
  splits the year instead of repricing January), `actual` (discretionary
  expense lines plus monthly-plan and top-up fund contributions — the
  same money-leaving-the-spendable-pool definition as the Safe-to-spend
  headline, so fund-funded lines never count and a release reads as
  money back), `variance` (planned − actual, positive = under plan), and
  `cumulative_variance`, the within-year running total. Months outside
  data-start (the first logged expense's budget month, echoed as
  `data_start`) → the current month are entirely null — the app cannot
  distinguish "no data" from "spent nothing", so a partial year stays
  visibly partial — and the current month rides along flagged
  `provisional`, since it undercounts until it closes. Reading the
  report applies the monthly-plan catch-up, like the budget month, so
  the current month's automatic funding always counts.
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
  append-only, derive-on-read pattern — and concurrency-safely: parallel
  first-of-month reads race the same catch-up on separate connections,
  and a partial unique index (one `monthly_plan` entry per fund per
  date) makes the losing insert a silent no-op, so the month is funded
  exactly once however many requests trigger it. The plan suspends at
  the target: each due month funds from the fund's balance as of that
  1st, the crossing month's contribution is capped at the remaining
  amount so the fund lands exactly on target, and months spent at
  target are forgiven
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
  null for the hand-entered rows this endpoint appends — invisible to
  the safe-to-spend formula by design, which is why the Funds & goals
  Correct balance action posts them: the tracker restates without the
  headline moving.
- `PUT /api/funds/{id}` — revises the fund's `name`, `emoji` and
  `monthly_plan` in place — the fund row is a dimension, like a category
  rename, so its identity fields are mutable and the append-only entry
  history is untouched. The update is partial: every field is optional
  and only those the body carries are written, so a plan-only edit keeps
  the name and a rename keeps the fund funding. An explicit null emoji
  clears it; an omitted one keeps it. A null plan (0 is normalized to
  NULL, so "$0 / mo" never renders) pauses funding without archiving:
  the balance stays parked and the fund drops out of the monthly
  catch-up until a new plan is set. A blank name or a negative plan is a
  422; an unknown fund is a 404.
- `POST /api/funds/{id}/top-up` — a one-time move between the month's
  safe-to-spend and the fund, the one-off sibling of the automatic
  monthly contribution: appends a `fund_entry` with the delta as its
  contribution and `source = 'top_up'`, the new balance computed
  server-side from the latest entry — nobody types an absolute figure.
  A positive amount parks money (the headline falls the moment it
  lands); a negative amount is a partial release, raising the headline
  back. A release may not exceed the fund's balance (a 422, the mirror
  of the overdraw guard on fund-funded expenses) — but a top-up beyond
  the month's remaining safe-to-spend is allowed, like overspending is
  everywhere else. An optional `source` switches the entry's kind:
  `'top_up'` (the default) or `'rollover'`, which assigns last month's
  leftover — the contribution is recorded identically, but the
  headline, the activity feed, and the budget-year actual all filter
  on `('monthly_plan', 'top_up')`, so the current month is never
  charged for money the old month already earned; any other value is
  a 422. An optional `as_of_date` (default today) lands the move in
  the calendar month it belongs to — the headline, the feed, and the
  budget-year actual all scope fund entries by calendar month, so a
  park recorded late charges its own month and a release dated into a
  coming month credits that month's headline, not today's. The date
  may not precede the fund's latest entry (a 422): entries snapshot
  absolute balances resolved newest-first, so a mid-chain insert
  would silently drop out of the fund's balance. Due monthly-plan
  contributions through the date are applied before the entry lands,
  so a move dated on a 1st can never swallow that month's planned
  contribution. A zero amount or an archived fund is a 422; an
  unknown fund is a 404.
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
  every raise, cut, and revised estimate stays queryable history. The
  spend plan also carries an optional `drawdown_start` — the date real
  drawdown begins, set once and usually staged ahead, which gates the
  guardrails' readiness-vs-live status and the initial-rate stamp.
- `POST /api/tax-params` — loads a new tax year (a duplicate year is a
  409). `PUT /api/tax-params/{year}` revises that year in place —
  `tax_param` is keyed by year, the one config table that replaces
  rather than appends.
- `GET /api/mortgage` — the mortgage's terms on the same effective-dated
  rule (`null` until entered), plus a `derived` block solved from them
  and the linked account's newest ledger balance: the balance and its
  date, `remaining_months` and `remaining_interest`, `payoff_date` (the
  first of the month the last payment lands in) and `payoff_age` from
  the same sanitized birthdate the other planners use, `months_saved`
  and `interest_saved` against the P&I-only schedule, and
  `payment_real_at_payoff` — P&I plus extra deflated by the inflation
  assumption. Escrow is stored but never amortized: property tax and
  insurance pay down no principal and keep running after payoff, so
  folding them in would both shorten the schedule and overstate the
  relief. `derived` is `null` when the account has no balance yet or the
  payment cannot cover one month's interest; `months_saved` alone is
  `null` when P&I would never amortize, there being no baseline to
  measure against. No maturity date is stored — any date typed by hand
  goes stale the moment the extra payment changes.
- `POST /api/mortgage` — appends a revision, so a refinance and every
  change to the extra payment stay queryable. The linked account must
  exist (404) and be an active liability (422); a negative rate, a
  non-positive P&I, or negative extra or escrow is a 422. `annual_rate`
  is a fraction (`0.03`), and the money columns stay dollars rather than
  the ledger's integer cents — config rows are projection inputs, not
  append-only chains that must sum exactly.
- `GET /api/spend-bands` — the age-banded spend schedule: the latest
  version effective on or before today (same-day re-saves win by
  insertion order, future-dated versions stay staged), returned as its
  band rows ordered by start year — inclusive calendar-year ranges in
  today's dollars, a null `end_year` meaning open-ended, each carrying
  the note that keeps the plan re-readable months later. An empty list
  means no schedule: unconfigured and cleared read the same, since both
  mean flat spending at the plan's `annual_target`.
- `POST /api/spend-bands` — appends a whole schedule version
  atomically: a version row plus its band rows, so two same-day saves
  stay distinct and an empty `bands` list is the persistent "back to
  flat". Overlapping bands are rejected naming both rows ("bands
  2031-2040 and 2035+ overlap" — ends are inclusive, so adjacency is
  legal), as are a band ending before it starts, negative amounts,
  bands entirely in the past (a band that merely *started* in the past
  keeps covering this year as the schedule ages forward), and starts
  beyond the age-100 horizon; a rejected save writes nothing, not even
  the version row.

The guardrails slice (the first Plan engine):

- `GET /api/guardrails` — the Guyton-Klinger evaluation: the withdrawal
  rate (spend ÷ the latest month's investable total, every
  `is_investable` account), the guardrails at the stored at-retirement
  `initial_rate` × (1 ± the configured band), the zone (`cut` above the
  upper rail, `raise` below the lower, else `hold` — the ±band is the
  trigger, the ~10% change is the response, never a reset to the band),
  the raise/cut trigger portfolios, and the 4% rate as a sanity
  ceiling, not a binding rule. Guardrails are a *monitoring* tool, so
  the default tested spend is the trailing twelve complete months of
  actual spending — discretionary lines plus fund outflows, never fund
  contributions (outflows are the realisation of the plan the
  contributions describe; counting both would double-count), and
  funding source is deliberately ignored so the measure stays
  continuous when spending shifts from a pre-funded cash buffer to
  portfolio sales, where literal withdrawals would read 0% and then
  spike. Until twelve complete months of history exist the plan's
  `annual_target` stands in; `spend_source` (`actual` / `target` /
  `what_if`) and `spend_months` label the figure so a short window is
  never dressed up as a year of data. `?spend=` evaluates a what-if
  level. The denominator excludes non-investable cash on purpose:
  sinking-fund balances are earmarked obligations, not retirement
  assets, so a buffer set aside for near-term spending never counts as
  backing that spending — and the raise/cut triggers (spend ÷ rail)
  now drift as actual spending moves, damped by the trailing window
  and expected rather than a bug. The spend plan's effective-dated
  `drawdown_start` (set once, usually staged ahead) marks when real
  drawdown begins: before it the zone is a readiness metric, and the
  first read on or after the date appends a stamped plan row whose
  `initial_rate` is the actual rate *as of that date* — deterministic
  however late the server first looks, effective the day it lands so
  it out-resolves the row that scheduled it, exactly once, with a
  later hand revision always winning. `null` until a spend plan with
  an initial rate and at least one balance month exist.

The sourcing slice (the second Plan engine):

- `GET /api/sourcing` — the tax-aware withdrawal waterfall: target net
  spend minus non-portfolio income leaves a gap, filled from ETH
  inside the 0% long-term-capital-gains headroom (the ceiling minus
  taxable ordinary income, converted to sale proceeds through each
  bucket's gain fraction), then taxable brokerage (leftover headroom
  first, then 15% on the gain portion), then the 401(k) with
  ordinary-income treatment (the unused standard deduction shelters the
  first dollars, then a walk up the year's brackets), then HSAs, which
  come out whole — no gain to realize, no ordinary income to stack.
  Each bucket is gated by its own `access_age`, whatever its tax
  treatment: a locked bucket draws nothing, reports `locked until age
  N`, and leaves the 0% headroom intact for the buckets behind it.
  Accounts group into buckets by `withdrawal_priority` and by whatever
  else decides their answer — tax treatment, gate age, and, where there
  is a gate, their owner; a tier that splits names each bucket for the
  part that differs (`401(k) · you`, `401(k) · spouse`). Each account
  contributes its newest balance row from any month and its basis
  from open tax lots, falling back to the balance row's `cost_basis`,
  then to zero. `?age=` is *your* age, defaulting to the one derived
  from the backend's sanitized `BIRTHDATE` constant (January 1, 1988 —
  deliberately not a real birthday; no birthdate lives in the schema);
  your spouse's age slides with it, three years behind per the
  companion `SPOUSE_BIRTHDATE` constant, so one axis carries both
  people's gates. Each step also reports its bucket's `access_age` —
  its owner's own, not one shifted onto your axis. `?spend=` tests a
  what-if level
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
  rate (return − inflation) — except the ETH bucket, which grows at
  its own nominal rate minus inflation when the assumptions row's
  `eth_growth_pct` is set (null keeps it on the blended rate) —
  Social Security (per person, from that
  person's start age) and staking income (while the ETH stake stays
  above $50k) reduce the year's need, and the remainder is withdrawn
  through the sourcing waterfall — the 0% LTCG headroom, the
  gross-ups, and each bucket's own access gate apply every simulated
  year. Growth is
  all gain (basis stays put); sales reduce basis pro-rata. Spend
  defaults to the plan's annual target, the rates to the assumptions
  row, and Social Security to the stored rows; `?spend=`,
  `?return_pct=`, `?inflation_pct=`, `?eth_growth_pct=`, `?ss_you=`,
  `?ss_spouse=`, and
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
  Planned one-off purchases ride along as repeated
  `purchase=year:amount[:ongoing_delta]` params
  (`?purchase=2036:800000&purchase=2041:70000:9000`): each lump lands
  on its year's target inside the same waterfall — so the 0%
  headroom, the gross-up, and the access gates meet the lumpy year
  instead of an amortized smear — and the optional third field raises
  annual spend from that year on (both amounts may be negative: a
  sale, a cost that ends). Years map through the birthdate-derived
  age; malformed, past, or beyond-100 purchases are 422s. The
  response echoes the resolved `purchases`, reports `unaffordable`
  years — a lump the year couldn't deliver is *an unaffordable
  purchase*, not a run-out: the year re-sources without it, the
  verdict stays green, and `(year, age, short)` says how far it
  missed — and carries `baseline` (the no-purchase run-out age,
  age-100 balance, and series, so one call prices the purchases) plus
  `purchase_costs`, one row per purchase simulated with just that one
  dropped. The sensitivity rows simulate with the purchases, like
  every other resolved override. Purchases are transient what-ifs —
  nothing persists. The saved spend-band schedule applies by default:
  each simulated year spends its covering band's amount and uncovered
  years fall back to the resolved spend, compiled in the API layer to
  zero-amount ongoing deltas so the engine never changes and
  `unaffordable[]` semantics are untouched. Repeated
  `band=start_year:end_year:amount` params (an empty end year =
  open-ended) replace the saved schedule wholesale — a lone empty
  `band=` means explicitly flat — under exactly the validation a save
  gets; the response echoes the resolved `bands`, which stay out of
  `purchases[]` and `purchase_costs[]`, and the baseline and cost rows
  keep the schedule while dropping purchases, so a purchase is priced
  against the banded plan. Sensitivity rows scale the whole schedule
  to each level — the baseline at the level, every band at level over
  the resolved spend — so the 2–6% axis keeps meaning "living at this
  overall level" even when the schedule covers every year.
- `GET /api/forecast/max-affordable` — the solver behind "how much
  can I afford in year N?": a binary search to $1,000 over the same
  simulation, under the same transient overrides and fixed
  `purchase=` params (`?year=2036&last_to_age=95&purchase=2041:70000`
  answers "given the car in 2041, how much house in 2036?"). The
  default criterion is never running out; `last_to_age=` relaxes it
  to a target age and `min_balance_at_100=` adds a terminal floor.
  The response carries `max_amount`, the outcome at that ceiling, and
  `binding_constraint` — `purchase_year_liquidity` when the buckets
  reachable that year are the cap (before the gates open, the taxable
  bridge; a later year can raise the ceiling) versus `longevity` when the plan
  fails downstream. Read-only like every planner endpoint: a solve is
  a pure computation, so it stays a GET. Null until the forecast's
  prerequisites exist. The solve runs against the banded plan: the
  saved spend-band schedule applies by default, and the same `band=`
  override rides along beside the fixed `purchase=` params.

### Screens

- **Dashboard** (<http://localhost:5173/>) — the landing view. The net-worth
  hero reads `GET /api/net-worth` live: the current figure, a year-over-year
  pill vs. the same month a year earlier (omitted until 12 months of history
  exist), and a 12-bar sparkline of the last year. Beside it, the
  Safe-to-spend card shows the month's live headline from
  `GET /api/budget-month` with its share of the funding baseline as a
  progress bar, and the Funds & goals card shows the total parked and a
  top-3 mini list (percent to target; an open-ended fund shows its
  balance) from `GET /api/funds` — both deep-link to their views. The
  Budget report card shows the year-to-date cumulative variance vs. plan
  from `GET /api/budget-year` — "$1,850 under plan (4 months)", green
  under plan and red over, always through the last complete month, since
  the in-progress one undercounts — linking to the Budget report view.
  Recent
  activity lists the full current month — spending, income, and fund
  entries merged newest first — as emoji-tile rows with signed amounts
  under a dated month header: income rows titled by their source label
  ("Spouse paycheck") with any note joining the subtitle, expense rows
  titled by their note when one exists (the category moves to the
  subtitle), credits in green, debits in ink, expenses
  whose envelope is over budget in red, pending rows wearing a trailing
  ⚠️ until their provisional amount is trued up, and fund entries on an
  amber tile
  with the fund's own emoji (💰 once the fund is archived), signed by
  their effect on the headline — a contribution parks money, a release
  frees it. A "← May 2026"-style button at the bottom pages the previous
  month in as its own dated section, one month per click, through the
  same `?month=` param, and a mirrored "August 2026 →"-style button at
  the top prepends future months the same way — income can fund a
  future month (the prepay pattern: June pay funds July), and this is
  where those items show up; an empty future month simply renders the
  "No activity yet" state. The feed refreshes on
  every visit as items are added elsewhere. The Spend guardrail card
  shows the live withdrawal rate, mini band, and zone status from
  `GET /api/guardrails` (muted until a spend plan exists) — the status
  wearing a muted "· readiness" suffix until drawdown begins, since
  before that date the zone reports where you'd land, not a live
  trigger — and the
  Longevity card shows the live verdict, the resolved spend, and the
  projected age-100 balance from `GET /api/forecast` (muted until the
  forecast's inputs exist) — every dashboard card now reads the API.
- **Ledger entries** (<http://localhost:5173/ledger>) — the monthly balance
  table (one row per month, newest first, current month highlighted; each
  row dated as month and year — "July 2026" — since the row represents the
  month, never an entry's exact date) with one
  column per active account — assets then liabilities, liabilities negative
  in red — plus the net-worth column, horizontally scrollable as accounts
  grow. Every figure in the table carries its change from the previous
  month inside the same cell, smaller and lighter than the balance it
  annotates: green where the month went the right way, red where it
  didn't. The subtraction happens on the displayed figure, after
  liabilities are negated, so a mortgage paid from 500,000 down to
  495,000 reads as a green +$5,000.00 beside a balance that stays red —
  the red says "this is a liability", not "this got worse". Three states
  stay apart: a signed, colored change; a muted $0.00 where the balance
  genuinely carried forward untouched; and a faint em dash where there is
  no previous month loaded or no earlier entry for that account, since an
  opening balance is not a full-value gain. Directly after the last
  brokerage fund sits a derived **Brokerage** subtotal — the three funds
  are one position mentally and three columns on screen — summing every
  account classified `brokerage_fund`, so a fourth fund joins it on its
  own; it is lighter-headed and tinted to read as derived rather than as
  a holding, and it is invisible to net worth, which the `v_net_worth`
  view sums server-side from real account rows. On wide screens the balance form's column pins at its designed
  width and the table takes every further pixel the widened shell
  supplies, so the columns fit without scrolling at typical account
  counts. The table opens on the twelve newest months and loads older ones a
  page at a time: a sentinel row below the last month, watched with an
  `IntersectionObserver` against the viewport, so a touch flick pages the
  same as a wheel. A loading row shows while a page is in flight, and both
  row and observer go away once the oldest month is on screen. Beside it, the "Update this month's balances" form: an account picker
  over the active accounts with a single value input prefilled from the
  newest month (the ETH account swaps to quantity + $/ETH inputs with a live
  quantity × price readout), an "As of" date defaulting to today — pick an
  earlier date to backfill history or catch up a missed month, and the date
  sticks across saves so a backfill month can be entered account by
  account — and a live net-worth figure that tracks the
  draft before anything is saved. Saving appends one dated row via
  `POST /api/balance-entries` — the latest entry in a month wins and earlier
  rows are kept as history — then the table and the header net-worth readout
  refresh from the API. Below the form, the Quick links card lists the
  user's institution URLs from `GET /api/quick-links` — one click per site
  whose balance is being copied in, each opening in a new tab — managed on
  Settings & data and absent entirely while no links exist.
- **Safe-to-spend** (<http://localhost:5173/safe-to-spend>) — the daily-use
  view. A month pager sits above everything — back/forward arrows around
  the viewed month's label — and steps the entire view one month at a
  time, uncapped in both directions, through the same
  `GET /api/budget-month?month=` param the view already read: the hero,
  the envelopes, the funds card's context, both add-forms, and the
  activity feed all follow the viewed month, so how the envelopes stood
  in any past month is one tap away — and last month's closing
  Safe-to-spend, the old leftover-line question, is simply the previous
  month's hero. The dark hero shows the viewed month's headline from
  `GET /api/budget-month` (stored funding baseline − total spent) with the
  "total cash − bills due − money in funds" formula pill, above the monthly
  envelopes card: one progress bar per category, "spent · left" while under
  budget, "$spent of $budgeted · $X over" in red once over — overspending
  is allowed and simply trims the headline. Every envelope row is a tap
  target: tapping one filters the Activity feed to that envelope's own
  expenses — income, fund entries, and fund-funded lines belong to no
  envelope, so they drop out — with the
  selected row tinted, a "Filtering: 🛒 Groceries ✕" chip in the Activity
  header whose tap clears the filter, a re-tap of the same envelope
  toggling it off, and a tap of a different envelope replacing it, one
  filter at a time — paging months clears it, since an old month may not
  carry the envelope; a filtered month with nothing left says "No 🛒
  Groceries activity this month." instead of claiming no activity exists.
  Under the envelopes, the "Money in funds" card makes
  the formula's money-in-funds term visible where spending decisions
  happen: the total parked in its header and one row per active fund with
  its emoji-led name, available balance, and "$X / mo" plan — blank for a
  fund saving at no set pace — straight from the same `GET /api/funds`
  list the forms already load. Beside them, "Add a spending item" (amount,
  a single "Paid from" select — the month's budget envelopes and the
  active funds from `GET /api/funds` as two optgroups, every option
  labeled `emoji + name`: an envelope pick posts discretionary spending
  against that category, a fund pick posts the fund with no category, so
  a category-plus-fund line can't be entered; choosing a fund reveals the
  matching Cash-Plus-withdrawal reminder — an optional note that
  titles the row in the activity feeds, and a Pending checkbox for a
  provisional amount) posts to `POST /api/expenses` with an explicit
  `budget_month` — the viewed month, so a row entered while paged back
  lands in the month on screen instead of falling to the server's
  txn-month default, and a "Posts to May 2026" line under the title
  says so whenever the view stands off the month it opened to —
  and "Add an
  income item" (amount, funds month — the viewed month or the next two,
  so a paycheck can prepay next month and the prepay window slides with
  the pager — source, an editable Source title
  prefilled from the selected source — the row's bold title, posted as
  `source_label`; switching the source re-prefills it — an optional
  note, and the same Pending checkbox) posts to `POST /api/income`. A
  blank title or note is omitted from the payload, never sent empty,
  and so is an unticked Pending; paging remounts both forms, so their
  defaults re-derive from the month on screen.
  Every submit refetches the viewed budget month, so the hero and
  envelopes always
  show the API's figures rather than client-side math — and adding a
  spending item refetches the funds list too, so a fund-funded spend's
  drawdown lands on the "Money in funds" card immediately. Below the
  forms, the Activity card renders the viewed month's feed — the same
  uncapped row rendering as the Dashboard's Recent activity, but one
  month with no paging buttons of its own: the view's pager owns month
  navigation, and a new item lands in the feed the moment a form
  submits. Here — and only here; the Dashboard's feed stays a
  glanceable read — tapping an expense or income row expands an inline
  edit form pre-filled from the row itself (amount, the same Paid-from
  optgroups as the create form, budget month — the stored month plus the
  txn month and the next two, so a prepay can be reassigned — date,
  title, note, and the Pending checkbox), the way provisional
  transactions get trued up: Lyft
  consolidates a day's rides, a bar adds the tip after settlement, and
  unticking Pending on save drops the row's ⚠️. Save
  revises the item via the PUT endpoints — fund-funded corrections land
  as compensating entries server-side, so the fund's balance follows —
  and Delete arms on the first tap ("Tap again to delete") before
  removing the row, touch-friendly destruction without a native dialog.
  Every save or delete refetches the hero, envelopes, funds card, and
  the viewed month's feed, so an edit's effects land immediately — a
  row reassigned to another budget month leaves the viewed feed and
  waits under its own month on the pager. Fund rows belong to the funds
  machinery and offer no edit affordance.
- **Budget report** (<http://localhost:5173/report>) — the "does it
  balance out?" view: the monthly discipline is `annual_target / 12`,
  most months land a little under, some go over, and this table is where
  that assumption gets checked. A year picker (data-start's year through
  the current one) over a 12-row table — month, planned, actual,
  variance, cumulative variance — every figure from
  `GET /api/budget-year`, variances signed and colored (green under
  plan, red over). Months outside the data render blank, never $0, so a
  partial year is visibly partial, and the in-progress month is marked
  "· in progress" since it undercounts until it closes.
- **Funds & goals** (<http://localhost:5173/funds>) — sinking funds and
  dated goals as one concept, in a single card: a header with the total
  parked and the "notes auto-calculate" hint, the dashed **+ New fund or
  goal** form (name, a curated emoji select, target, saved, target date —
  blank = sinking fund — and $/month), then each fund with its emoji-led
  name, meta line, `saved / target` amount, progress bar, the
  server-derived note from `GET /api/funds`, rendered verbatim, a Top up
  button that opens an inline $ amount input beside a source select —
  a regular top-up (the default, counts against this month) or "From
  last month's leftover", posted as `source = 'rollover'` so the new
  month's headline never pays for it — and an "As of" date defaulting
  to today, reset on every open: backdate a park recorded late or date
  a release into the month it funds, and the move lands in that
  calendar month's headline (an untouched date stays out of the
  payload) — Save posts the delta to
  `POST /api/funds/{id}/top-up`, moving money between the month's
  safe-to-spend and the fund (a negative amount releases part of the
  balance back to spendable; a negative rollover un-assigns), and
  refetches so the balance and note move
  immediately — a Correct balance button that opens an inline New
  balance input prefilled with the fund's current balance — Save posts
  a hand-entered `fund_entry` dated today via `POST /api/fund-entries`,
  the headline-neutral restatement: the tracker and note move on the
  refetch while safe-to-spend never hears of it, which is how the fund
  is reconciled against the real account and how a month funded by
  income row + fund drawdown records its neutral half; a blank or
  unchanged value posts nothing, while $0 is a real correction — an
  Edit
  button that opens an inline Name input, the same curated emoji select as
  the new-fund form, and a $ / month input, each prefilled with the fund's
  current values — Save revises all three via `PUT /api/funds/{id}` (a
  blank $ / month pauses funding without archiving, a blank emoji clears
  it, and a blank name saves nothing) and refetches so the name, emoji and
  note update, Cancel closes without a request — and an
  Archive button that retires the fund via `POST /api/funds/{id}/archive`
  and refetches the list — a finished goal disappears from the card, the
  total parked, and the safe-to-spend "Funded from" options, and its
  balance reads as spendable again. Completed funds turn accent green; open-ended funds (no target)
  show just their balance, with no bar. Submitting the form posts the
  dimension row to `POST /api/funds`, appends any initial saved amount via
  `POST /api/fund-entries`, and refetches the list.
- **Guardrails** (<http://localhost:5173/guardrails>) — the "how much
  can we spend?" view, every figure from `GET /api/guardrails`: KPIs
  (investable portfolio, the tested spend, and the withdrawal rate —
  colored by zone — beside the ±band, the 4% ceiling, and the drawdown
  status), the three-zone Cut / Hold / Raise band with a marker at the
  current rate, the recommendation banner (trim ~10% above the upper
  guardrail, raise ~10% below the lower, hold steady inside), a spend
  slider that re-evaluates everything server-side at each level, and
  raise/cut trigger cards naming the portfolio levels where the next
  rule fires. The spend KPI is labeled by what it measures — "Trailing
  12-mo spend" over actual spending, "Planned spend" with an
  N-of-12-months note while history is still short, "What-if spend"
  while the slider is dragged — and the header names the drawdown
  status: "Readiness — drawdown hasn't started" before the plan's
  drawdown date (the zone is a report card, not a live trigger),
  "Live — drawdown since …" after. The slider's bounds derive from the
  band edges and widen to the resolved spend, so both rails stay
  reachable whatever the portfolio, plan, and actuals are. Until a
  spend plan and balances exist, the view links to the Assumptions card
  under Settings & data, where the annual target, the at-retirement
  initial rate, and the guardrail band are all set — and when no account
  is marked investable at all, the empty state says so and points at the
  account Edit instead, since balances alone could never light it up.
- **Withdrawal sourcing** (<http://localhost:5173/withdrawals>) — the
  "where does the money come from?" view, every figure from
  `GET /api/sourcing`. Left, the sequencing waterfall: target net
  spend, minus non-portfolio income (Social Security past its start
  age, staking while the ETH stake stays meaningful), the gap from
  the portfolio, then one step per bucket — ETH sold tax-free
  inside the 0% LTCG headroom, brokerage next (inheriting leftover
  headroom, then 15% on the gain portion), the 401(k) once its gate
  opens, and HSAs last and untaxed — down to the net delivered, with a
  shortfall banner when the gap goes unfilled. The bucket rule cards
  name each tier's lock age from the waterfall itself, and say nothing
  about a lock where the accounts set no gate. Age and what-if spend inputs re-evaluate the
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
  projected age-100 balance, beside the bridge card — how long the
  taxable buckets last against the bridge to the locked money
  (`first_unlock_age`, the earliest gate on your own age axis, minus
  the derived current age). The card names that age rather than a
  literal, and disappears entirely when nothing in the portfolio is
  gated. The balance-by-bucket chart draws
  one CSS stacked bar per simulated year, the current age → 100 with
  axis labels thinned to every fifth age: ETH, brokerage, 401(k), HSA,
  and the Social
  Security income sliver at the base, enlarged to a 7px minimum so
  the income stays visible against multi-million balances; hovering
  a bar shows the age, its calendar year, and the exact per-bucket
  dollar breakdown. On wide screens the view sheds its designed cap
  and rides the widened shell, so the sixty-odd year columns get real
  width instead of slivers. The tooltip leads with that year's portfolio
  total — ETH + brokerage + 401(k), with the change against the
  previous year beside it ("$1,600,000.00 (+$45,000.00)"), and
  nothing beside it on the first simulated year, which has no prior
  year to compare against. Social Security sits below a rule, out of
  the total: it is an annual income flow, not a balance, so folding
  it in would answer "what is my net worth?" with a number that is
  nobody's net worth. The
  sensitivity table shows the server's 2–6%-of-net-worth spend levels
  with each outcome (never runs out / tight at 90+ / runs out early)
  and highlights the row nearest the current spend. The assumptions
  card — spend, return, ETH growth, and inflation sliders plus the
  editable
  Social Security panel (You $/mo, Spouse $/mo, from age) — re-runs
  the whole simulation server-side on every change; the spend
  slider's floor widens so the resolved spend is always reachable,
  and the ETH slider spans ETH's actual nine-year yearly range
  (−85% to +470%), seeded from the stored rate and tracking the
  return slider while none is set. Below the Social Security panel,
  the Planned purchases section models dated one-off outflows: + Add
  appends a row — name (display-only, never sent), year, and an
  amount that doubles as a slider — flowing into the simulation as
  `purchase=` params on every change, and a per-row **Max
  affordable** button asks the solver for the year's ceiling, fills
  the amount in, and names the binding constraint under the row.
  With purchases planned, the verdict carries the delta against the
  no-purchase baseline ("$1.40M lower at 100 than without the
  purchases" / "4 yrs earlier"), the chart marks purchase years with
  a ◆ tick in the label row, lists the purchase in the hover
  tooltip, and wears a faint hatched cap per column up to the
  baseline total — the compounding forgone growth, the story the
  few-pixel dip can't tell — and a "What do the purchases cost?"
  section joins the sensitivity card with one drop-that-one row per
  purchase. An unaffordable year turns its tick red and reports
  "$X short" in the tooltip while the verdict stays green: the
  screen says *you can't buy that in that year*, not *you go broke*.
  Below the balance chart, a spend step-chart shares its x-axis — one
  column per simulated year at that year's effective spend, band years
  in amber — so "spend steps up here, the portfolio bends there" is
  one glance: drag a band's step vertically to move its level on the
  $1,000 grid, or a band's start/end column sideways to move that
  year, the refetch landing once on release. The Spend bands section
  beside the sliders edits the same rows as a table — start and end
  year (blank = open-ended), amount, note — seeded from the saved
  schedule on load; an overlapping draft warns in place instead of
  fetching a 422, **Save to plan** writes the current row set as a new
  schedule version, **Reset to plan** restores the saved rows, and
  while bands are active the spend slider narrows to the *baseline*
  used by uncovered years and the verdict hero names the baseline and
  band count instead of claiming one flat number.
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
  immediately, like a Ledger save. Every account and envelope row
  carries a grip handle — drag one (mouse, touch, or keyboard: lift
  with Enter, move with the arrows) to reorder the card, persisted via
  the `order` endpoints, so the ledger columns, the balance form
  picker, and the Safe-to-spend envelopes all follow the same order;
  assets and liabilities reorder independently within their own cards.
  Fund rows no longer appear
  on Settings — funds live on Funds & Goals, where their targets and
  progress already are. Below them sit the Envelopes card, the
  Assumptions summary
  (return, inflation, ETH growth, planned spend, the at-retirement
  initial withdrawal rate, and the guardrail band), the Social Security
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
  envelopes appear in Safe-to-spend immediately. Below the envelopes,
  the Quick links card manages the Ledger's institution URLs: label and
  URL rows with a per-row Edit and a Delete — a true delete, since a
  link has no history to keep — an add form, and the same drag-handle
  reordering as the account and envelope cards, so the Ledger card
  follows the user's order. Settings is where config changes are
  *persisted*: saving the Assumptions or Social Security cards appends
  new rows effective today (only configs whose values actually changed
  are posted), the tax card's Edit revises the displayed year in place,
  and + Add creates the next year prefilled from the current one. The
  Assumptions card's rate and band fields take percentages for the
  stored fractions and preview the derived guardrails — initial rate ×
  (1 ± band) — live under the fields; a blank rate clears the anchor
  (Guardrails returns to its empty state), and a blank band falls back
  to the ±20% default. Its Drawdown start date field schedules the
  moment real drawdown begins — set once, usually years ahead: until
  then Guardrails reports a readiness zone, and when the date arrives
  the anchor rate is stamped from actuals. An unrelated save carries
  the stored date forward, and blanking it clears the schedule. The
  Mortgage card
  links the liability account — only liabilities are offered, since an
  asset carries no loan — and takes the rate as a percentage for the
  stored fraction; Save appends a revision only when a term actually
  changed, and the Mortgage screen's payoff moves with it. The Spend
  schedule card edits the age-banded spend plan as a row table — start
  year, end year (blank = open-ended), amount in today's dollars, and
  the note that keeps the plan re-readable — saving the whole set as
  one new append-only version only when something changed; an
  overlapping draft disables Save with the same warning the API would
  return, and removing every row saves the persistent "back to flat".
  The
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

v3.11.0 — The access gate actually fires. The `access_age` check sat
behind an `elif` on tax treatment, so it was unreachable for any bucket
that was not `ORDINARY` (issue #135) — and `load_buckets` collapsed
every non-ordinary tag into `LTCG`, which the engine had no third
member to express. The real 401(k) and HSA accounts, tagged `TAX_FREE`,
therefore drew freely at *any* age and paid 15% capital-gains tax on
money that owes none: at 40, against a stored gate of 62, the waterfall
handed over $573,954 and took $86,093 in tax that does not exist. The
gate now runs before the treatment branch, for every bucket, and a
locked draw leaves the 0% headroom intact for the buckets behind it
instead of spending it. `TAX_FREE` joins `BucketTreatment` with a draw
that realizes no gain and stacks on no ordinary income.

One bucket per `withdrawal_priority` could not hold the accounts it was
being asked to: a tier took its treatment from whichever row SQLite
returned last and its gate from the first, so a 401(k) at 59½ sharing
priority 3 with an HSA at 65 unlocked the HSA five and a half years
early. Accounts now group by everything that decides their answer —
tier, treatment, gate age, and, where there is a gate, their owner —
with the owner deliberately dropped from the key for ungated accounts
so ETH and brokerage never fragment on a field that cannot change their
result. A tier that splits keeps its plain label where it doesn't and
names only the differing part where it does: `401(k) · you`,
`401(k) · spouse`. HSAs become the fourth tier, tax-free and drawn last.

Two people of different ages needed two gates. `account.owner` has been
a column since the first migration with nothing to write it; it is now
part of the classification body and an Owner select in Settings, beside
a fourth withdrawal priority. A second sanitized constant stands in for
the spouse's birthdate and `age_offsets` derives the whole-year gap from
the pair rather than writing it down — neither is a real birthday, and
no birthdate lives in the schema. Each bucket carries its owner's offset
from the simulation's axis, so `?age=` and `start_age` stay *your* age
while her gates land on hers: at your 66 the 401(k) is open and her HSA
is not, because she is 63.

The screens stop guessing. `59.5` was hardcoded in the bridge card's
heading and year count, in the chart legend, in `bridgeCopy`'s search
window and its literal "31+ yrs", and in the 401(k) rule card — all
disagreeing with accounts that said 62. Every one of them now reads the
data: steps report their bucket's `access_age`, the forecast reports
`first_unlock_age`, the bridge card names that age and disappears when
nothing is gated, and the rule cards drop the lock sentence for a tier
with no gate. The chart gains an HSA band, and its series sums by tier
rather than by bucket name — a tier split between two owners used to
match neither band and read as zero.

v3.10.0 — The Ledger says which way the money went. The table showed
absolute balances only, so telling whether an account grew or shrank —
and by how much — meant reading two rows and subtracting by hand, and
the three brokerage funds, held as one position, had to be added up by
eye across three columns (issue #132). Every figure now carries its
change from the previous month inside the same cell — no new columns,
which would have taken the table from 17 to roughly 32 — smaller and
lighter than the balance it annotates, green favorable and red
unfavorable. The subtraction happens on the already-signed display
value, so one rule covers an asset that grew and a debt that shrank: a
mortgage paid down reads as a green rise beside a balance that keeps
its liability red, since that red means "this is a liability", not
"this got worse". No-change and no-data stay visually apart — a muted
$0.00 where a balance carried forward untouched, a faint em dash where
there is no prior entry, so an account's first month is never a
full-value gain. A derived Brokerage subtotal joins the columns after
the last fund, summing by `kind = 'brokerage_fund'` rather than by the
three fund names; the table's columns became a discriminated union so a
derived column cannot be mistaken for an account, and net worth is
untouched — it is summed server-side from real account rows.
Frontend-only: no API change.

v3.9.0 — The layout uses ultra-wide displays. Every route was capped
at 1180px and the responsive ladder stopped at `lg:`, so a 3440px
monitor rendered the same layout as a 1024px laptop and left ~2,000px
of empty page while the Ledger's table scrolled horizontally inside
~714px (issue #131). The shell now widens where the viewport can
supply the width — 1500px at `xl`, 1800px at `2xl`, 2200px at a new
`3xl` breakpoint (120rem) in the theme — while the design handoff's
1180px baseline stays exactly as specified below ~1500px viewports.
Two views ride the new room: the Ledger re-splits at `2xl` to pin the
balance-form column at its designed 440px so the table absorbs every
further pixel (no horizontal scroll at typical account counts), and
the Forecast sheds its own 1000px cap above `xl` so the year-bar
chart gets ~33px per year instead of ~15px. Prose- and form-heavy
views (Settings, Funds, Guardrails, Mortgage, Withdrawals) keep their
designed measure on purpose — stretching a form to 2200px hurts
readability. Frontend-only: no API change.

v3.8.0 — The Ledger stops growing without a ceiling. Nothing in the
ledger path was bounded: `GET /api/ledger` selected every row of
`v_account_monthly` with no limit, no cursor and no date floor,
`ledgerRows` mapped every month it received, and `LedgerTable` rendered
every one of them — one row per month, forever. Twenty rows today, a
hundred and twenty in ten years, and the view underneath grows faster
than the DOM does, since it joins every distinct month against every
balance entry before ranking. The endpoint now serves one page: the
twelve newest months by default, older ones behind a `before=YYYY-MM`
cursor, sized by a bounded `limit` (an unbounded one, or a "show all",
would just re-open the query the paging closes) and carrying `has_more`
so the caller knows when to stop. A page is measured in whole months and
never rows — one month is one row per account — and its month list comes
from `balance_entry` rather than the view, so both reads are bounded to
the page's range. The table opens on those twelve and appends the next
page when a sentinel row below the last month scrolls into view: an
`IntersectionObserver` against the viewport, so an iOS momentum flick
pages the same as a wheel, with one request in flight at a time, a
loading row while it is out, and the row gone once the oldest month is on
screen. Balance prefills are untouched — the monthly view carries
balances forward, so every active account is already in the newest month,
and a partial list of months was never a partial list of accounts. What
this does not fix is the view's own shape: paging bounds the payload and
the DOM, not the month x entry join, which stays quadratic in history.
Minor: the ledger response is an object rather than a bare list now, and
its callers ship with it.

v3.7.0 — The deploy checkout's `git status` is clean. A reverse-proxied
deployment needed two settings this repo deliberately doesn't carry — a
compose override joining the frontend to the proxy's network, and the
public hostname in `vite.config.ts`'s `allowedHosts` and HMR config — so
the deploy box always showed an untracked file and a modified tracked
one. That noise hid real drift, and it made `git reset --hard`, the
natural reflex when a pull complains about local changes, a site-down
event twice over: a 502 once the frontend left the proxy network, then a
403 from Vite's host check once the 502 was fixed (2026-08-26). The
hostname now arrives through the `SERENO_PUBLIC_HOST` env var, read by a
tested pure helper that adds `allowedHosts` and a `wss`:443 HMR host
when set and nothing at all when unset — local dev and CI byte-identical
to before — and `compose.override.yaml`, the conventional Compose name
for local-only overrides, is gitignored. Only ignored files differ on
the deploy box now, and the README's new deployment section documents
both halves. Minor: an additive configuration interface, nothing changed
when unset.

v3.6.0 — Guardrails measured intent, not behaviour: the withdrawal
rate was computed from the spend plan's annual target, so spending
could drift arbitrarily far from plan without the zone moving, literal
portfolio withdrawals would have read 0% while a pre-funded cash
buffer was consumed and then spiked when it emptied, and the
at-retirement anchor rate was a hand-set constant nothing ever
captured from reality. The default numerator is now the trailing
twelve complete months of actual spending — discretionary lines plus
fund outflows, never fund contributions, funding source deliberately
ignored so the measure stays continuous across the buffer-to-portfolio
transition — with the target standing in until a year of history
exists, labeled by `spend_source` and `spend_months` so a short window
is never dressed up as a year. The spend plan gains an effective-dated
`drawdown_start` (migration 0016, set from the Settings Assumptions
card): before it the Guardrails screen and Dashboard card mark the
zone as a readiness check rather than a live trigger, and the first
read on or after it stamps a new plan row whose `initial_rate` is the
actual rate as of that date — once, deterministically, with a later
hand revision always winning. The engine is untouched — this is the
API layer choosing a better numerator — the denominator's cash
exclusion is now documented as a decision rather than an artifact of
account flags, and the raise/cut triggers drift with actual spending
by design. Independent of the age-banded spend schedule (#118), which
plans hypothetical future years; a band schedule never feeds the
guardrail rate.

v3.5.0 — The longevity forecast assumed one flat spend level from the
current age to 100, and real spending is not flat: it steps up through
peak years, down as activity declines, ends when a mortgage is paid
off, and rises again for late-life care — modelled flat, a
mediocre-return forecast can report running out decades early purely
because it never stops charging for expenses with a known end date.
Spending is now an age-banded schedule: effective-dated, append-only
rows of "from year, to year, annual amount" in today's dollars, a gap
meaning "no change from baseline" so one band needs no lifetime
schedule around it, and overlaps rejected naming the two rows. The
engine did not change — a schedule compiles in the API layer to the
zero-amount ongoing deltas the purchase machinery already understands
— and the schedule is editable where the question gets asked: on the
Forecast screen as rows or a draggable step-chart sharing the balance
chart's x-axis, transient until Save to plan writes a new version, and
under Settings as the Spend schedule card. The saved schedule is every
bare caller's default, the max-affordable solver prices purchases
against it, and sensitivity levels scale the whole schedule. Guardrails
deliberately stay on the flat target (#119): they monitor history,
while this schedule plans hypothetical future years.

v3.4.0 — The mortgage is the largest line in the budget and the only
one with a known end date, but nothing in Sereno knew it was a loan. It
sat in the ledger as a balance and in the budget as one undifferentiated
monthly amount, which lost three facts: when the payment stops, that
escrow outlives payoff while principal & interest does not, and that a
payment fixed in nominal terms costs less in real terms every year —
the forecast runs in today's dollars, so a flat real amount
over-inflates the payment beforehand and never ends it afterward.
Mortgage terms are now effective-dated config like assumptions and the
spend plan — rate, P&I, extra principal, escrow, linked to the liability
account — and everything else is derived rather than stored. The payoff
date in particular: any maturity date typed by hand goes stale the
moment the extra payment changes, so it is solved each time from the
balance the ledger already tracks. A new Plan screen reads out the
payoff month and the age then, the term and interest left, what the
extra principal buys against the P&I-only schedule ("saves 32 months and
$6,840.04 of interest"), and the payment today beside its real value at
payoff. Escrow is stored apart and shown apart, because it is the part
that keeps running.

v3.3.0 — The forecast chart's tooltip answers "what is my net worth
that year?". It listed four dollar lines — ETH, brokerage, 401(k),
Social Security — of which only the first three are summable: the
fourth is an annual income flow, and nothing but a `/yr` suffix said
so, which made the obvious reading of the tooltip (add the lines up)
the wrong one. The tooltip now leads with a bold portfolio total —
the three balances, Social Security deliberately excluded — carrying
the change against the previous simulated year beside it
("$1,600,000.00 (+$45,000.00)"), and Social Security sits below a
rule so the stock/flow split is visual rather than implied. The sum
is derived once per column in `chartColumns`, alongside every other
figure the chart already precomputes, so the render path stays free
of arithmetic and the exclusion rule has one testable home.

v3.2.1 — The containers come back after a reboot. Neither service declared a
restart policy, so Docker defaulted both to `no`: a host reboot left the
backend and frontend sitting in `Exited` while every other service on the
same machine (which do declare one) came up with the daemon, and the site
stayed down until someone noticed and ran `docker compose up -d` by hand.
Both services now declare `restart: unless-stopped` — restarted after a crash
or a reboot, but left alone once stopped deliberately, so `docker compose
down` and `Ctrl-C` still mean what they always did. Compose applies restart
policies to `up` containers only, so the one-off `docker compose run --rm`
check commands are unaffected: a failing lint or test run still exits once
with its status instead of looping.

v3.2.0 — Every dollar amount shows exact cents. formatUsd, the
app-wide money formatter, rounded to whole dollars before formatting,
so cents were discarded on all 20 modules it reaches — while the
dashboard's activity feed kept a private conditional-cents formatter,
so the same screen disagreed with itself: "−$28.40" in the feed
beside a funds card showing "$500" (issue #113). Every surface now
formats two fixed decimals through the one shared formatUsd, negative
sign placement kept ("-$1,234.56"), which also stops display rounding
from concealing real data: the guardrail trigger portfolios and the
sourcing waterfall's taxed draws carry true fractional cents
("$103,092.78" rendered as "$103,093"), and a fund's displayed
balance now matches its stored balance to the cent — the visibility
half of #112's drift. The balance form's seeds follow suit: money
prefills with exact cents, and the ETH quantity seeds through a new
five-decimal formatter — the old locale default rounded quantities at
the third decimal, so a fractional holding re-saved from its own
prefill would silently change. Abbreviated forecast figures ("$1.25M")
and percentages keep their precision; cents are meaningless at that
scale. Frontend-only: the API has served exact-cent dollars since
v3.1.1.

v3.1.1 — Ledger money is stored as integer cents, and the fund guards
stop throwing false 422s. Every money value was a Python float over
NUMERIC storage, and the append-only ledgers recompute each row as
previous + delta, so representation error accumulated down the chain: a
fund topped up 14.82 + 68.57 + 90.89 and spent 74.95 stored
99.32999999999997 under a displayed $99.33, and the overdraw guards
compared that raw float against the entered amount — releasing the
displayed balance, or spending the fund down to zero, was rejected, so
a fund could never be emptied from the UI (issue #112). Migration 0013
converts the eight ledger-money columns (fund balances and
contributions, expense and income amounts, account balances, envelope
plans, fund targets and monthly plans) to INTEGER cents, healing the
drift already stored with ROUND(value × 100), and the API converts at
the boundary — JSON stays dollars, so the frontend is untouched. All
balance arithmetic and guard comparisons now run in integer cents,
which makes the drift structurally impossible rather than rounded away
after the fact. Rates, ETH quantity and price, cost basis, and the
config tables keep fractional precision — they are projection inputs,
not ledger money — and an ETH entry's quantity × price now rounds to
exact cents at write. Deploying runs the migration at startup; back up
the database file first.

v3.1.0 — The Safe-to-spend view pages whole months. The Activity card's
back/forward buttons paged only the feed — the hero and envelopes
stayed pinned to the current month, so there was no way to see how the
envelopes stood in a past month, and the 1st-of-the-month leftover
question lived in a small footnote line below the income form. A month
pager above the hero now steps the entire view one month at a time,
uncapped in both directions, through the existing
`GET /api/budget-month?month=` param — hero, envelopes, forms, and a
single-month Activity card all following the viewed month (the
Dashboard's feed keeps its own paging untouched) — and the leftover
line retires: last month's closing Safe-to-spend is the paged-back
month's own hero, so the label was redundant. Both add-forms post to
the month on screen: the spending form always sends an explicit
`budget_month` and wears a "Posts to May 2026" line while the view
stands off the month it opened to, and the income form's funds-month
window derives from the viewed month instead of today — so a row
entered while looking at May lands in May, not silently in the real
current month. Frontend-only: the API already served any month.

v3.0.0 — The reported version stops lying. `GET /api/health` returned
`sereno.__version__`, a hardcoded string last bumped at 2.7.0 while
`pyproject.toml` moved on — every deploy since introduced itself as
2.7.0, which sent a production investigation down a false "the
deployment is lagging" path (discovered while diagnosing v2.14.1's
duplicate-funding bug). `__version__` now derives from the installed
package's metadata via `importlib.metadata`, built from
`pyproject.toml` at image build time, so the endpoint reports what is
actually deployed and a bump can never be forgotten; `uv.lock`'s own
stale `sereno 2.7.0` entry is refreshed to match. The sidebar shows
the deployed version in small muted text under the month label,
fetched once from `/api/health`, so checking what's running no longer
means curling the API. One dev-mode caveat: compose mounts only `src/`
and `tests/`, so the dev server reports the version baked at the last
`docker compose build` — a real deploy rebuilds the image, which is
the point.

v2.14.1 — Racing first-of-month reads stop double-funding the month.
The monthly-plan catch-up runs on every funds and budget read, and the
dashboard fires `GET /api/budget-month` and `GET /api/funds` in
parallel on mount; on the first load of a new month, each request's
own connection could read the funds' anchors before either committed,
so both concluded the month was due and each inserted a full set of
`monthly_plan` entries — every funding line twice in the feed, the
month's contributions total doubled, every fund's balance one
contribution high (observed in production on 2026-08-01). Migration
0012 adds a partial unique index — one `monthly_plan` entry per fund
per date; NULL, `top_up`, and `spend` same-date duplicates stay legal,
since restating a balance twice or spending from a fund twice in a day
is real usage — and the catch-up's insert becomes `INSERT OR IGNORE`,
so a losing racer is a silent no-op under any interleaving. Deploying
0012 onto a database still holding duplicated rows fails loudly at
startup by design: the unique index cannot build over them, so the
data cleanup (tracked separately) must land first.

v2.14.0 — Fund moves land in the month they belong to. Top-ups were
always stamped `date.today()`, so funding a coming budget month from a
fund double-counted spendable money — the release raised the current
month's headline while the transfer income raised the target month's —
and a park recorded late charged the wrong month; the headline-neutral
restatement existed only as curl against `POST /api/fund-entries`.
`POST /api/funds/{id}/top-up` gains an optional `as_of_date` (default
today): the entry scopes into its calendar month — the headline, feed,
and yearly actual already group by `substr(as_of_date, 1, 7)` — a date
behind the fund's latest entry is a 422 (snapshots resolve
newest-first, so a mid-chain insert would silently drop out of the
balance), and due monthly plans are applied through the date before
the entry lands, so a move dated on a 1st can never swallow that
month's planned contribution. The top-up form gains the matching
"As of" date, and each fund row gains Correct balance — an inline form
posting a hand-entered entry dated today, the NULL-source restatement
safe-to-spend deliberately ignores — so reconciling a fund against the
real account and the income-row + fund-drawdown month-funding recipe
both work from a phone. No migration: `fund_entry` already carries
every column.

v2.13.0 — Envelopes answer "what did we actually spend?" on tap. There
was no way to drill down from an envelope to its transactions —
answering the question meant scanning the whole Activity feed. Every
envelope row on Safe-to-spend is now a tap target: tapping one filters
the feed to that envelope's own expenses (income, fund entries, and
fund-funded lines belong to no envelope, so they drop out — across
paged-in months too), the selected row tints, and a "Filtering: 🛒
Groceries ✕" chip in the Activity header clears it — as does re-tapping
the envelope, while tapping a different one replaces the filter. A
filtered month with nothing left says so instead of claiming no
activity exists. Frontend-only: the feed already carried category_id
on every expense row, so filtering is a client-side trim of what
`GET /api/budget-month` returns.

v2.12.0 — Over-budget envelopes stop hiding what was spent. An envelope
past its plan showed only the overage ("$46 over"), so answering "what
did we actually spend?" meant filtering the Activity feed by hand. The
row's right-hand label now keeps both figures visible — "$546 of $500 ·
$46 over" — bringing the over-budget state to parity with the
"spent · left" under-budget label. Frontend-only: the label is built in
`envelopeView` from figures `GET /api/budget-month` already returns.

v2.11.0 — Provisional transactions carry their reminder. Some amounts
land wrong on purpose — Lyft consolidates a day's rides into one
charge, bars add tips after settlement — and until now nothing marked
the entry as needing a second look. Migration 0011 adds a `pending`
boolean to `expense_line` and `income_event`; the create and edit
forms gain a Pending checkbox, and a pending row's title wears a
trailing ⚠️ in both activity feeds until the amount is trued up —
unticking the box in the edit form and saving clears it, since the
PUT endpoints are full replaces and pending defaults false. The flag
is a reminder, never an exclusion: pending items still count in
safe-to-spend and every other total, because the money has already
moved and the known amount is a floor. Long row titles now wrap
inside the row instead of pushing it wide, so the suffix never breaks
the feed's layout.

v2.10.0 — Entry mistakes stop requiring SQL. Expenses and income were
append-only (`POST` only), so truing up a provisional transaction —
Lyft consolidating a day's rides into one charge, a bar adding the tip
after settlement — or fixing a typo meant hand-editing SQLite. `PUT`
and `DELETE /api/expenses/{id}` and `/api/income/{id}` revise or
remove the rows in place: they are facts nothing references, so the
append-only rule stays with the balance tables. Edits are full
replaces of the create bodies, `budget_month` included (a prepay can
be reassigned to the right month), and fund-funded expenses never
touch their paired `'spend'` entry — each fund entry snapshots a
balance, so a compensating `'spend'`-source entry is appended instead,
dated today: a full reversal on delete or a funding-source change, a
single delta on a same-fund amount edit, the overdraw guard
re-applied either way. `'spend'` entries already stay out of the
headline, the feed, and the budget-year actual, so corrections never
move safe-to-spend. Activity rows now carry the fields an edit form
pre-fills (category, fund, account, fixed flag, budget month, tax
treatment) — no GET-by-id round trip — and on Safe-to-spend (the
Dashboard feed stays read-only) tapping an expense or income row
expands an inline pre-filled edit form: Save PUTs and refetches
everything the item touches, Delete arms on the first tap ("Tap again
to delete") before removing the row — tap-first, touch-friendly, no
native dialogs. No migration: the schema already had every column.

v2.9.0 — The ETH price is typed once, not once per account. The
Ledger form's `$ / ETH` field used to prefill from the selected
account's own newest entry, so updating two eth-kind accounts on the
same day meant entering the same market price twice. It now prefills
from the newest `unit_price` across all eth-kind accounts — newest
month first, newest as-of date within the month — so saving one eth
account carries the price to the next, including across page reloads,
since the price lives in the ledger. Quantity still prefills from the
selected account's own newest entry, the field stays editable per
save, and each entry keeps snapshotting its own `unit_price`, so
backdating a different price still works. Frontend-only: no API,
schema, or migration changes.

v2.8.0 — Last month's leftover gets a job. Safe-to-spend is
month-scoped, so when a month closed with money left over there was
no good way to record sweeping it into a fund: a plain top-up charged
the new month for money the old month already earned, and the manual
two-row dance inflated gross income and contributions while recording
nothing. `POST /api/funds/{id}/top-up` gains an optional `source` —
`'top_up'` (the default, unchanged) or `'rollover'`, recording the
contribution identically while staying out of the Safe-to-spend
headline, the reconciling activity feed, and the budget-year actual
(all three already filtered on `('monthly_plan', 'top_up')`; tests
now lock the exclusion in) — and `GET /api/budget-month` gains
`rollover_assigned`, the month's assigned total. The Funds & goals
top-up form offers the source choice, Safe-to-spend shows the
leftover line — "July left $1,000 · $600 assigned · $400 unassigned",
ticking to $0 as the money is assigned, over-assignment shown rather
than hidden — and the income form's note drops its promise of an
automatic roll-forward the system never had. No migration:
`fund_entry` has no CHECK constraint on `source`.

v2.7.0 — The activity feed pages forward. Income can fund a future
`budget_month` (the prepay pattern: June pay funds July), but the feed
anchored at the current month and only paged backward, so a
future-funded item was visible only through the API. A mirrored
"August 2026 →"-style button at the top of the shared feed now
prepends future months, one per click, through the existing
`GET /api/budget-month?month=` param — `nextMonth` joins
`previousMonth` as pure string math, forward paging is unbounded into
empty months exactly like the back button (an empty month renders the
"No activity yet" state), and both buttons share the loading disable.
Frontend-only: no API or backend behavior changes.

v2.6.0 — Ledger rows date themselves by month. The Ledger is a
monthly view, but its date column reflected the latest entry's exact
`as_of_date` — a new month read "Jul 1, 2026", then shifted to
"Jul 20, 2026" after an update, implying day-level precision the row
never had. Each row now formats its own `YYYY-MM` month key as
"July 2026", dropping the per-row latest-date derivation entirely.
Display-only: entries keep storing their real `as_of_date`, and no
API or backend behavior changes.

v2.5.0 — The yearly budget report. The monthly discipline is
`annual_target / 12`, and the assumption that under- and over-months
balance out over the year finally has a place to be checked:
`GET /api/budget-year` returns one row per month — planned from the
month-effective spend plan (a mid-year revision splits the year),
actual as discretionary spending plus fund contributions, the
Safe-to-spend definition of money leaving the pool, the variance
(positive = under plan), and a within-year running total. Months
outside data-start → now are null, never zero — the app cannot
distinguish "no data" from "spent nothing", so a partial year stays
visibly partial — and the in-progress month is flagged provisional.
The Budget report view (/report, in the TRACK nav) renders a year
picker over the 12-row table with blank out-of-coverage rows, and the
Dashboard's card row gains a Budget report card — "$1,850 under plan
(4 months)", always through the last complete month, green under and
red over — deep-linking to it.

v2.4.0 — One question instead of two. The spending form's separate
Category and Funded-from selects forced a category onto fund-funded
spending, where it did nothing: the envelope math only counts
discretionary lines, so the pick never moved a bar or the headline —
it only mislabeled the feed. The merged "Paid from" select offers the
month's budget envelopes and the active funds as two optgroups: an
envelope pick posts discretionary spending against that category, a
fund pick posts the fund with no category — the invalid state
(category + fund together) is unrepresentable, enforced by the
ExpenseInput union. In the activity feed, a category-less fund spend
carries its fund's name where the category's would have been
(COALESCE in the budget-month query; historical rows carrying both
keep their category) and resolves its emoji from the funds list,
staying a neutral debit — amber stays reserved for contributions and
releases, and with no envelope a fund spend can never read as a
treat. No backend contract change: ExpenseCreate.category_id was
optional all along.

v2.3.0 — Quick links join the balance ritual. Updating a month's
balances means visiting each institution's website, and those URLs
lived in browser bookmarks, disconnected from the app. Migration 0010
adds the `quick_link` table (label, URL, sort_order) and the
`/api/quick-links` router: list, create, edit, the #79-style reorder
endpoint, and the API's one hard delete — a link is a navigation
utility with no facts attached, so there is no history for a soft flag
to protect. A URL without a scheme gets `https://` prefixed; host,
path, and query are stored verbatim. Settings & data gains a Quick
links card (add, edit, delete, and the same drag-handle reordering as
the account and envelope cards), and the Ledger renders the links
directly below the balance form — one click per site whose balance is
being copied in, each opening in a new tab — hidden until links exist.
Real institution URLs live only in the local database; the public
repo's fixtures use fakes.

v2.2.0 — Accounts and envelopes learn their place. Until now every
list rendered in insertion order (`ORDER BY id`), so the Ledger's
balance form listed accounts in whatever order they were added and
nothing could group related ones or put the frequently updated first.
Migration 0009 adds `sort_order` to `account` and `category`
(backfilled from id, so existing installs keep their order), the list
queries order by it, and `PUT /api/accounts/order` /
`PUT /api/categories/order` persist a reorder — the body must be
exactly the active ids, positions become `sort_order`, and new rows
append at the end rather than jumping to the top. On Settings & data,
every Assets, Liabilities, and Envelopes row gains a grip handle
(@dnd-kit): drag by mouse, touch, or keyboard, and the drop reorders
locally, PUTs the full order, and refetches. Assets and liabilities
reorder independently within their own cards, and the order flows to
the ledger columns, the balance form picker, and the Safe-to-spend
envelopes automatically, since no consumer sorts client-side.

v2.1.0 — Activity rows learn to explain themselves. Both safe-to-spend
forms gain an optional Note, and income rows get a dedicated title:
until now the bold income title *was* the `note` column — the form
hardcoded a per-source note ("Spouse paycheck") — so a real note had
no room without displacing the source from the row. Migration 0008
adds `income_event.source_label` and backfills it from the old
title-style notes, so every existing row keeps its rendered title;
`POST /api/income` accepts and echoes the label, the budget-month
activity payload carries it, and the seed writes its titles there.
The income form keeps its source select and gains an editable Source
title prefilled from the selected option (switching the source
re-prefills it) plus a Note input; the spending form's note titles
the row with the category in the subtitle, the way the feed already
rendered notes. Income rows title by `source_label`, falling back to
the note and then the source, a note joins the subtitle only when it
isn't already serving as the title, and a blank title or note is
omitted from the payload, never sent empty.

v2.0.0 — Planned purchases and the max-affordable solver. The
forecast learns lumpy years: repeated `purchase=year:amount[:delta]`
params drop dated one-off outflows (a house, a car, a gift) onto the
simulation's yearly targets, where the 0% LTCG headroom, the 15%
gross-up, and the 59½ gate price them properly — before this, the
only lever was amortizing a lump into `?spend=`, which never leaves
the 0% bracket and answers a different question. A lump the year
can't deliver is an *unaffordable purchase*, not a run-out: the year
re-sources without it, the verdict stays green, and the response
says how far it missed. One call now also carries the no-purchase
`baseline` (run-out age, age-100 balance, and series) and a
per-purchase `purchase_costs` table (the outcome with just that one
dropped), and the new `GET /api/forecast/max-affordable`
binary-searches the largest lump a year can hold under a chosen
criterion — never runs out by default, `last_to_age=` and
`min_balance_at_100=` as variants — naming whether the year's own
liquidity or long-run longevity binds. The Forecast screen gains the
Planned purchases rows (name / year / amount slider, transient
what-if like every slider), the per-row Max affordable button, the
verdict's baseline delta line, ◆ chart ticks with hatched
forgone-growth caps and "$X short" tooltips, and the "What do the
purchases cost?" card. Everything stays a read-only GET — POST still
means appending config — and persistence (a `planned_purchase` table
plus Settings CRUD) is a deliberate follow-up.

v1.14.1 — Emoji options find a home. The three curated picker lists —
assets, envelopes, funds — move out of `settings.ts` and `funds.ts`
into a shared `emoji.ts`. The lists stay separate on purpose: the same
emoji means different things per domain (⚡ is Ethereum on an asset,
Electric on an envelope), so only their location changes. The account
add form drops its hand-rolled `<select>` for the shared `EmojiSelect`
the envelope and fund forms already use, so every picker picks up
future styling and accessibility fixes from one component. A pure
frontend refactor — no behavior change, no backend or migration
impact.

v1.14.0 — Funds finish their edit path. `PUT /api/funds/{id}` learns to
revise a fund's `name` and `emoji` alongside its monthly plan: the fund
row is a dimension, not a fact — the same reasoning that already makes a
category renameable — so its identity fields are mutable while the
append-only `fund_entry` history stays untouched. A typo in a fund's
name no longer costs the fund. The update is partial rather than a
replace: every field is optional and only those the body carries are
written, so the plan-only body the screen sent before still pauses a
fund, a rename can't coalesce an active plan into a pause, and an
explicit null emoji clears one while an omitted emoji keeps it. The
Funds & goals row Edit form grows a Name input and the same curated
emoji select the new-fund form uses, each prefilled from the fund, and
Save round-trips all three. `target_amount` and `target_date` stay
fixed at creation: `target_date` derives `kind`, so editing it would let
a fund change kind after the fact — a behavior change, not a display
one, and its own issue.

v1.13.0 — The activity feed goes full-history. Fund entries join
expenses and income as the third source in `GET /api/budget-month`'s
activity list — only `monthly_plan` and `top_up` rows, the exact set
the `fund_contributions` headline subtracts, so a fund-funded expense
never lists twice and the feed reconciles with the number above it.
The Dashboard's Recent activity drops its five-item cap: the shared
ActivityFeed renders the full current month under a dated section
header — fund rows on an amber tile with the fund's own emoji, their
amounts signed by the effect on the headline (a contribution parks
money, a release frees it) — and a "← May 2026"-style button pages
earlier months in as their own dated sections through the existing
`?month=` param. Safe-to-spend gains the same feed in an Activity
card below the income form, which sheds its old name: "Add a funding
item" becomes "Add an income item", freeing "Funding" to mean money
parked into funds.

v1.12.0 — The ETH bucket earns its own growth rate. The `assumption`
table's dormant `eth_growth_pct` — editable in Settings but consumed
by nothing — finally drives the simulation: `simulate_forecast` grows
the ETH bucket at its own nominal rate minus inflation (null keeps
the blended real rate, and a rate at or below −100% real empties the
bucket rather than inverting it), `GET /api/forecast` resolves
`?eth_growth_pct=` from the query, then the assumptions row, and
echoes the resolved value, and the Forecast Assumptions card gains an
ETH growth slider spanning ETH's actual nine-year yearly range (−85%
to +470%, widened further so any stored rate stays reachable) —
transient what-if like every other slider; Settings stays the only
write path. The sensitivity table re-simulates at the resolved rate
automatically.

v1.11.0 — The Guardrails anchor becomes editable. The Assumptions card
gains "Initial rate %" and "Guardrail band %" fields beside the planned
spend: saving appends a new effective-dated `spend_plan` row through
the existing single write path, so a database populated entirely
through the UI can finally light up the Guardrails screen. The fields
take percentages for the stored fractions (2.94 ↔ 0.0294), preview the
derived guardrails — initial rate × (1 ± band) — live under the
fields, and read back in the card's summary; a blank rate clears the
anchor, returning Guardrails to its empty state, and a blank band
falls back to the schema's ±20% default. The Guardrails empty state
now links to the Assumptions card instead of describing a screen that
couldn't set the rate. Frontend-only: `POST /api/spend-plan` accepted
both columns all along.

v1.10.0 — One-time fund top-ups and releases. Funds gain the one-off
sibling of the automatic monthly contribution:
`POST /api/funds/{id}/top-up` appends a `fund_entry` with the delta as
its contribution and `source = 'top_up'` — the new balance is computed
server-side from the latest entry, so nobody types an absolute figure —
and the budget month counts top-ups in `fund_contributions` alongside
the monthly plans, so parking money trims safe-to-spend the moment it
lands. A negative amount is a partial release, raising the headline
back: releasing more than the fund holds is a 422, the mirror of the
overdraw guard on fund-funded expenses, while topping up past the
month's remaining headline stays allowed, like overspending everywhere
else. Each Funds & goals row gains a Top up button with an inline
$ amount input beside Edit and Archive — a negative amount releases
back to spendable.

v1.9.0 — Monthly funding learns to stop. The lazy catch-up no longer
funds past 100%: each due month contributes from the fund's balance
as of that 1st, the crossing month is capped at the remaining amount
so the fund lands exactly on target, and a fund at or past target
receives nothing — so a fully funded goal stops parking money and
stops trimming safe-to-spend. Months spent at target are forgiven
rather than owed: a drawdown resumes funding from its own month
forward instead of backfilling rows dated before the spend that the
date-ordered balance query would never see. Open-ended funds keep
funding at full pace, and a goal's target date stays a deadline, not
a kill switch. Funds also gain their first edit path:
`PUT /api/funds/{id}` revises the monthly plan in place (the fund row
is a dimension — entries and history untouched), a null/0 plan pauses
funding without archiving, and each Funds & goals row gains an Edit
button with an inline $ / month input beside Archive.

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
