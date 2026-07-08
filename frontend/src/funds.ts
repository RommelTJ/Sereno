// Pure helpers for the Funds & goals screen: per-fund card view-models and
// the header total. Notes come verbatim from GET /api/funds — the server
// derives them; only date display formatting happens here.

import type { Fund, FundInput } from './api.ts'
import { formatUsd, parseAmount } from './ledger.ts'

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
// barPct is null and the amount is just the balance. The name carries the
// fund's emoji when set, so every consumer renders them together.
export function fundView(fund: Fund): FundView {
  const target = fund.target_amount
  const done = target !== null && fund.balance >= target
  return {
    id: fund.id,
    name: fund.emoji ? `${fund.emoji} ${fund.name}` : fund.name,
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

export interface NewFund {
  fund: FundInput
  saved: number
}

// The form's raw fields → what to post. Returns null without a name —
// nothing should be posted. Blank emoji, target, date and monthly plan are
// omitted so the server treats them as unset (no emoji / open-ended /
// sinking); the saved amount becomes the first fund entry, appended after
// the fund is created.
export function newFund(
  name: string,
  emoji: string,
  rawTarget: string,
  rawSaved: string,
  targetDate: string,
  rawMonthly: string,
): NewFund | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const target = parseAmount(rawTarget)
  const monthly = parseAmount(rawMonthly)
  return {
    fund: {
      name: trimmed,
      ...(emoji ? { emoji } : {}),
      ...(target ? { target_amount: target } : {}),
      ...(targetDate ? { target_date: targetDate } : {}),
      ...(monthly ? { monthly_plan: monthly } : {}),
    },
    saved: parseAmount(rawSaved),
  }
}

// The curated emoji choices for the new-fund form — fund- and goal-themed,
// like the account and envelope lists in settings.ts. The DB stores the
// emoji as free TEXT; this list constrains only the UI.
export const FUND_EMOJI_OPTIONS = [
  { emoji: '🚨', label: 'Emergency' },
  { emoji: '🛠️', label: 'Maintenance' },
  { emoji: '🛟', label: 'Safety net' },
  { emoji: '🏊', label: 'Pool' },
  { emoji: '🚲', label: 'Bike' },
  { emoji: '✈️', label: 'Travel' },
  { emoji: '🏠', label: 'House' },
  { emoji: '🚗', label: 'Car' },
  { emoji: '🎁', label: 'Gifts' },
  { emoji: '💍', label: 'Wedding' },
  { emoji: '🎓', label: 'Education' },
]
