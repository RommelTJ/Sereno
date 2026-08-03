// Month arithmetic for the month pager's buttons — nextMonth is the
// forward mirror of previousMonth, pure string math either way — and the
// create/edit form payload builders.

import { describe, expect, it } from 'vitest'
import {
  editMonthOptions,
  expenseInput,
  expenseUpdateInput,
  incomeInput,
  incomeUpdateInput,
  nextMonth,
  sourceOptionFor,
} from './budget.ts'
import { BUDGET_MONTH } from './test/fixtures.ts'

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

  it('carries a checked pending flag', () => {
    expect(
      expenseUpdateInput(item, '96', 'cat:1', '2026-06-10', '2026-06', '', true),
    ).toMatchObject({ pending: true })
  })

  it('omits pending when unchecked, clearing it on the full replace', () => {
    // Unchecking the box is how a settled charge drops its ⚠️: the PUT
    // body omits pending and the server's full replace defaults it false.
    const pendingItem = { ...item, pending: true }
    expect(
      expenseUpdateInput(
        pendingItem,
        '96',
        'cat:1',
        '2026-06-10',
        '2026-06',
        '',
        false,
      ),
    ).not.toHaveProperty('pending')
  })
})

describe('expenseInput', () => {
  it('carries a checked pending flag', () => {
    expect(expenseInput('42.75', 'cat:3', '2026-06-26', '', true)).toEqual({
      txn_date: '2026-06-26',
      amount: 42.75,
      funded_from: 'discretionary',
      category_id: 3,
      pending: true,
    })
  })

  it('omits pending when unchecked', () => {
    expect(expenseInput('42.75', 'cat:3', '2026-06-26', '')).not.toHaveProperty(
      'pending',
    )
  })

  it('tags the payload to an explicit budget month', () => {
    expect(
      expenseInput('12', 'cat:3', '2026-08-03', '', false, '2026-05'),
    ).toEqual({
      txn_date: '2026-08-03',
      budget_month: '2026-05',
      amount: 12,
      funded_from: 'discretionary',
      category_id: 3,
    })
  })

  it('leaves the budget month to the server default when not given', () => {
    expect(expenseInput('12', 'cat:3', '2026-08-03', '')).not.toHaveProperty(
      'budget_month',
    )
  })
})

describe('sourceOptionFor', () => {
  it('matches the stored source and label exactly', () => {
    expect(sourceOptionFor('paycheck', 'You paycheck').value).toBe(
      'your-paycheck',
    )
  })

  it('falls back to the first option carrying the source', () => {
    expect(sourceOptionFor('transfer_in', 'Custom label').value).toBe(
      'brokerage-withdrawal',
    )
  })

  it('falls back to the first option for an unmapped source', () => {
    expect(sourceOptionFor('dividend', null).value).toBe('spouse-paycheck')
  })
})

describe('incomeUpdateInput', () => {
  // The Spouse-paycheck income row: no tax treatment, no account.
  const item = BUDGET_MONTH.activity[3]

  it('builds the full replace body', () => {
    expect(
      incomeUpdateInput(
        item,
        '2500',
        'spouse-paycheck',
        '2026-06',
        '2026-05-27',
        'Spouse paycheck',
        ' ',
      ),
    ).toEqual({
      txn_date: '2026-05-27',
      budget_month: '2026-06',
      source: 'paycheck',
      amount: 2500,
      source_label: 'Spouse paycheck',
    })
  })

  it('carries tax_treatment and account_id through unchanged', () => {
    const taxed = { ...item, tax_treatment: 'ORDINARY' as const, account_id: 7 }
    expect(
      incomeUpdateInput(
        taxed,
        '2500',
        'spouse-paycheck',
        '2026-06',
        '2026-05-27',
        'Spouse paycheck',
        '',
      ),
    ).toMatchObject({ tax_treatment: 'ORDINARY', account_id: 7 })
  })

  it('returns null when the amount does not parse', () => {
    expect(
      incomeUpdateInput(
        item,
        'abc',
        'spouse-paycheck',
        '2026-06',
        '2026-05-27',
        '',
        '',
      ),
    ).toBeNull()
  })

  it('carries a checked pending flag', () => {
    expect(
      incomeUpdateInput(
        item,
        '2500',
        'spouse-paycheck',
        '2026-06',
        '2026-05-27',
        '',
        '',
        true,
      ),
    ).toMatchObject({ pending: true })
  })

  it('omits pending when unchecked, clearing it on the full replace', () => {
    const pendingItem = { ...item, pending: true }
    expect(
      incomeUpdateInput(
        pendingItem,
        '2500',
        'spouse-paycheck',
        '2026-06',
        '2026-05-27',
        '',
        '',
        false,
      ),
    ).not.toHaveProperty('pending')
  })
})

describe('incomeInput', () => {
  it('carries a checked pending flag', () => {
    expect(
      incomeInput('120', 'spouse-paycheck', '2026-06', '2026-06-15', '', '', true),
    ).toMatchObject({ pending: true })
  })

  it('omits pending when unchecked', () => {
    expect(
      incomeInput('120', 'spouse-paycheck', '2026-06', '2026-06-15', '', ''),
    ).not.toHaveProperty('pending')
  })
})
