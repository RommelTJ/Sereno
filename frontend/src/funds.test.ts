// The fund log's row view-model: what each fund_entry reads as, from the
// labelled links GET /api/fund-entries returns.

import { describe, expect, it } from 'vitest'
import type { FundLogEntry } from './api.ts'
import { fundLogRow } from './funds.ts'

const entry = (overrides: Partial<FundLogEntry> = {}): FundLogEntry => ({
  id: 1,
  fund: { id: 3, name: '1st Year Fund', emoji: '🛟', archived: false },
  as_of_date: '2026-09-03',
  source: 'spend',
  delta: -32.2,
  balance: 967.8,
  link: null,
  ...overrides,
})

const link = (kind: 'draw' | 'edit' | 'reversal') => ({
  type: 'expense' as const,
  id: 7,
  label: 'The Home Depot',
  kind,
})

describe('fundLogRow', () => {
  it('labels a linked draw by its row', () => {
    expect(fundLogRow(entry({ link: link('draw') })).description).toBe(
      'The Home Depot',
    )
  })

  it('marks a linked edit', () => {
    expect(fundLogRow(entry({ link: link('edit') })).description).toBe(
      'The Home Depot · edited',
    )
  })

  it('marks a linked reversal', () => {
    expect(
      fundLogRow(entry({ delta: 32.2, link: link('reversal') })).description,
    ).toBe('The Home Depot · reversed')
  })

  it('reads an unlinked draw as withdrawn', () => {
    expect(fundLogRow(entry()).description).toBe('Withdrawn')
  })

  it('reads an unlinked spend that raised the fund as returned', () => {
    // A deleted row's reversal loses its link with the row.
    expect(fundLogRow(entry({ delta: 32.2 })).description).toBe('Returned')
  })

  it.each([
    ['monthly_plan', 'Monthly contribution'],
    ['top_up', 'Top-up'],
    ['rollover', 'Rollover'],
    [null, 'Correction'],
  ])('names a %s entry', (source, description) => {
    expect(fundLogRow(entry({ source, delta: 100 })).description).toBe(
      description,
    )
  })

  it('reads the zeroing entry of an archived fund as archived', () => {
    const archived = entry({
      fund: { id: 3, name: '1st Year Fund', emoji: '🛟', archived: true },
      source: null,
      delta: -967.8,
      balance: 0,
    })
    expect(fundLogRow(archived).description).toBe('Archived')
  })

  it('signs the amount', () => {
    expect(fundLogRow(entry()).amount).toBe('−$32.20')
    expect(fundLogRow(entry({ source: 'top_up', delta: 300 })).amount).toBe(
      '+$300.00',
    )
  })

  it('formats the date and the balance after', () => {
    const row = fundLogRow(entry())
    expect(row.date).toBe('Sep 3')
    expect(row.balance).toBe('$967.80')
  })

  it('names the fund with its emoji, marking an archived one', () => {
    expect(fundLogRow(entry()).fund).toBe('🛟 1st Year Fund')
    const archived = entry({
      fund: { id: 3, name: 'Old car', emoji: null, archived: true },
    })
    expect(fundLogRow(archived).fund).toBe('Old car · archived')
  })
})
