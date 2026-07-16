// Typed client for the backend API. Shapes mirror the pydantic models in
// backend/src/sereno/api/balances.py, budget.py, and funds.py.

import type { Zone } from './guardrails.ts'

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
export type BalanceEntryInput = { account_id: number; as_of_date: string } & (
  | { balance_usd: number }
  | { quantity: number; unit_price: number }
)

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
// 2 brokerage, 3 tax-advantaged), and access age — revised in place:
// dimension metadata, not an effective-dated fact. A liability can never
// be investable or hold a priority (422).
export interface AccountClassificationInput {
  kind: string
  tax_treatment: string
  is_investable: boolean
  withdrawal_priority: number | null
  access_age: number | null
}

// GET /api/categories: the category dimension with each envelope's planned
// amount resolved for a month (default: the current one).
export interface Category {
  id: number
  name: string
  emoji: string | null
  is_fixed: boolean
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

export interface ActivityItem {
  type: 'expense' | 'income' | 'fund'
  id: number
  txn_date: string
  amount: number
  category: string | null
  source: string | null
  source_label: string | null
  note: string | null
}

export interface BudgetMonth {
  month: string
  baseline: number
  total_spent: number
  safe_to_spend: number
  categories: Envelope[]
  activity: ActivityItem[]
}

// One report row. Months outside data-start → the current month are
// entirely null — "no data", never "spent nothing" — and the current
// month rides along flagged provisional, since it undercounts until it
// closes. variance is planned − actual: positive = under plan.
export interface BudgetYearMonth {
  month: string
  planned: number | null
  actual: number | null
  variance: number | null
  cumulative_variance: number | null
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
}

export interface SpendPlan {
  id: number
  effective_date: string
  annual_target: number
  initial_rate: number | null
  guardrail_band: number
}

// GET /api/guardrails: the Guyton-Klinger engine evaluated at ?spend=
// (default: the plan's annual target) against the latest month's
// investable total. Null until a spend plan with an initial rate and a
// balance month exist.
export interface Guardrails {
  investable: number
  spend: number
  annual_target: number
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
  treatment: 'LTCG' | 'ORDINARY'
  gross: number
  tax: number
  net: number
  note: string | null
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
// override stands in; the series carries per-bucket balances and each
// year's SS income. Null until a tax year, balances, a spend target,
// and return/inflation figures exist.
export interface ForecastPoint {
  age: number
  eth: number
  brokerage: number
  retirement: number
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
// owns config writes. Purchases ride along the same way.
export interface ForecastOverrides {
  spend?: number
  return_pct?: number
  inflation_pct?: number
  eth_growth_pct?: number
  ss_you?: number
  ss_spouse?: number
  ss_start?: number
  purchases?: PlannedPurchaseInput[]
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
// spend was for. A blank note is omitted, not sent empty.
export type ExpenseInput = {
  txn_date: string
  amount: number
  note?: string
} & (
  | { funded_from: 'discretionary'; category_id: number }
  | { funded_from: 'fund'; fund_id: number }
)

// source_label is the row's display title ("Spouse paycheck") — the
// context the source enum can't carry; note is a true note. Blank values
// are omitted, not sent empty.
export interface IncomeInput {
  txn_date: string
  budget_month: string
  source: IncomeSource
  amount: number
  source_label?: string
  note?: string
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
// expense lines keep their history; a null emoji clears it. A name matching
// another active category is a 409.
export interface CategoryUpdate {
  name: string
  emoji: string | null
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
export interface FundTopUpInput {
  amount: number
}

// Config edits append: each input becomes a new effective-dated row and
// the GETs resolve to it. Blank optional fields are omitted, not nulled.
export interface AssumptionInput {
  effective_date: string
  return_pct: number
  inflation_pct: number
  eth_growth_pct?: number
}

export interface SpendPlanInput {
  effective_date: string
  annual_target: number
  initial_rate?: number
  guardrail_band?: number
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

export const fetchAccounts = () => getJson<Account[]>('/api/accounts')
export const fetchLedger = () => getJson<LedgerMonth[]>('/api/ledger')
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

const forecastParams = (overrides: ForecastOverrides) => {
  const { purchases, ...scalars } = overrides
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(scalars)) {
    if (value != null) {
      params.set(key, String(value))
    }
  }
  for (const purchase of purchases ?? []) {
    params.append('purchase', purchaseParam(purchase))
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
export const createIncome = (input: IncomeInput) =>
  postJson('/api/income', input)
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
export const createSocialSecurity = (input: SocialSecurityInput) =>
  postJson('/api/social-security', input)
export const createTaxParam = (input: TaxParamInput) =>
  postJson('/api/tax-params', input)
export const updateTaxParam = (taxYear: number, body: TaxParamBody) =>
  putJson(`/api/tax-params/${taxYear}`, body)
