// Pure helpers for the Dashboard's live cards. All figures come straight
// from GET /api/budget-month and GET /api/funds — nothing is recomputed
// client-side beyond display math.

import type { BudgetMonth } from './api.ts'

// The Safe-to-spend card's progress bar: the share of the month's funding
// baseline still free to spend. A month with no funding keeps an empty bar.
export function stsBarPct(budget: BudgetMonth): number {
  if (budget.baseline <= 0) return 0
  return Math.max(
    0,
    Math.min(100, (budget.safe_to_spend / budget.baseline) * 100),
  )
}
