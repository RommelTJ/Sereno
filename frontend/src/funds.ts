// Pure helpers for the Funds & goals screen: per-fund card view-models and
// the header total. Notes come verbatim from GET /api/funds — the server
// derives them; only date display formatting happens here.

import type { Fund, FundInput, FundUpdate } from './api.ts'
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

export interface FundRow {
  id: number
  name: string
  amount: string
  plan: string
}

// The safe-to-spend funds card's rows: every active fund with its parked
// balance — the per-fund breakdown of the hero formula's money-in-funds
// term. The name goes through fundView so emojis render the same way
// everywhere; the plan matches the server-derived note's "$X / mo" and
// stays blank for a fund saving at no set pace.
export function fundRows(funds: Fund[]): FundRow[] {
  return funds.map((fund) => ({
    id: fund.id,
    name: fundView(fund).name,
    amount: formatUsd(fund.balance),
    plan:
      fund.monthly_plan !== null ? `${formatUsd(fund.monthly_plan)} / mo` : '',
  }))
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

// The row edit's raw fields → what to PUT. A blank (or 0) plan becomes
// null, pausing the fund's monthly funding without archiving it, and a
// blank emoji becomes null, clearing it. The form seeds every field from
// the fund, so an untouched one round-trips its current value.
export function fundEdit(
  name: string,
  emoji: string,
  rawMonthly: string,
): FundUpdate {
  return {
    name: name.trim(),
    emoji: emoji || null,
    monthly_plan: parseAmount(rawMonthly) || null,
  }
}

// The row Top up's raw "$ amount" field → the signed delta to post. A
// leading minus means a partial release back to spendable; parseAmount
// strips it, so the sign is read first. Blank and 0 both come back 0 —
// nothing should be posted.
export function topUpAmount(raw: string): number {
  const sign = raw.trim().startsWith('-') ? -1 : 1
  return sign * parseAmount(raw)
}
