// Pure helpers for the Dashboard's live cards. All figures come straight
// from GET /api/budget-month and GET /api/funds — nothing is recomputed
// client-side beyond display math.

import type { ActivityItem, BudgetMonth, Fund } from './api.ts'
import { monthLabel } from './budget.ts'
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

// "2026-06-10" → "Jun 10"
function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

// Row amounts keep cents only when they exist: "$2,400", "$28.40".
function usd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export type ActivityTone = 'credit' | 'debit' | 'treat' | 'fund'

export interface ActivityRow {
  key: string
  icon: string
  title: string
  sub: string
  amount: string
  tone: ActivityTone
}

// One activity item as a display row. An expense's emoji comes from its
// category's envelope in the passed month; every activity item funds that
// month, so a credit's sub names it; a "treat" — an expense in an
// over-budget envelope — shows in red.
export function activityRow(
  item: ActivityItem,
  budget: BudgetMonth,
  funds: Fund[],
): ActivityRow {
  const key = `${item.type}-${item.id}`
  const date = shortDate(item.txn_date)
  if (item.type === 'income') {
    return {
      key,
      icon: '💵',
      title: item.note ?? item.source ?? 'Income',
      sub: `Funds ${monthLabel(budget.month)} · ${date}`,
      amount: `+${usd(item.amount)}`,
      tone: 'credit',
    }
  }
  if (item.type === 'fund') {
    // The fund's name rides in the category slot; its emoji resolves from
    // the funds list, so an archived fund falls back to the generic icon.
    // The sign follows the headline: a contribution parks money (safe-to-
    // spend falls), a release makes it spendable again — but the tone stays
    // its own, because parked money was never spent.
    const fund = funds.find((candidate) => candidate.name === item.category)
    return {
      key,
      icon: fund?.emoji ?? '💰',
      title: item.category ?? 'Fund',
      sub: `Funding · ${date}`,
      amount:
        item.amount >= 0 ? `−${usd(item.amount)}` : `+${usd(-item.amount)}`,
      tone: 'fund',
    }
  }
  const envelope = budget.categories.find(
    (category) => category.name === item.category,
  )
  return {
    key,
    icon: envelope?.emoji ?? '🧾',
    title: item.note ?? item.category ?? 'Expense',
    sub: item.category ? `${item.category} · ${date}` : date,
    amount: `−${usd(item.amount)}`,
    tone: envelope != null && envelope.remaining < 0 ? 'treat' : 'debit',
  }
}
