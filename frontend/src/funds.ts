// Pure helpers for the Funds & goals screen: per-fund card view-models and
// the header total. Notes come verbatim from GET /api/funds — the server
// derives them; only date display formatting happens here.

import type { Fund } from './api.ts'
import { formatUsd } from './ledger.ts'

export interface FundView {
  id: number
  name: string
  meta: string
  amount: string
  barPct: number | null
  done: boolean
  note: string
}

// "2027-08-01" → "Aug 2027"
export function monthYearLabel(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number)
  return new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

// An open-ended fund (no target) has no percent complete and no done state —
// barPct is null and the amount is just the balance.
export function fundView(fund: Fund): FundView {
  const target = fund.target_amount
  const done = target !== null && fund.balance >= target
  return {
    id: fund.id,
    name: fund.name,
    meta:
      fund.kind === 'goal' && fund.target_date
        ? `goal · ${monthYearLabel(fund.target_date)}`
        : 'sinking · no date',
    amount:
      target !== null
        ? `${formatUsd(fund.balance)} / ${formatUsd(target)}`
        : formatUsd(fund.balance),
    barPct: target !== null ? Math.min(100, (fund.balance / target) * 100) : null,
    done,
    note: fund.note,
  }
}

export function totalParked(funds: Fund[]): number {
  return funds.reduce((sum, fund) => sum + fund.balance, 0)
}
