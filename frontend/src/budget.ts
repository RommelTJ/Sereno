// Pure helpers for the Safe-to-spend screen: envelope bar view-models and
// month labels. All figures come straight from GET /api/budget-month — the
// headline is never recomputed client-side.

import type {
  Envelope,
  ExpenseInput,
  IncomeInput,
  IncomeSource,
} from './api.ts'
import { formatUsd, parseAmount } from './ledger.ts'

export interface EnvelopeView {
  id: number
  label: string
  right: string
  over: boolean
  barPct: number
}

// Over-budget envelopes show the overage ("$46 over") on a full red bar;
// a category with no plan yet keeps an empty bar instead of dividing by zero.
export function envelopeView(envelope: Envelope): EnvelopeView {
  const over = envelope.spent > envelope.planned
  const barPct =
    envelope.planned > 0
      ? Math.min(100, (envelope.spent / envelope.planned) * 100)
      : over
        ? 100
        : 0
  return {
    id: envelope.id,
    label: envelope.emoji
      ? `${envelope.emoji} ${envelope.name}`
      : envelope.name,
    right: over
      ? `${formatUsd(envelope.spent - envelope.planned)} over`
      : `${formatUsd(envelope.spent)} · ${formatUsd(envelope.remaining)} left`,
    over,
    barPct,
  }
}

// "2026-07" → "July"
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1).toLocaleDateString('en-US', {
    month: 'long',
  })
}

// "2026-06" → "June 2026" — the activity feed's section headers span
// years once the feed pages back far enough.
export function monthYearLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

// "2026-01" → "2025-12", pure string math.
export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`
}

// The funding sources the handoff's prototype offers, mapped onto the API's
// source values; the title context that the enum can't carry (whose
// paycheck, which transfer) prefills the editable Source title field and
// posts as source_label, matching the seed's style.
export interface SourceOption {
  value: string
  label: string
  source: IncomeSource
  sourceLabel: string
}

export const SOURCE_OPTIONS: SourceOption[] = [
  {
    value: 'spouse-paycheck',
    label: '💵 Spouse paycheck',
    source: 'paycheck',
    sourceLabel: 'Spouse paycheck',
  },
  {
    value: 'your-paycheck',
    label: '💵 Your paycheck',
    source: 'paycheck',
    sourceLabel: 'You paycheck',
  },
  {
    value: 'brokerage-withdrawal',
    label: '🏦 Brokerage withdrawal',
    source: 'transfer_in',
    sourceLabel: 'Brokerage withdrawal',
  },
  {
    value: 'eth-harvest',
    label: 'Ξ ETH harvest',
    source: 'staking',
    sourceLabel: 'ETH harvest',
  },
  {
    value: 'cash-plus-transfer',
    label: '🏠 Cash Plus transfer',
    source: 'transfer_in',
    sourceLabel: 'Cash Plus transfer',
  },
]

export interface MonthOption {
  value: string
  label: string
}

// The months a funding item can be tagged to: the current month and the
// next two — enough for the prepay pattern (June pay funds July).
export function fundsMonthOptions(todayIsoDate: string): MonthOption[] {
  const [year, month] = todayIsoDate.split('-').map(Number)
  return [0, 1, 2].map((offset) => {
    const date = new Date(year, month - 1 + offset)
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      }),
    }
  })
}

// Returns null when the amount doesn't parse — nothing should be posted.
// A whitespace-only source title or note is omitted from the payload,
// never sent empty.
export function incomeInput(
  rawAmount: string,
  sourceKey: string,
  budgetMonth: string,
  txnDate: string,
  rawSourceLabel: string,
  rawNote: string,
): IncomeInput | null {
  const amount = parseAmount(rawAmount)
  const option = SOURCE_OPTIONS.find((source) => source.value === sourceKey)
  if (!amount || !option) return null
  const sourceLabel = rawSourceLabel.trim()
  const note = rawNote.trim()
  return {
    txn_date: txnDate,
    budget_month: budgetMonth,
    source: option.source,
    amount,
    ...(sourceLabel ? { source_label: sourceLabel } : {}),
    ...(note ? { note } : {}),
  }
}

// The Paid-from select encodes its choice as 'cat:<id>' (an envelope —
// discretionary spending against that category) or 'fund:<id>' (fund
// spending, no category). budget_month is left to the server default (the
// txn's month). Returns null when the amount or the picked id doesn't
// parse — nothing should be posted. A whitespace-only note is omitted
// from the payload, never sent empty.
export function expenseInput(
  rawAmount: string,
  paidFrom: string,
  txnDate: string,
  rawNote: string,
): ExpenseInput | null {
  const amount = parseAmount(rawAmount)
  if (!amount) return null
  const note = rawNote.trim()
  const base = {
    txn_date: txnDate,
    amount,
    ...(note ? { note } : {}),
  }
  const [kind, rawId] = paidFrom.split(':')
  const id = Number(rawId)
  if (!id) return null
  if (kind === 'cat') {
    return { ...base, funded_from: 'discretionary', category_id: id }
  }
  if (kind === 'fund') return { ...base, funded_from: 'fund', fund_id: id }
  return null
}
