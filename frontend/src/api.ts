// Typed client for the backend API. Shapes mirror the pydantic models in
// backend/src/sereno/api/balances.py, budget.py, and funds.py.

import type { Zone } from './guardrails.ts'

// GET /api/health: the version is the backend package's own — derived
// from its pyproject.toml — so it reports what is actually deployed.
export interface Health {
  status: string
  version: string
}

export interface Account {
  id: number
  name: string
  kind: string
  tax_treatment: string
  owner: string | null
  is_liability: boolean
  is_investable: boolean
  withdrawal_priority: number | null
  access_age: number | null
  active: boolean
  emoji: string | null
}

export interface LedgerBalance {
  account_id: number
  as_of_date: string
  balance_usd: number
  quantity: number | null
  unit_price: number | null
}

export interface LedgerMonth {
  month: string
  net_worth: number
  balances: LedgerBalance[]
}

// One page of the ledger, newest month first — the twelve newest by
// default, older ones behind the `before` cursor. has_more says whether
// older months remain, so a caller paging backwards knows when to stop.
export interface LedgerPage {
  months: LedgerMonth[]
  has_more: boolean
}

export interface NetWorthPoint {
  month: string
  net_worth: number
}

export interface NetWorth {
  current: number | null
  yoy: number | null
  series: NetWorthPoint[]
}

// Either balance_usd alone (USD accounts), or quantity + unit_price
// (ETH-style; the server derives balance_usd as quantity × unit_price).
// cost_basis is the account's aggregate basis in dollars, sent only for
// the LTCG buckets whose gains the waterfall prices. Leaving it out
// means unchanged — the last basis recorded still stands.
export type BalanceEntryInput = {
  account_id: number
  as_of_date: string
  cost_basis?: number
} & ({ balance_usd: number } | { quantity: number; unit_price: number })

// POST /api/accounts inserts the dimension row (kind 'other',
// net-worth-only) plus an initial balance_entry dated today — later values
// go through the ledger. Liabilities are stored positive; a duplicate
// active name is a 409.
export interface AccountInput {
  name: string
  emoji?: string
  is_liability: boolean
  initial_value: number
}

// PUT /api/accounts/{id} classifies an account for the planners — kind,
// tax treatment, the investable flag, withdrawal priority (1 ETH,
// 2 brokerage, 3 401(k), 4 HSA), access age, and owner — revised in place:
// dimension metadata, not an effective-dated fact. A liability can never
// be investable or hold a priority (422).
export interface AccountClassificationInput {
  kind: string
  tax_treatment: string
  is_investable: boolean
  withdrawal_priority: number | null
  access_age: number | null
  owner: string | null
}

// GET /api/categories: the category dimension with each envelope's planned
// amount resolved for a month (default: the current one). is_mandatory
// marks spend that can't be cut (Groceries, Mortgage…) — the axis the
// budget report splits real spending on.
export interface Category {
  id: number
  name: string
  emoji: string | null
  is_mandatory: boolean
  planned: number
}

export interface Envelope {
  id: number
  name: string
  emoji: string | null
  planned: number
  spent: number
  remaining: number
}

// Rows carry every column their edit form pre-fills — the feed is the
// only read, so a tap costs no GET-by-id round trip. Expense rows carry
// category_id/funded_from/fund_id/account_id/is_fixed/budget_month,
// income rows budget_month/tax_treatment/account_id, both the pending
// flag behind the feed's ⚠️; fund rows (no edit affordance) carry
// all-null extras.
export interface ActivityItem {
  type: 'expense' | 'income' | 'fund'
  id: number
  txn_date: string
  amount: number
  category: string | null
  source: string | null
  source_label: string | null
  note: string | null
  category_id: number | null
  funded_from: 'discretionary' | 'fund' | null
  fund_id: number | null
  account_id: number | null
  is_fixed: boolean | null
  budget_month: string | null
  tax_treatment: 'ORDINARY' | 'LTCG' | 'TAX_FREE' | null
  pending: boolean | null
}

