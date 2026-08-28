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
docs/api.md         every HTTP route and what it returns
docs/screens.md     what each view shows and what it reads
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
Envelopes card (see [Screens](docs/screens.md)): the envelope list with
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
replaces the last stub (see [Screens](docs/screens.md)): the verdict hero,
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
[Screens](docs/screens.md)): the sequencing waterfall with per-step amounts
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
(see [Screens](docs/screens.md)): KPIs, the three-zone Cut / Hold / Raise
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
