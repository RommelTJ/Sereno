// The activity feed's display rows. A pending item — a provisional
// amount to true up once it settles — wears a ⚠️ after its title; the
// suffix flows with the text when a long title wraps.

import { describe, expect, it } from 'vitest'
import { activityRow } from './dashboard.ts'
import { BUDGET_MONTH, FUNDS } from './test/fixtures.ts'

// The Poke expense and the Spouse-paycheck income from the fixture month.
const expense = BUDGET_MONTH.activity[0]
const income = BUDGET_MONTH.activity[3]

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
