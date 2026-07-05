// Pure derivations for the Settings & data view.

import type { Account, Fund, LedgerMonth, TaxBracket } from './api.ts'
import { formatUsd } from './ledger.ts'

export interface BucketRow {
  key: string
  name: string
  tag: string
  value: string
  negative: boolean
}

// The ledger is newest-first; an account's current value is the first
// balance found walking back through the months. Liabilities are stored
// positive and shown negative.
export function accountRows(
  accounts: Account[],
  ledger: LedgerMonth[],
): BucketRow[] {
  const latest = new Map<number, number>()
  for (const month of ledger) {
    for (const entry of month.balances) {
      if (!latest.has(entry.account_id)) {
        latest.set(entry.account_id, entry.balance_usd)
      }
    }
  }
  return accounts
    .filter((account) => account.active)
    .map((account) => {
      const balance = latest.get(account.id) ?? 0
      return {
        key: `account-${account.id}`,
        name: account.name,
        tag: account.kind,
        value: formatUsd(account.is_liability ? -balance : balance),
        negative: account.is_liability,
      }
    })
}

export function fundRows(funds: Fund[]): BucketRow[] {
  return funds.map((fund) => ({
    key: `fund-${fund.id}`,
    name: fund.name,
    tag: `fund · ${fund.kind}`,
    value: formatUsd(fund.balance),
    negative: false,
  }))
}

// 7 → "7.0%" — for values stored in percent units (return_pct, …).
export function formatPct(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

// 0.038 → "3.8%" — for values stored as fractions (niit_rate, brackets).
export function formatRate(rate: number): string {
  return `${+(rate * 100).toFixed(2)}%`
}

export function bracketLabel(bracket: TaxBracket): string {
  return bracket.upto == null
    ? `${formatRate(bracket.rate)} and up`
    : `${formatRate(bracket.rate)} to ${formatUsd(bracket.upto)}`
}
