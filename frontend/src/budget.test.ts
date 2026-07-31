// Month arithmetic for the activity feed's paging buttons — nextMonth is
// the forward mirror of previousMonth, pure string math either way — and
// the leftover line's view text.

import { describe, expect, it } from 'vitest'
import {
  editMonthOptions,
  expenseUpdateInput,
  leftoverLine,
  nextMonth,
} from './budget.ts'
import { BUDGET_MONTH, MAY_BUDGET_MONTH } from './test/fixtures.ts'

describe('nextMonth', () => {
  it('advances within a year', () => {
    expect(nextMonth('2026-06')).toBe('2026-07')
  })

  it('pads the two-digit months', () => {
    expect(nextMonth('2026-09')).toBe('2026-10')
  })

  it('rolls December into January', () => {
    expect(nextMonth('2025-12')).toBe('2026-01')
  })
})

describe('leftoverLine', () => {
  it('reads leftover, assigned, and unassigned', () => {
    expect(leftoverLine(MAY_BUDGET_MONTH, 600)).toBe(
      'May left $1,000 · $600 assigned · $400 unassigned',
    )
  })

  it('ticks down to zero unassigned when fully assigned', () => {
    expect(leftoverLine(MAY_BUDGET_MONTH, 1_000)).toBe(
      'May left $1,000 · $1,000 assigned · $0 unassigned',
    )
  })

  it('shows an over-assignment instead of hiding it', () => {
    // More assigned than the month left means the difference came out of
    // the current month's checking buffer — the line must say so.
    expect(leftoverLine(MAY_BUDGET_MONTH, 1_050)).toBe(
      'May left $1,000 · $1,050 assigned · over-assigned $50',
    )
  })

  it('keeps showing when a late expense pushed the leftover negative', () => {
    const overspent = { ...MAY_BUDGET_MONTH, safe_to_spend: -50 }
    expect(leftoverLine(overspent, 100)).toBe(
      'May left -$50 · $100 assigned · over-assigned $150',
    )
  })

  it('hides when last month left nothing and nothing is assigned', () => {
    expect(
      leftoverLine({ ...MAY_BUDGET_MONTH, safe_to_spend: 0 }, 0),
    ).toBeNull()
    expect(
      leftoverLine({ ...MAY_BUDGET_MONTH, safe_to_spend: -25 }, 0),
    ).toBeNull()
  })
})

describe('editMonthOptions', () => {
  it('offers the txn month and the next two', () => {
    expect(
      editMonthOptions('2026-07', '2026-06-10').map((option) => option.value),
    ).toEqual(['2026-06', '2026-07', '2026-08'])
  })

  it('prepends a stored month outside the window', () => {
    const options = editMonthOptions('2026-04', '2026-06-10')
    expect(options.map((option) => option.value)).toEqual([
      '2026-04',
      '2026-06',
      '2026-07',
      '2026-08',
    ])
    expect(options[0].label).toBe('Apr 2026')
  })
})

describe('expenseUpdateInput', () => {
  // The Poke expense row: discretionary, not fixed, no account.
  const item = BUDGET_MONTH.activity[0]

  it('builds the full replace body from an envelope pick', () => {
    expect(
      expenseUpdateInput(item, '42.75', 'cat:3', '2026-06-26', '2026-07', ' '),
    ).toEqual({
      txn_date: '2026-06-26',
      budget_month: '2026-07',
      amount: 42.75,
      funded_from: 'discretionary',
      category_id: 3,
    })
  })

  it('posts a fund pick with no category', () => {
    expect(
      expenseUpdateInput(item, '42.75', 'fund:2', '2026-06-26', '2026-06', 'x'),
    ).toEqual({
      txn_date: '2026-06-26',
      budget_month: '2026-06',
      amount: 42.75,
      funded_from: 'fund',
      fund_id: 2,
      note: 'x',
    })
  })

  it('carries is_fixed and account_id through unchanged', () => {
    const fixed = { ...item, is_fixed: true, account_id: 7 }
    expect(
      expenseUpdateInput(fixed, '96', 'cat:1', '2026-06-10', '2026-06', ''),
    ).toMatchObject({ is_fixed: true, account_id: 7 })
  })

  it('returns null when the amount does not parse', () => {
    expect(
      expenseUpdateInput(item, 'abc', 'cat:1', '2026-06-10', '2026-06', ''),
    ).toBeNull()
  })
})