// rollover_assigned sums the month's rollover fund entries — last month's
// leftover being given a job. It never joins the safe-to-spend
// subtraction; the leftover line computes the unassigned remainder as the
// previous month's safe_to_spend minus it.
export interface BudgetMonth {
  month: string
  baseline: number
  rollover_assigned: number
  total_spent: number
  safe_to_spend: number
  categories: Envelope[]
  activity: ActivityItem[]
}

// One report row. actual is consumption-basis spending — every expense
// line, fund-funded one-offs included — split by the line's category
// flag into mandatory (can't be cut) and discretionary (everything
// else, uncategorized lines included); the two sum to actual. Fund
// contributions are transfers, not spending, riding apart in
// contributions (a release reads negative). Months outside data-start →
// the current month are entirely null — "no data", never "spent
// nothing" — and the current month rides along flagged provisional,
// since it undercounts until it closes. variance is planned − actual:
// positive = under plan.
export interface BudgetYearMonth {
  month: string
  planned: number | null
  mandatory: number | null
  discretionary: number | null
  actual: number | null
  variance: number | null
  cumulative_variance: number | null
  contributions: number | null
  provisional: boolean
}

export interface BudgetYear {
  year: number
  data_start: string | null
  months: BudgetYearMonth[]
}

export interface Fund {
  id: number
  name: string
  emoji: string | null
  kind: string
  target_amount: number | null
  target_date: string | null
  monthly_plan: number | null
  balance: number
  note: string
}

// The planning config: effective-dated, append-only rows. Each GET
// resolves the effective row (latest effective_date on or before today),
// so a null means no row exists yet. Percents (return_pct) are stored in
// percent units; rates (initial_rate, niit_rate) as fractions.
export interface Assumption {
  id: number
  effective_date: string
  return_pct: number
  inflation_pct: number
  eth_growth_pct: number | null
  // Applied to the staked balance; null models no staking income.
  staking_yield_pct: number | null
}

export interface SpendPlan {
  id: number
  effective_date: string
  annual_target: number
  initial_rate: number | null
  guardrail_band: number
  // The effective-dated moment real drawdown begins, set once — null
  // until it is scheduled; usually staged years ahead of the date.
  drawdown_start: string | null
}

// GET /api/spend-bands: the saved age-banded spend schedule — the
// effective version's rows, inclusive calendar years in today's
// dollars, a null end_year meaning open-ended. Empty when
// unconfigured or cleared: both mean flat spending at the plan's
// annual_target.
export interface SpendBand {
  id: number
  start_year: number
  end_year: number | null
  annual_amount: number
  note: string | null
}

// GET /api/mortgage: the loan's terms as effective-dated planning config,
// null until they are entered. `derived` is everything the terms plus the
// linked account's ledger balance imply — null when that account has no
// balance yet, or when the payment cannot cover one month's interest, so
// there is no payoff to report. Escrow is stored and shown but never
// amortized: it survives payoff, while principal & interest does not.
export interface MortgageDerived {
  balance: number
  balance_as_of: string
  payoff_date: string
  payoff_age: number
  remaining_months: number
  remaining_interest: number
  // Null when P&I alone would never amortize — no baseline to measure
  // the extra principal against.
  months_saved: number | null
  interest_saved: number | null
  // P&I plus extra, deflated to payoff by the inflation assumption.
  // Null until an assumptions row exists.
  payment_real_at_payoff: number | null
}

export interface Mortgage {
  id: number
  effective_date: string
  account_id: number
  annual_rate: number
  monthly_pi: number
  monthly_extra: number
  monthly_escrow: number
  derived: MortgageDerived | null
}

