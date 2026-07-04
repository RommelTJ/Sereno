// Pure helpers for the Dashboard's live cards. All figures come straight
// from GET /api/budget-month and GET /api/funds — nothing is recomputed
// client-side beyond display math.

import type { BudgetMonth, Fund } from './api.ts'
import { formatUsd } from './ledger.ts'

// The Safe-to-spend card's progress bar: the share of the month's funding
// baseline still free to spend. A month with no funding keeps an empty bar.
export function stsBarPct(budget: BudgetMonth): number {
  if (budget.baseline <= 0) return 0
  return Math.max(
    0,
    Math.min(100, (budget.safe_to_spend / budget.baseline) * 100),
  )
}

export interface FundMini {
  id: number
  name: string
  right: string
}

// The card's top-3 mini list, in API order. Funds with a target show
// percent complete; an open-ended fund has no finish line, so it shows
// its parked balance instead.
export function fundsMini(funds: Fund[]): FundMini[] {
  return funds.slice(0, 3).map((fund) => ({
    id: fund.id,
    name: fund.name,
    right:
      fund.target_amount !== null
        ? `${Math.round((fund.balance / fund.target_amount) * 100)}%`
        : formatUsd(fund.balance),
  }))
}
