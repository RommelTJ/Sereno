// The purchase wire format: planned purchases ride GET /api/forecast
// as repeated purchase=year:amount[:ongoing_delta] params — the name
// is display-only and never travels — and the max-affordable solver
// takes the same overrides plus its criterion params.

import { describe, expect, it } from 'vitest'
import { fetchForecast, fetchMaxAffordable } from './api.ts'
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
