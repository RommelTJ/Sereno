// The purchase wire format: planned purchases ride GET /api/forecast
// as repeated purchase=year:amount[:ongoing_delta] params — the name
// is display-only and never travels — and the max-affordable solver
// takes the same overrides plus its criterion params.

import { describe, expect, it } from 'vitest'
import {
  createSpendBands,
  deleteExpense,
  deleteIncome,
  fetchForecast,
  fetchLedger,
  fetchMaxAffordable,
  fetchSpendBands,
  updateExpense,
  updateIncome,
} from './api.ts'
import { LEDGER, ledgerPage } from './test/fixtures.ts'
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

// The band wire format: bands ride the same way as repeated
// band=start_year:end_year:amount params (an empty end year =
// open-ended), except that an *empty list* still sends a lone empty
// band= — "explicitly flat" — because absence means "use the saved
// schedule" server-side. The note stays behind like a purchase's name.
describe('fetchForecast band params', () => {
  it('appends one band param per band and never the note', async () => {
    const fetchMock = stubApi({ '/api/forecast': null })
    await fetchForecast({
      bands: [
        {
          start_year: 2031,
          end_year: 2040,
          annual_amount: 55_000,
          note: 'peak travel years',
        },
        { start_year: 2045, end_year: null, annual_amount: 38_000 },
      ],
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('band=2031%3A2040%3A55000&band=2045%3A%3A38000')
    expect(url).not.toContain('peak')
  })

  it('sends a lone empty band param for an explicitly flat override', async () => {
    const fetchMock = stubApi({ '/api/forecast': null })
    await fetchForecast({ bands: [] })
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/forecast?band=')
  })

  it('sends no band params when bands are untouched', async () => {
    const fetchMock = stubApi({ '/api/forecast': null })
    await fetchForecast({ spend: 60_000 })
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('band')
  })

  it('fetchMaxAffordable carries the band overrides', async () => {
    const fetchMock = stubApi({ '/api/forecast/max-affordable': null })
    await fetchMaxAffordable(2036, {
      bands: [{ start_year: 2045, end_year: null, annual_amount: 38_000 }],
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('band=2045%3A%3A38000')
  })
})

describe('spend band clients', () => {
  it('fetchSpendBands GETs the saved schedule', async () => {
    const fetchMock = stubApi({ '/api/spend-bands': [] })
    await fetchSpendBands()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/spend-bands')
  })

  it('createSpendBands POSTs the whole schedule, notes included', async () => {
    const fetchMock = stubApi({ 'POST /api/spend-bands': [] })
    await createSpendBands({
      effective_date: '2026-08-26',
      bands: [
        {
          start_year: 2031,
          end_year: 2040,
          annual_amount: 55_000,
          note: 'peak travel years',
        },
      ],
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/spend-bands')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      effective_date: '2026-08-26',
      bands: [
        {
          start_year: 2031,
          end_year: 2040,
          annual_amount: 55_000,
          note: 'peak travel years',
        },
      ],
    })
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

// The ledger's wire format: one page at a time. The newest page asks for
// nothing, an older one carries the page's oldest month as the cursor, and
// the has_more signal rides back untouched so the caller knows to stop.
describe('fetchLedger', () => {
  it('requests the newest page with no cursor', async () => {
    const fetchMock = stubApi({ '/api/ledger': ledgerPage([]) })
    await fetchLedger()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/ledger')
  })

  it('sends the cursor month as before', async () => {
    const fetchMock = stubApi({ '/api/ledger?before=2025-09': ledgerPage([]) })
    await fetchLedger('2025-09')
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/ledger?before=2025-09')
  })

  it('passes the page months and its has_more signal through', async () => {
    stubApi({ '/api/ledger': ledgerPage(LEDGER, true) })
    const page = await fetchLedger()
    expect(page.months.map((month) => month.month)).toEqual([
      '2026-06',
      '2026-05',
    ])
    expect(page.has_more).toBe(true)
  })
})
