// Typed client for the backend API. Shapes mirror the pydantic models in
// backend/src/sereno/api/balances.py.

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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const fetchAccounts = () => getJson<Account[]>('/api/accounts')
export const fetchLedger = () => getJson<LedgerMonth[]>('/api/ledger')
export const fetchNetWorth = () => getJson<NetWorth>('/api/net-worth')

export async function createBalanceEntry(
  input: BalanceEntryInput,
): Promise<void> {
  const res = await fetch('/api/balance-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(`POST /api/balance-entries failed: ${res.status}`)
  }
}
