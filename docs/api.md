# API endpoints

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
  updated — history is kept. `cost_basis` is optional and in **dollars**,
  not cents: the account's aggregate basis, which the withdrawal
  waterfall prices gains against. It is an annual figure — record it
  once the year's tax documents are final — so omitting it means
  unchanged rather than zero, and the last one recorded still stands.
  A negative basis is a 422.
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
  staged without taking effect early. `null` until a row exists. The
  assumptions row carries the rates the Plan engines read — `return_pct`
  and `inflation_pct`, plus the optional `eth_growth_pct` and
  `staking_yield_pct`, where null means "don't model it" rather than
  zero: no ETH rate of its own, no staking income.
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
  spend minus non-portfolio income leaves a gap, filled from ETH to
  exhaustion — tax-free inside the 0% long-term-capital-gains headroom
  (the ceiling minus taxable ordinary income, converted to sale
  proceeds through each bucket's gain fraction), then at 15% on the
  gain portion, so unwinding the concentration outranks the tax saving
  — then taxable brokerage (leftover headroom first, then 15% on the
  gain portion), then the 401(k) with
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
  from open tax lots, falling back to the newest balance row that
  recorded a `cost_basis` — rarely the same row, since basis is annual
  and balances are monthly — then to zero. Between snapshots the basis
  is stale against a grown balance, which overstates the gain and the
  tax: the conservative direction for a forecast. Non-portfolio income
  reduces the gap before any bucket is sold: Social Security past its
  start age, and staking as the assumptions row's `staking_yield_pct`
  applied to the ETH bucket's balance — the income tracks the stake it
  is paid on, and a null yield models none. `?age=` is *your*
  age, defaulting to the one derived
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
  year records its opening balances first — that year's January 1,
  since the birthdate is January 1, so the first point is today's
  actual balances — then the buckets grow by the real
  rate (return − inflation) — except the ETH bucket, which grows at
  its own nominal rate minus inflation when the assumptions row's
  `eth_growth_pct` is set (null keeps it on the blended rate) —
  Social Security (per person, from that
  person's start age) and staking income (`staking_yield_pct` on that
  year's staked balance, so it decays as the stack is drawn down and
  stops when the stack does) reduce the year's need, and the remainder
  is withdrawn
  through the sourcing waterfall — the 0% LTCG headroom, the
  gross-ups, and each bucket's own access gate apply every simulated
  year. Growth is
  all gain (basis stays put); sales reduce basis pro-rata. Spend
  defaults to the plan's annual target, the rates to the assumptions
  row, and Social Security to the stored rows; `?spend=`,
  `?return_pct=`, `?inflation_pct=`, `?eth_growth_pct=`,
  `?staking_yield_pct=`, `?ss_you=`, `?ss_spouse=`, and
  `?ss_start=` override each transiently — the Forecast screen's
  sliders never persist. The response carries the resolved inputs
  (including the derived `start_age`),
  the per-bucket series with each year's SS income, the run-out age
  (the first unmeetable year; null when the money lasts), the age-100
  balance — that year's opening balance too, so the headline is
  exactly the series' last point — and the sensitivity table: whole percentages of the
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
