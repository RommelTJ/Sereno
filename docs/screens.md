# Screens

What each view shows and which endpoints it reads. The dev server
serves them at <http://localhost:5173>.

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
