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

// A table column: a real account, or the derived brokerage subtotal.
// The union is what keeps the derived column from passing as an
// account — nothing reads `.id` or `.is_liability` off a column without
// narrowing first, so a subtotal can never be mistaken for a real row
// of the dimension the net-worth view sums.
export type LedgerColumn =
  | { kind: 'account'; account: Account }
  | { kind: 'subtotal'; label: string; accountIds: number[] }

// The table's columns: one per account, plus a "Brokerage" subtotal
// directly after the last brokerage fund. Members come from the kind,
// never the fund names, so a fourth fund joins the subtotal the moment
// it is classified — and an install with none classified gets no
// column at all.
export function ledgerTableColumns(accounts: Account[]): LedgerColumn[] {
  const ordered = ledgerColumns(accounts)
  const columns: LedgerColumn[] = ordered.map((account) => ({
    kind: 'account',
    account,
  }))
  const funds = ordered.filter((account) => account.kind === 'brokerage_fund')
  if (!funds.length) return columns
  const last = columns.findLastIndex(
    (column) =>
      column.kind === 'account' && column.account.kind === 'brokerage_fund',
  )
  columns.splice(last + 1, 0, {
    kind: 'subtotal',
    label: 'Brokerage',
    accountIds: funds.map((account) => account.id),
  })
  return columns
}

export interface LedgerRow {
  month: string
  date: string
  values: number[] // aligned to the columns; liabilities negative
  netWorth: number
}

// Two decimals always — "$2,400.00" and "$28.40" align in a column,
// and the displayed cents are the cents actually stored.
export function formatUsd(value: number): string {
  const digits = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return value < 0 ? `-$${digits}` : `$${digits}`
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

// The newest $/ETH across every eth-kind account's entries: the price is
// market-wide, so saving one eth account prefills the next. Months are
// walked newest first; within a month the newest as_of_date wins, since
// balances arrive in account order, not recency.
export function latestEthPrice(
  months: LedgerMonth[],
  accounts: Account[],
): number | undefined {
  const ethIds = new Set(
    accounts
      .filter((account) => account.kind === 'eth')
      .map((account) => account.id),
  )
  for (const month of months) {
    const priced = month.balances.filter(
      (entry) => ethIds.has(entry.account_id) && entry.unit_price !== null,
    )
    if (priced.length) {
      const newest = priced.reduce((best, entry) =>
        entry.as_of_date > best.as_of_date ? entry : best,
      )
      return newest.unit_price ?? undefined
    }
  }
  return undefined
}

// Prefill the draft from the account's newest ledger entry — except the
// ETH price, which comes from any eth-kind account's newest entry.
export function draftFor(
  account: Account,
  months: LedgerMonth[],
  accounts: Account[],
): BalanceDraft {
  const balance = latestBalance(months, account.id)
  if (account.kind === 'eth') {
    return {
      value: '',
      qty: formatQty(balance?.quantity ?? 0),
      price: formatAmount(latestEthPrice(months, accounts) ?? 0),
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

// The balance form's money seed: exact cents, so a prefilled value
// reads back exactly as stored.
export function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// The ETH quantity seed. A quantity is not money: five decimals, so a
// fractional holding survives a prefill-and-save intact.
export function formatQty(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  })
}

export function ledgerRows(
  months: LedgerMonth[],
  columns: LedgerColumn[],
): LedgerRow[] {
  return months.map((month) => {
    const byAccount = new Map(
      month.balances.map((balance) => [balance.account_id, balance]),
    )
    return {
      month: month.month,
      date: formatMonth(month.month),
      values: columns.map((column) => columnValue(column, byAccount) ?? 0),
      netWorth: month.net_worth,
    }
  })
}

// One column's figure for one month: the account's balance, liabilities
// negated for display, or the sum of the subtotal's members. Null where
// the month holds no entry for it — a column the table shows as zero,
// which is not the same fact as a balance of zero.
function columnValue(
  column: LedgerColumn,
  byAccount: Map<number, LedgerBalance>,
): number | null {
  if (column.kind === 'account') {
    const balance = byAccount.get(column.account.id)
    if (!balance) return null
    return column.account.is_liability
      ? -balance.balance_usd
      : balance.balance_usd
  }
  const held = column.accountIds
    .map((id) => byAccount.get(id))
    .filter((balance) => balance !== undefined)
  if (!held.length) return null
  return held.reduce((total, balance) => total + balance.balance_usd, 0)
}
