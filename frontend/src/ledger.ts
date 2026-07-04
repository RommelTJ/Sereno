// Pure helpers for the Ledger screen: mapping API months onto the handoff's
// table columns and formatting. Columns map by account kind — except the
// three brokerage funds, which share a kind and map by name. Car has no
// column but is still inside the API's net worth; the two cash accounts
// share the single Cash column; the mortgage (stored positive, per the
// schema) displays as a negative figure.

import type { Account, LedgerMonth } from './api.ts'

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
