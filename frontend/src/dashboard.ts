// Pure helpers for the Dashboard's live cards. All figures come straight
// from GET /api/budget-month and GET /api/funds — nothing is recomputed
// client-side beyond display math.

import type { ActivityItem, BudgetMonth, BudgetYear, Fund } from './api.ts'
import { monthLabel } from './budget.ts'
import { formatUsd } from './ledger.ts'

export interface YtdSummary {
  cumulative: number
  months: number
}

// The Budget report card's headline: the running variance through the
// last complete month, with how many months the number covers. The
// provisional month never counts — it undercounts until it closes, which
// would always skew the headline toward "under plan".
export function ytdSummary(report: BudgetYear): YtdSummary | null {
  const complete = report.months.filter(
    (row) => !row.provisional && row.cumulative_variance != null,
  )
  const last = complete.at(-1)
  if (last?.cumulative_variance == null) return null
  return { cumulative: last.cumulative_variance, months: complete.length }
}

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
    // The source label is the row's title; a row from before source_label
    // existed keeps its title-style note as the title, so the note only
    // joins the subtitle when it isn't already serving up top.
    const note = item.source_label != null ? item.note : null
    return {
      key,
      icon: '💵',
      title: item.source_label ?? item.note ?? item.source ?? 'Income',
      sub: `Funds ${monthLabel(budget.month)} · ${date}${note ? ` · ${note}` : ''}`,
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
  // A fund-funded expense carries its fund's name in the category slot,
  // so when the envelope lookup misses, the emoji resolves from the funds
  // list instead — the tone stays a debit either way: parked or not, the
  // money left the household, and with no envelope there is no treat.
  const envelope = budget.categories.find(
    (category) => category.name === item.category,
  )
  const fund = envelope
    ? undefined
    : funds.find((candidate) => candidate.name === item.category)
  return {
    key,
    icon: envelope?.emoji ?? fund?.emoji ?? '🧾',
    title: item.note ?? item.category ?? 'Expense',
    sub: item.category ? `${item.category} · ${date}` : date,
    amount: `−${usd(item.amount)}`,
    tone: envelope != null && envelope.remaining < 0 ? 'treat' : 'debit',
  }
}