// GET /api/guardrails: the Guyton-Klinger engine evaluated at ?spend=
// against the latest month's investable total. The default spend is the
// trailing twelve complete months of actual spending once that much
// history exists (spend_source 'actual'), the plan's annual target
// until then ('target') — spend_months says how much history backs the
// figure — and a ?spend= what-if reports 'what_if'. Before
// drawdown_start (or while it is null) the zone is a readiness metric,
// not a live trigger. Null until a spend plan with an initial rate and
// a balance month exist.
export interface Guardrails {
  investable: number
  spend: number
  annual_target: number
  spend_source: 'actual' | 'target' | 'what_if'
  spend_months: number
  drawdown_start: string | null
  rate: number
  initial_rate: number
  band: number
  lower: number
  upper: number
  zone: Zone
  raise_trigger: number
  cut_trigger: number
  four_percent_spend: number
}

export interface SocialSecurityEntry {
  id: number
  person: 'you' | 'spouse'
  effective_date: string
  start_age: number
  monthly_amount: number
}

export interface TaxBracket {
  rate: number
  upto: number | null
}

export interface TaxParam {
  tax_year: number
  filing_status: string
  ltcg_0_ceiling: number
  ltcg_15_ceiling: number | null
  niit_rate: number
  niit_threshold: number | null
  state_treatment: string
  std_deduction: number | null
  ordinary_brackets: TaxBracket[] | null
}

// GET /api/sourcing: the tax-aware waterfall evaluated at an optional
// what-if ?age= (default: the server's birthdate-derived current age)
// and ?spend= (default: the plan's annual target). Null until a tax
// year, a balance, and a spend target exist.
export interface SourcingStep {
  name: string
  treatment: 'LTCG' | 'ORDINARY' | 'TAX_FREE'
  gross: number
  tax: number
  net: number
  note: string | null
  // The owner's own gate age, not one shifted onto your age axis.
  access_age: number | null
}

export interface Sourcing {
  target_net: number
  annual_target: number | null
  age: number
  tax_year: number
  ss_income: number
  staking_income: number
  income: number
  gap: number
  headroom: number
  steps: SourcingStep[]
  net_delivered: number
  shortfall: number
}

// GET /api/forecast: the longevity simulation. Spend, rates, and the
// Social Security figures resolve from stored config unless a query
// override stands in; the series carries each year's opening
// per-bucket balances — its January 1, the first point being today's
// — and that year's SS income. Null until a tax year, balances, a spend target,
// and return/inflation figures exist.
export interface ForecastPoint {
  age: number
  eth: number
  brokerage: number
  retirement: number
  hsa: number
  ss_income: number
}

export interface SensitivityRow {
  spend: number
  run_out_age: number | null
  balance_at_100: number
}

// A planned purchase as the screen holds it: the name is display-only
// and never travels — the wire format is repeated
// purchase=year:amount[:ongoing_delta] params.
export interface PlannedPurchaseInput {
  name: string
  year: number
  amount: number
  ongoing_delta?: number
}

// The purchase echoed back resolved, its year mapped onto the
// simulation's age axis server-side.
export interface PurchaseOut {
  year: number
  age: number
  amount: number
  ongoing_delta: number
}

// A year whose lump didn't fit while the base spend still cleared —
// an unaffordable purchase, not a run-out.
export interface UnaffordableYear {
  year: number
  age: number
  short: number
}

// The no-purchase outcome, series included so the chart can draw the
// divergence.
export interface ForecastBaseline {
  run_out_age: number | null
  balance_at_100: number
  series: ForecastPoint[]
}

// The outcome with this one purchase dropped — its marginal cost
// given the others stay.
export interface PurchaseCostRow {
  year: number
  amount: number
  run_out_age: number | null
  balance_at_100: number
}

// The band echoed back resolved — the schedule the simulation
// actually applied, whether saved or overridden.
export interface BandOut {
  start_year: number
  end_year: number | null
  annual_amount: number
}

