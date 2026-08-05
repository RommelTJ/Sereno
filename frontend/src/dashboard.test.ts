// The activity feed's display rows. A pending item — a provisional
// amount to true up once it settles — wears a ⚠️ after its title; the
// suffix flows with the text when a long title wraps.

import { describe, expect, it } from 'vitest'
import { activityRow } from './dashboard.ts'
import { BUDGET_MONTH, FUNDS } from './test/fixtures.ts'

// The Poke expense and the Spouse-paycheck income from the fixture month.
const expense = BUDGET_MONTH.activity[0]
const income = BUDGET_MONTH.activity[3]
// The Groceries expense and the Emergency-fund contribution: whole-dollar
// amounts, where conditional cents used to diverge from the shared money
// formatter.
const wholeExpense = BUDGET_MONTH.activity[1]
const fundEntry = BUDGET_MONTH.activity[2]

// Amounts render through the shared money formatter — two decimals
// always, so "−$2,400.00" and "−$28.40" align in the feed, matching
// every other surface.
describe('activityRow amounts', () => {
  it('gives a whole-dollar income two decimals', () => {
    const row = activityRow(income, BUDGET_MONTH, FUNDS)
    expect(row.amount).toBe('+$2,400.00')
  })

  it('gives a whole-dollar expense two decimals', () => {
    const row = activityRow(wholeExpense, BUDGET_MONTH, FUNDS)
    expect(row.amount).toBe('−$387.00')
  })

  it('keeps the cents a fractional expense already shows', () => {
    const row = activityRow(expense, BUDGET_MONTH, FUNDS)
    expect(row.amount).toBe('−$28.40')
  })

  it('signs a fund contribution and a release by headline effect', () => {
    expect(activityRow(fundEntry, BUDGET_MONTH, FUNDS).amount).toBe('−$500.00')
    expect(
      activityRow({ ...fundEntry, amount: -500 }, BUDGET_MONTH, FUNDS).amount,
    ).toBe('+$500.00')
  })
})

describe('activityRow', () => {
  it('suffixes a pending expense title with the warning emoji', () => {
    const row = activityRow({ ...expense, pending: true }, BUDGET_MONTH, FUNDS)
    expect(row.title).toBe('Poke — treat yourself ⚠️')
  })

  it('suffixes a pending income title with the warning emoji', () => {
    const row = activityRow({ ...income, pending: true }, BUDGET_MONTH, FUNDS)
    expect(row.title).toBe('Spouse paycheck ⚠️')
  })

  it('leaves settled titles alone', () => {
    expect(activityRow(expense, BUDGET_MONTH, FUNDS).title).toBe(
      'Poke — treat yourself',
    )
    expect(activityRow(income, BUDGET_MONTH, FUNDS).title).toBe(
      'Spouse paycheck',
    )
  })
})
