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
  deltas: (number | null)[] // aligned to values; null where nothing to subtract
  netWorth: number
  netWorthDelta: number | null // null on the oldest row loaded
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

// A delta annotates the figure beside it, so it carries its sign:
// "+$2,400.00" grew, "-$28.40" shrank, and a month that carried forward
// unchanged is a plain "$0.00" — no sign to read into.
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatUsd(delta)}` : formatUsd(delta)
}

// Favorable green, unfavorable red, unchanged muted. The figure is
// already signed for display, so a liability needs no special case:
// a debt paid down is a rise like any other.
export function deltaClass(delta: number): string {
  if (delta === 0) return 'text-muted-2'
  return delta > 0 ? 'text-accent' : 'text-red'
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
// quantity + price for the ETH-style kind, plus the cost basis the
// taxable kinds carry.
export interface BalanceDraft {
  value: string
  qty: string
  price: string
  basis: string
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
// ETH price, which comes from any eth-kind account's newest entry, and
// the basis, which seeds blank: it is an annual figure the server keeps
// standing between snapshots, so a blank field means "unchanged" rather
// than a number to re-type every month.
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
      basis: '',
    }
  }
  return {
    value: formatAmount(balance?.balance_usd ?? 0),
    qty: '',
    price: '',
    basis: '',
  }
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
// server derives its USD value), else the USD value. A cost basis rides
// along only where the waterfall prices a gain — the LTCG buckets — and
// only when one was typed: parseAmount reads '' as 0, and a zero basis
// is a bucket that is all gain, not a bucket left alone.
export function entryInput(
  account: Account,
  draft: BalanceDraft,
  asOfDate: string,
): BalanceEntryInput {
  const basis =
    account.tax_treatment === 'LTCG' && draft.basis.trim() !== ''
      ? { cost_basis: parseAmount(draft.basis) }
      : {}
  if (account.kind === 'eth') {
    return {
      account_id: account.id,
      as_of_date: asOfDate,
      quantity: parseAmount(draft.qty),
      unit_price: parseAmount(draft.price),
      ...basis,
    }
  }
  return {
    account_id: account.id,
    as_of_date: asOfDate,
    balance_usd: parseAmount(draft.value),
    ...basis,
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
  const figures = months.map((month) => {
    const byAccount = new Map(
      month.balances.map((balance) => [balance.account_id, balance]),
    )
    return columns.map((column) => columnFigure(column, byAccount))
  })
  return months.map((month, index) => {
    const current = figures[index]
    // Months arrive newest first, so the previous month is the next row.
    const previousMonth = months[index + 1]
    const previous = figures[index + 1]
    return {
      month: month.month,
      date: formatMonth(month.month),
      values: current.map((figure) => figure.value ?? 0),
      // The subtraction happens on the displayed figure, after the
      // liability sign flip, so a debt paid down rises like an asset
      // that grew — one rule, no branch on the account's type.
      deltas: current.map((figure, cell) => {
        const prior = previous?.[cell]
        if (!figure.whole || !prior?.whole) return null
        return roundCents(figure.value - prior.value)
      }),
      netWorth: month.net_worth,
      netWorthDelta:
        previousMonth === undefined
          ? null
          : roundCents(month.net_worth - previousMonth.net_worth),
    }
  })
}

// What one column shows for one month, and whether it is whole — every
// account behind it had an entry. A subtotal missing a member still
// shows that month's true total, but it is not a figure the next month
// can be subtracted from, so the delta suppresses itself rather than
// reading a newly tracked fund as a gain.
type ColumnFigure =
  | { whole: true; value: number }
  | { whole: false; value: number | null }

function columnFigure(
  column: LedgerColumn,
  byAccount: Map<number, LedgerBalance>,
): ColumnFigure {
  if (column.kind === 'account') {
    const balance = byAccount.get(column.account.id)
    if (!balance) return { whole: false, value: null }
    return {
      whole: true,
      value: column.account.is_liability
        ? -balance.balance_usd
        : balance.balance_usd,
    }
  }
  const held = column.accountIds
    .map((id) => byAccount.get(id))
    .filter((balance) => balance !== undefined)
  if (!held.length) return { whole: false, value: null }
  const value = held.reduce((total, balance) => total + balance.balance_usd, 0)
  return held.length === column.accountIds.length
    ? { whole: true, value }
    : { whole: false, value }
}

// Money differences are cents. Summing balances leaves float residue,
// and a residue is no change — not a hair of green.
function roundCents(value: number): number {
  const cents = Math.round(value * 100)
  return cents === 0 ? 0 : cents / 100
}
