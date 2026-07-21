// Pure helpers for the Ledger screen: one table column per active account
// (assets first, then liabilities), each month's cells aligned to those
// columns. Liabilities are stored positive (per the schema) and display
// as negative figures.

import type {
  Account,
  BalanceEntryInput,
  LedgerBalance,
  LedgerMonth,
} from './api.ts'

// The table's column accounts: active only, assets then liabilities,
// in id order within each group.
export function ledgerColumns(accounts: Account[]): Account[] {
  const active = accounts.filter((account) => account.active)
  return [
    ...active.filter((account) => !account.is_liability),
    ...active.filter((account) => account.is_liability),
  ]
}

export interface LedgerRow {
  month: string
  date: string
  values: number[] // aligned to the columns; liabilities negative
  netWorth: number
}

export function formatUsd(value: number): string {
  const rounded = Math.round(value)
  const digits = Math.abs(rounded).toLocaleString('en-US')
  return rounded < 0 ? `-$${digits}` : `$${digits}`
}

// The row represents the month, so its "YYYY-MM" key formats as
// "July 2026" — never an entry's exact date, which shifts as the
// month gets updated.
export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

// The draft the form edits for one selected account: a USD value, or
// quantity + price for the ETH-style kind.
export interface BalanceDraft {
  value: string
  qty: string
  price: string
}

// An account's newest ledger entry, walking back through the months.
export function latestBalance(
  months: LedgerMonth[],
  accountId: number,
): LedgerBalance | undefined {
  for (const month of months) {
    const balance = month.balances.find(
      (entry) => entry.account_id === accountId,
    )
    if (balance) return balance
  }
  return undefined
}

// Prefill the draft from the account's newest ledger entry.
export function draftFor(
  account: Account,
  months: LedgerMonth[],
): BalanceDraft {
  const balance = latestBalance(months, account.id)
  if (account.kind === 'eth') {
    return {
      value: '',
      qty: formatAmount(balance?.quantity ?? 0),
      price: formatAmount(balance?.unit_price ?? 0),
    }
  }
  return { value: formatAmount(balance?.balance_usd ?? 0), qty: '', price: '' }
}

// The draft's USD figure: quantity × price for ETH, else the value.
export function draftUsd(account: Account, draft: BalanceDraft): number {
  return account.kind === 'eth'
    ? parseAmount(draft.qty) * parseAmount(draft.price)
    : parseAmount(draft.value)
}

// Newest-month net worth with the selected account's draft substituted —
// liabilities contribute negatively, so paying one down raises the figure.
export function liveNetWorth(
  months: LedgerMonth[],
  account: Account,
  draft: BalanceDraft,
): number {
  const newest = months[0]
  if (!newest) return draftUsd(account, draft)
  const current =
    newest.balances.find((entry) => entry.account_id === account.id)
      ?.balance_usd ?? 0
  const sign = account.is_liability ? -1 : 1
  return newest.net_worth + sign * (draftUsd(account, draft) - current)
}

// The one append-only entry the Save posts: quantity + price for ETH (the
// server derives its USD value), else the USD value.
export function entryInput(
  account: Account,
  draft: BalanceDraft,
  asOfDate: string,
): BalanceEntryInput {
  if (account.kind === 'eth') {
    return {
      account_id: account.id,
      as_of_date: asOfDate,
      quantity: parseAmount(draft.qty),
      unit_price: parseAmount(draft.price),
    }
  }
  return {
    account_id: account.id,
    as_of_date: asOfDate,
    balance_usd: parseAmount(draft.value),
  }
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
  columns: Account[],
): LedgerRow[] {
  return months.map((month) => {
    const byAccount = new Map(
      month.balances.map((balance) => [balance.account_id, balance]),
    )
    return {
      month: month.month,
      date: formatMonth(month.month),
      values: columns.map((account) => {
        const balance = byAccount.get(account.id)
        if (!balance) return 0
        return account.is_liability
          ? -balance.balance_usd
          : balance.balance_usd
      }),
      netWorth: month.net_worth,
    }
  })
}