export interface Forecast {
  spend: number
  annual_target: number | null
  start_age: number
  return_pct: number
  inflation_pct: number
  eth_growth_pct: number | null
  ss_you: number
  ss_spouse: number
  ss_start: number
  tax_year: number
  // When the earliest locked bucket opens, on your own age axis; null
  // when nothing in the portfolio is gated.
  first_unlock_age: number | null
  bands: BandOut[]
  purchases: PurchaseOut[]
  series: ForecastPoint[]
  run_out_age: number | null
  balance_at_100: number
  unaffordable: UnaffordableYear[]
  baseline: ForecastBaseline
  purchase_costs: PurchaseCostRow[]
  sensitivity: SensitivityRow[]
}

// The Forecast screen's transient what-ifs — never persisted; Settings
// owns config writes. Purchases ride along the same way. Bands are
// three-state: absent means "the saved schedule", an empty list means
// "explicitly flat", rows mean "exactly these".
export interface ForecastOverrides {
  spend?: number
  return_pct?: number
  inflation_pct?: number
  eth_growth_pct?: number
  ss_you?: number
  ss_spouse?: number
  ss_start?: number
  purchases?: PlannedPurchaseInput[]
  bands?: SpendBandInput[]
}

export type BindingConstraint = 'purchase_year_liquidity' | 'longevity'

// GET /api/forecast/max-affordable: the largest lump at the solve
// year satisfying the criterion, with the constraint that stopped
// anything bigger.
export interface MaxAffordable {
  year: number
  age: number
  max_amount: number
  binding_constraint: BindingConstraint
  run_out_age: number | null
  balance_at_100: number
}

// The solver's criterion: never running out by default, a target age
// or a terminal floor as variants.
export interface MaxAffordableCriteria {
  last_to_age?: number
  min_balance_at_100?: number
}

export type IncomeSource =
  | 'paycheck'
  | 'transfer_in'
  | 'staking'
  | 'dividend'
  | 'interest'
  | 'soc_sec'

// budget_month is omitted so it defaults to the transaction's month
// server-side. The union pairs each funding source with its id: an
// envelope pick is discretionary spending against its category, a fund
// pick posts the fund_id and no category — the fund itself says what the
// spend was for. A blank note is omitted, not sent empty, and so is an
// unchecked pending — the server defaults it false, which is how the
// full-replace PUT clears a settled charge's flag.
export type ExpenseInput = {
  txn_date: string
  // The month the spend counts against — the Safe-to-spend view's viewed
  // month, so a row entered while paged back lands where it was entered.
  // Omitted, the server defaults it to the txn's month.
  budget_month?: string
  amount: number
  note?: string
  pending?: boolean
} & (
  | { funded_from: 'discretionary'; category_id: number }
  | { funded_from: 'fund'; fund_id: number }
)

// source_label is the row's display title ("Spouse paycheck") — the
// context the source enum can't carry; note is a true note. Blank values
// are omitted, not sent empty. drawn_from_fund_id names the sinking fund
// the inflow came out of: the server appends the paired 'spend' fund
// entry alongside the row, so funding a month from a fund is one action.
export interface IncomeInput {
  txn_date: string
  budget_month: string
  source: IncomeSource
  amount: number
  source_label?: string
  note?: string
  pending?: boolean
  drawn_from_fund_id?: number
}

// PUT /api/expenses/{id} and /api/income/{id} are full replaces of the
// create bodies: the edit form sends the stored value for anything it
// doesn't edit (is_fixed, account_id, tax_treatment), so an update can't
// clobber it. budget_month is explicit on the expense update —
// reassigning the month is half the point of editing.
export type ExpenseUpdateInput = ExpenseInput & {
  budget_month: string
  is_fixed?: boolean
  account_id?: number
}

export interface IncomeUpdateInput extends IncomeInput {
  tax_treatment?: 'ORDINARY' | 'LTCG' | 'TAX_FREE'
  account_id?: number
}

