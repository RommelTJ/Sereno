// Pure helpers for the Ledger screen: mapping API months onto the handoff's
// table columns and formatting. Columns map by account kind — except the
// three brokerage funds, which share a kind and map by name. Car has no
// column but is still inside the API's net worth; the two cash accounts
// share the single Cash column; the mortgage (stored positive, per the
// schema) displays as a negative figure.

import type { Account, BalanceEntryInput, LedgerMonth } from './api.ts'

export interface LedgerRow {
  month: string
  date: string
  eth: number
  vfiax: number
  vtiax: number
  vgsh: number
  retire: number
  home: number
  cash: number
  mortgage: number
  netWorth: number
}

export function formatUsd(value: number): string {
  const rounded = Math.round(value)
  const digits = Math.abs(rounded).toLocaleString('en-US')
  return rounded < 0 ? `-$${digits}` : `$${digits}`
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// The balances the form edits: the three brokerage funds (by name, they
// share a kind), retirement, and ETH as quantity × price.
export interface BalanceFormValues {
  vfiax: number
  vtiax: number
  vgsh: number
  retire: number
  ethQty: number
  ethPrice: number
}

const FUND_NAMES = new Set(['VFIAX', 'VTIAX', 'VGSH'])
const FORM_KINDS = new Set(['eth', '401k'])

const isFormAccount = (account: Account) =>
  FORM_KINDS.has(account.kind) || FUND_NAMES.has(account.name)

export function initialFormValues(
  months: LedgerMonth[],
  accounts: Account[],
): BalanceFormValues {
  const values: BalanceFormValues = {
    vfiax: 0,
    vtiax: 0,
    vgsh: 0,
    retire: 0,
    ethQty: 0,
    ethPrice: 0,
  }
  const newest = months[0]
  if (!newest) return values
  const byId = new Map(accounts.map((account) => [account.id, account]))
  for (const balance of newest.balances) {
    const account = byId.get(balance.account_id)
    if (!account) continue
    if (account.kind === 'eth') {
      values.ethQty = balance.quantity ?? 0
      values.ethPrice = balance.unit_price ?? 0
    } else if (account.name === 'VFIAX') values.vfiax = balance.balance_usd
    else if (account.name === 'VTIAX') values.vtiax = balance.balance_usd
    else if (account.name === 'VGSH') values.vgsh = balance.balance_usd
    else if (account.kind === '401k') values.retire = balance.balance_usd
  }
  return values
}

// Newest-month total of everything the form does not edit (home, cash
// accounts, car; liabilities negative), so the live net worth can be
// recomputed as form values + this constant.
export function otherBalancesTotal(
  months: LedgerMonth[],
  accounts: Account[],
): number {
  const newest = months[0]
  if (!newest) return 0
  const byId = new Map(accounts.map((account) => [account.id, account]))
  let total = 0
  for (const balance of newest.balances) {
    const account = byId.get(balance.account_id)
    if (!account || isFormAccount(account)) continue
    total += account.is_liability ? -balance.balance_usd : balance.balance_usd
  }
  return total
}

export function computeLiveNetWorth(
  values: BalanceFormValues,
  otherBalances: number,
): number {
  return (
    values.ethQty * values.ethPrice +
    values.vfiax +
    values.vtiax +
    values.vgsh +
    values.retire +
    otherBalances
  )
}

// One append-only entry per form account: the funds and retirement as USD,
// ETH as quantity + price (the server derives its USD value).
export function balanceEntryInputs(
  values: BalanceFormValues,
  accounts: Account[],
  asOfDate: string,
): BalanceEntryInput[] {
  const byName = new Map(accounts.map((account) => [account.name, account]))
  const inputs: BalanceEntryInput[] = []
  const eth = accounts.find((account) => account.kind === 'eth')
  if (eth) {
    inputs.push({
      account_id: eth.id,
      as_of_date: asOfDate,
      quantity: values.ethQty,
      unit_price: values.ethPrice,
    })
  }
  const usd = (account: Account | undefined, balance_usd: number) => {
    if (account) {
      inputs.push({ account_id: account.id, as_of_date: asOfDate, balance_usd })
    }
  }
  usd(byName.get('VFIAX'), values.vfiax)
  usd(byName.get('VTIAX'), values.vtiax)
  usd(byName.get('VGSH'), values.vgsh)
  usd(
    accounts.find((account) => account.kind === '401k'),
    values.retire,
  )
  return inputs
}

export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function parseAmount(raw: string): number {
  return Number(raw.replace(/[^0-9.]/g, '')) || 0
}

export function formatAmount(value: number): string {
  return value.toLocaleString('en-US')
}

export function ledgerRows(
  months: LedgerMonth[],
  accounts: Account[],
): LedgerRow[] {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  return months.map((month) => {
    const row: LedgerRow = {
      month: month.month,
      date: '',
      eth: 0,
      vfiax: 0,
      vtiax: 0,
      vgsh: 0,
      retire: 0,
      home: 0,
      cash: 0,
      mortgage: 0,
      netWorth: month.net_worth,
    }
    let latest = ''
    for (const balance of month.balances) {
      const account = byId.get(balance.account_id)
      if (!account) continue
      if (balance.as_of_date > latest) latest = balance.as_of_date
      if (account.kind === 'eth') row.eth += balance.balance_usd
      else if (account.name === 'VFIAX') row.vfiax += balance.balance_usd
      else if (account.name === 'VTIAX') row.vtiax += balance.balance_usd
      else if (account.name === 'VGSH') row.vgsh += balance.balance_usd
      else if (account.kind === '401k') row.retire += balance.balance_usd
      else if (account.kind === 'home') row.home += balance.balance_usd
      else if (account.kind === 'cash' || account.kind === 'cash_plus')
        row.cash += balance.balance_usd
      else if (account.kind === 'mortgage') row.mortgage -= balance.balance_usd
    }
    row.date = latest ? formatDate(latest) : month.month
    return row
  })
}
