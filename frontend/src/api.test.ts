// The purchase wire format: planned purchases ride GET /api/forecast
// as repeated purchase=year:amount[:ongoing_delta] params — the name
// is display-only and never travels — and the max-affordable solver
// takes the same overrides plus its criterion params.

import { describe, expect, it } from 'vitest'
import {
  deleteExpense,
  deleteIncome,
  fetchForecast,
  fetchMaxAffordable,
  updateExpense,
  updateIncome,
} from './api.ts'
import { stubApi } from './test/stubs.ts'

describe('fetchForecast', () => {
  it('appends one purchase param per planned purchase', async () => {
    const fetchMock = stubApi({ '/api/forecast': null })
    await fetchForecast({
      spend: 95_000,
      purchases: [
        { name: 'House', year: 2036, amount: 800_000 },
        { name: 'Car', year: 2041, amount: 70_000, ongoing_delta: 9_000 },
      ],
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('spend=95000')
    expect(url).toContain('purchase=2036%3A800000&purchase=2041%3A70000%3A9000')
    expect(url).not.toContain('House')
  })

  it('sends no purchase params when the list is empty', async () => {
    const fetchMock = stubApi({ '/api/forecast': null })
    await fetchForecast({ purchases: [] })
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('purchase')
  })
})

// Item edits are full replaces of the create body — the form sends the
// stored value for anything it doesn't edit — and deletes carry no body.
describe('expense edit and delete clients', () => {
  it('updateExpense PUTs the full replace body', async () => {
    const fetchMock = stubApi({ 'PUT /api/expenses/5': {} })
    await updateExpense(5, {
      txn_date: '2026-06-12',
      budget_month: '2026-07',
      amount: 118.4,
      funded_from: 'discretionary',
      category_id: 3,
      is_fixed: true,
      note: 'Lyft — consolidated',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/expenses/5')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      txn_date: '2026-06-12',
      budget_month: '2026-07',
      amount: 118.4,
      funded_from: 'discretionary',
      category_id: 3,
      is_fixed: true,
      note: 'Lyft — consolidated',
    })
  })

  it('deleteExpense issues a DELETE to the item path', async () => {
    const fetchMock = stubApi({ 'DELETE /api/expenses/5': {} })
    await deleteExpense(5)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/expenses/5')
    expect(init?.method).toBe('DELETE')
  })
})

describe('income edit and delete clients', () => {
  it('updateIncome PUTs the full replace body', async () => {
    const fetchMock = stubApi({ 'PUT /api/income/7': {} })
    await updateIncome(7, {
      txn_date: '2026-06-27',
      budget_month: '2026-07',
      source: 'paycheck',
      amount: 2800,
      tax_treatment: 'ORDINARY',
      account_id: 2,
      source_label: 'Spouse paycheck',
      note: 'Tip settled',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/income/7')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      txn_date: '2026-06-27',
      budget_month: '2026-07',
      source: 'paycheck',
      amount: 2800,
      tax_treatment: 'ORDINARY',
      account_id: 2,
      source_label: 'Spouse paycheck',
      note: 'Tip settled',
    })
  })

  it('deleteIncome issues a DELETE to the item path', async () => {
    const fetchMock = stubApi({ 'DELETE /api/income/7': {} })
    await deleteIncome(7)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/income/7')
    expect(init?.method).toBe('DELETE')
  })
})

describe('fetchMaxAffordable', () => {
  it('queries the solver with the year, criteria, and other purchases', async () => {
    const fetchMock = stubApi({ '/api/forecast/max-affordable': null })
    await fetchMaxAffordable(
      2036,
      { spend: 95_000, purchases: [{ name: 'Car', year: 2041, amount: 70_000 }] },
      { last_to_age: 95 },
    )
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/forecast/max-affordable?')
    expect(url).toContain('year=2036')
    expect(url).toContain('spend=95000')
    expect(url).toContain('last_to_age=95')
    expect(url).toContain('purchase=2041%3A70000')
  })
})