// POST /api/categories inserts the category and its initial plan row;
// effective_month is omitted so the plan starts this month. A duplicate
// active name is a 409.
export interface CategoryInput {
  name: string
  emoji?: string
  planned: number
  effective_month?: string
}

// POST /api/categories/{id}/plan appends an effective-dated revision —
// the latest row per month wins; nothing is updated in place.
export interface CategoryPlanInput {
  planned: number
  effective_month?: string
}

// PUT /api/categories/{id} renames the dimension row in place — plans and
// expense lines keep their history; a null emoji clears it, and the
// mandatory flag is always sent since the server reads an omitted one as
// false. A name matching another active category is a 409.
export interface CategoryUpdate {
  name: string
  emoji: string | null
  is_mandatory: boolean
}

// kind is derived server-side: a blank target_date means a sinking fund, a
// set date means a goal; a blank target_amount is an open-ended fund.
export interface FundInput {
  name: string
  emoji?: string
  target_amount?: number
  target_date?: string
  monthly_plan?: number
}

// Revises the fund in place — the fund row is a dimension, so its identity
// fields are mutable and its entry history is untouched. Every field is
// optional server-side: an omitted one keeps its stored value. A null
// monthly_plan pauses funding without archiving; a null emoji clears it.
export interface FundUpdate {
  name?: string
  emoji?: string | null
  monthly_plan: number | null
}

// POST /api/funds/{id}/top-up appends a 'top_up' entry with the delta as
// its contribution — the server computes the new balance from the latest
// entry. A positive amount parks money and trims the month's
// safe-to-spend; a negative amount is a partial release, raising it back.
// source 'rollover' assigns last month's leftover instead: recorded on the
// fund identically, but excluded from this month's headline, feed, and
// yearly actual. as_of_date lands the move in the calendar month it
// belongs to; a date behind the fund's latest entry is a 422. The default
// source and a today as_of_date are omitted, never sent.
export type TopUpSource = 'top_up' | 'rollover'

export interface FundTopUpInput {
  amount: number
  source?: TopUpSource
  as_of_date?: string
}

// Config edits append: each input becomes a new effective-dated row and
// the GETs resolve to it. Blank optional fields are omitted, not nulled.
export interface AssumptionInput {
  effective_date: string
  return_pct: number
  inflation_pct: number
  eth_growth_pct?: number
  staking_yield_pct?: number
}

export interface SpendPlanInput {
  effective_date: string
  annual_target: number
  initial_rate?: number
  guardrail_band?: number
  drawdown_start?: string
}

// A spend band as the screens hold it. The note never travels in
// band= params — like a purchase's name — but persists on save.
export interface SpendBandInput {
  start_year: number
  end_year: number | null
  annual_amount: number
  note?: string | null
}

// POST /api/spend-bands: the whole schedule as one effective-dated,
// append-only version — an empty bands list persists "back to flat".
export interface SpendScheduleInput {
  effective_date: string
  bands: SpendBandInput[]
}

export interface MortgageInput {
  effective_date: string
  account_id: number
  annual_rate: number
  monthly_pi: number
  monthly_extra?: number
  monthly_escrow?: number
}

export interface SocialSecurityInput {
  person: 'you' | 'spouse'
  effective_date: string
  start_age: number
  monthly_amount: number
}

// The shared tax-param write body: POST adds a year (tax_year included),
// PUT revises one in place (the year comes from the path — it's the
// table's primary key, so a revision replaces rather than appends).
export interface TaxParamBody {
  filing_status: string
  ltcg_0_ceiling: number
  ltcg_15_ceiling?: number
  niit_rate: number
  niit_threshold?: number
  state_treatment: string
  std_deduction?: number
  ordinary_brackets?: TaxBracket[]
}

export interface TaxParamInput extends TaxParamBody {
  tax_year: number
}

export interface FundEntryInput {
  fund_id: number
  as_of_date: string
  balance: number
}

export interface QuickLink {
  id: number
  label: string
  url: string
}

