// Typed client for the backend API. Shapes mirror the pydantic models in
// backend/src/sereno/api/balances.py, budget.py, and funds.py.

export interface Account {
  id: number
  name: string
  kind: string
  tax_treatment: string
  owner: string | null
  is_liability: boolean
  is_investable: boolean
  active: boolean
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

export interface Envelope {
  id: number
  name: string
  emoji: string | null
  planned: number
  spent: number
  remaining: number
}

export interface ActivityItem {
  type: 'expense' | 'income'
  id: number
  txn_date: string
  amount: number
  category: string | null
  source: string | null
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

export interface Fund {
  id: number
  name: string
  kind: string
  target_amount: number | null
  target_date: string | null
  monthly_plan: number | null
  balance: number
  note: string
}

export type IncomeSource =
  | 'paycheck'
  | 'transfer_in'
  | 'staking'
  | 'dividend'
  | 'interest'
  | 'soc_sec'

// budget_month is omitted so it defaults to the transaction's month
// server-side; fund_id goes with funded_from='fund', never alone.
export type ExpenseInput = {
  txn_date: string
  category_id: number
  amount: number
} & (
  | { funded_from: 'discretionary' }
  | { funded_from: 'fund'; fund_id: number }
)

export interface IncomeInput {
  txn_date: string
  budget_month: string
  source: IncomeSource
  amount: number
  note?: string
}

// kind is derived server-side: a blank target_date means a sinking fund, a
// set date means a goal; a blank target_amount is an open-ended fund.
export interface FundInput {
  name: string
  target_amount?: number
  target_date?: string
  monthly_plan?: number
}

export interface FundEntryInput {
  fund_id: number
  as_of_date: string
  balance: number
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

export const fetchAccounts = () => getJson<Account[]>('/api/accounts')
export const fetchLedger = () => getJson<LedgerMonth[]>('/api/ledger')
export const fetchNetWorth = () => getJson<NetWorth>('/api/net-worth')
export const fetchBudgetMonth = (month?: string) =>
  getJson<BudgetMonth>(
    month ? `/api/budget-month?month=${month}` : '/api/budget-month',
  )
export const fetchFunds = () => getJson<Fund[]>('/api/funds')

export const createBalanceEntry = (input: BalanceEntryInput) =>
  postJson('/api/balance-entries', input)
export const createExpense = (input: ExpenseInput) =>
  postJson('/api/expenses', input)
export const createIncome = (input: IncomeInput) =>
  postJson('/api/income', input)
export const createFund = (input: FundInput) =>
  postJsonReturning<Fund>('/api/funds', input)
export const createFundEntry = (input: FundEntryInput) =>
  postJson('/api/fund-entries', input)
