// Pure helpers for the Safe-to-spend screen: envelope bar view-models and
// month labels. All figures come straight from GET /api/budget-month — the
// headline is never recomputed client-side.

import type { Envelope, ExpenseInput } from './api.ts'
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

// The funded-from select encodes its choice as 'discretionary' or
// 'fund:<id>'. budget_month is left to the server default (the txn's month).
// Returns null when the amount doesn't parse — nothing should be posted.
export function expenseInput(
  rawAmount: string,
  categoryId: number,
  fundedFrom: string,
  txnDate: string,
): ExpenseInput | null {
  const amount = parseAmount(rawAmount)
  if (!amount) return null
  const base = { txn_date: txnDate, category_id: categoryId, amount }
  return fundedFrom === 'discretionary'
    ? { ...base, funded_from: 'discretionary' }
    : {
        ...base,
        funded_from: 'fund',
        fund_id: Number(fundedFrom.slice('fund:'.length)),
      }
}