export interface QuickLinkInput {
  label: string
  url: string
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function postJsonReturning<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function postJson(path: string, body: unknown): Promise<void> {
  await postJsonReturning<unknown>(path, body)
}

async function putJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`PUT ${path} failed: ${res.status}`)
  }
}

async function deleteJson(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed: ${res.status}`)
  }
}

export const fetchHealth = () => getJson<Health>('/api/health')
export const fetchAccounts = () => getJson<Account[]>('/api/accounts')
export const fetchLedger = (before?: string) =>
  getJson<LedgerPage>(before ? `/api/ledger?before=${before}` : '/api/ledger')
export const fetchNetWorth = () => getJson<NetWorth>('/api/net-worth')
export const fetchBudgetMonth = (month?: string) =>
  getJson<BudgetMonth>(
    month ? `/api/budget-month?month=${month}` : '/api/budget-month',
  )
export const fetchBudgetYear = (year?: number) =>
  getJson<BudgetYear>(
    year != null ? `/api/budget-year?year=${year}` : '/api/budget-year',
  )
export const fetchCategories = () => getJson<Category[]>('/api/categories')
export const fetchFunds = () => getJson<Fund[]>('/api/funds')
export const fetchAssumptions = () =>
  getJson<Assumption | null>('/api/assumptions')
export const fetchSpendPlan = () => getJson<SpendPlan | null>('/api/spend-plan')
export const fetchSpendBands = () => getJson<SpendBand[]>('/api/spend-bands')
export const fetchMortgage = () => getJson<Mortgage | null>('/api/mortgage')
export const fetchGuardrails = (spend?: number) =>
  getJson<Guardrails | null>(
    spend != null ? `/api/guardrails?spend=${spend}` : '/api/guardrails',
  )
export const fetchSourcing = (age?: number, spend?: number) => {
  const params = new URLSearchParams()
  if (age != null) {
    params.set('age', String(age))
  }
  if (spend != null) {
    params.set('spend', String(spend))
  }
  const query = params.toString()
  return getJson<Sourcing | null>(query ? `/api/sourcing?${query}` : '/api/sourcing')
}
const purchaseParam = (purchase: PlannedPurchaseInput) => {
  const base = `${purchase.year}:${purchase.amount}`
  return purchase.ongoing_delta ? `${base}:${purchase.ongoing_delta}` : base
}

const bandParam = (band: SpendBandInput) =>
  `${band.start_year}:${band.end_year ?? ''}:${band.annual_amount}`

const forecastParams = (overrides: ForecastOverrides) => {
  const { purchases, bands, ...scalars } = overrides
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(scalars)) {
    if (value != null) {
      params.set(key, String(value))
    }
  }
  for (const purchase of purchases ?? []) {
    params.append('purchase', purchaseParam(purchase))
  }
  // Bands are three-state: leaving them out means "the saved
  // schedule" server-side, so an empty list must still send a lone
  // empty band= — "explicitly flat".
  if (bands) {
    if (bands.length === 0) {
      params.append('band', '')
    }
    for (const band of bands) {
      params.append('band', bandParam(band))
    }
  }
  return params
}

export const fetchForecast = (overrides: ForecastOverrides = {}) => {
  const query = forecastParams(overrides).toString()
  return getJson<Forecast | null>(query ? `/api/forecast?${query}` : '/api/forecast')
}

export const fetchMaxAffordable = (
  year: number,
  overrides: ForecastOverrides = {},
  criteria: MaxAffordableCriteria = {},
) => {
  const params = forecastParams(overrides)
  params.set('year', String(year))
  for (const [key, value] of Object.entries(criteria)) {
    if (value != null) {
      params.set(key, String(value))
    }
  }
  return getJson<MaxAffordable | null>(`/api/forecast/max-affordable?${params.toString()}`)
}
export const fetchSocialSecurity = () =>
  getJson<SocialSecurityEntry[]>('/api/social-security')
export const fetchTaxParams = () => getJson<TaxParam[]>('/api/tax-params')

export const createAccount = (input: AccountInput) =>
  postJsonReturning<Account>('/api/accounts', input)
export const updateAccount = (
  accountId: number,
  input: AccountClassificationInput,
) => putJson(`/api/accounts/${accountId}`, input)
export const updateAccountOrder = (ids: number[]) =>
  putJson('/api/accounts/order', { ids })
export const deactivateAccount = (accountId: number) =>
  postJson(`/api/accounts/${accountId}/deactivate`, {})
export const createBalanceEntry = (input: BalanceEntryInput) =>
  postJson('/api/balance-entries', input)
export const createCategory = (input: CategoryInput) =>
  postJson('/api/categories', input)
export const updateCategoryPlan = (categoryId: number, input: CategoryPlanInput) =>
  postJson(`/api/categories/${categoryId}/plan`, input)
export const updateCategory = (categoryId: number, input: CategoryUpdate) =>
  putJson(`/api/categories/${categoryId}`, input)
export const updateCategoryOrder = (ids: number[]) =>
  putJson('/api/categories/order', { ids })
export const archiveCategory = (categoryId: number) =>
  postJson(`/api/categories/${categoryId}/archive`, {})
export const fetchQuickLinks = () => getJson<QuickLink[]>('/api/quick-links')
export const createQuickLink = (input: QuickLinkInput) =>
  postJson('/api/quick-links', input)
export const updateQuickLink = (quickLinkId: number, input: QuickLinkInput) =>
  putJson(`/api/quick-links/${quickLinkId}`, input)
export const updateQuickLinkOrder = (ids: number[]) =>
  putJson('/api/quick-links/order', { ids })
export const deleteQuickLink = (quickLinkId: number) =>
  deleteJson(`/api/quick-links/${quickLinkId}`)
export const createExpense = (input: ExpenseInput) =>
  postJson('/api/expenses', input)
export const updateExpense = (expenseId: number, input: ExpenseUpdateInput) =>
  putJson(`/api/expenses/${expenseId}`, input)
export const deleteExpense = (expenseId: number) =>
  deleteJson(`/api/expenses/${expenseId}`)
export const createIncome = (input: IncomeInput) =>
  postJson('/api/income', input)
export const updateIncome = (incomeId: number, input: IncomeUpdateInput) =>
  putJson(`/api/income/${incomeId}`, input)
export const deleteIncome = (incomeId: number) =>
  deleteJson(`/api/income/${incomeId}`)
export const createFund = (input: FundInput) =>
  postJsonReturning<Fund>('/api/funds', input)
export const createFundEntry = (input: FundEntryInput) =>
  postJson('/api/fund-entries', input)
export const updateFund = (fundId: number, input: FundUpdate) =>
  putJson(`/api/funds/${fundId}`, input)
export const topUpFund = (fundId: number, input: FundTopUpInput) =>
  postJson(`/api/funds/${fundId}/top-up`, input)
export const archiveFund = (fundId: number) =>
  postJson(`/api/funds/${fundId}/archive`, {})
export const createAssumption = (input: AssumptionInput) =>
  postJson('/api/assumptions', input)
export const createSpendPlan = (input: SpendPlanInput) =>
  postJson('/api/spend-plan', input)
export const createSpendBands = (input: SpendScheduleInput) =>
  postJson('/api/spend-bands', input)
export const createMortgage = (input: MortgageInput) =>
  postJson('/api/mortgage', input)
export const createSocialSecurity = (input: SocialSecurityInput) =>
  postJson('/api/social-security', input)
export const createTaxParam = (input: TaxParamInput) =>
  postJson('/api/tax-params', input)
export const updateTaxParam = (taxYear: number, body: TaxParamBody) =>
  putJson(`/api/tax-params/${taxYear}`, body)
