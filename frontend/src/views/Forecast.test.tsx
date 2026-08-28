import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNTS,
  FORECAST,
  SPEND_BANDS,
  UNCLASSIFIED_ACCOUNTS,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import { todayIso } from '../ledger.ts'
import Forecast from './Forecast.tsx'

// The same portfolio asked for too much: the money lasts to 71.
const FORECAST_RUNS_OUT = {
  ...FORECAST,
  spend: 200_000,
  run_out_age: 72,
  balance_at_100: 0,
}

// New purchases land in next year's simulation by default.
const NEXT_YEAR = new Date().getFullYear() + 1

// The server's echo of a house purchase ten years out, its cost
// visible in the terminal balance and the drop-it row.
const HOUSE = { year: 2046, age: 48, amount: 800_000, ongoing_delta: 0 }

const FORECAST_WITH_PURCHASE = {
  ...FORECAST,
  purchases: [HOUSE],
  balance_at_100: 4_112_345,
  purchase_costs: [
    { year: 2046, amount: 800_000, run_out_age: null, balance_at_100: 5_512_345 },
  ],
}

// The same purchase the year couldn't hold: the verdict stays green
// while the year itself reports the miss.
const FORECAST_UNAFFORDABLE = {
  ...FORECAST_WITH_PURCHASE,
  balance_at_100: 5_512_345,
  unaffordable: [{ year: 2046, age: 48, short: 278_149 }],
}

// A baseline visibly above the with-purchases path: 150k columns
// against a 200k baseline leave a hatched forgone-growth cap.
const FORECAST_WITH_CAP = {
  ...FORECAST_WITH_PURCHASE,
  series: FORECAST.series.map((point) => ({
    ...point,
    eth: 150_000,
    brokerage: 0,
    retirement: 0,
  })),
  baseline: {
    run_out_age: null,
    balance_at_100: 5_512_345,
    series: FORECAST.series.map((point) => ({
      ...point,
      eth: 200_000,
      brokerage: 0,
      retirement: 0,
    })),
  },
}

// A portfolio that rises then falls, so the tooltip has a real
// year-over-year change to report in both directions.
const GROWING_ETH: Record<number, number> = { 38: 200_000, 39: 245_000, 40: 200_000 }

const FORECAST_GROWING = {
  ...FORECAST,
  series: FORECAST.series.map((point) => ({
    ...point,
    eth: GROWING_ETH[point.age] ?? 200_000,
    brokerage: 0,
    retirement: 0,
  })),
}

// Taxable buckets emptied at 52 — six years short of the 59½ bridge.
const FORECAST_BROKEN_BRIDGE = {
  ...FORECAST,
  series: FORECAST.series.map((point) =>
    point.age >= 52 ? { ...point, eth: 0, brokerage: 0 } : point,
  ),
}

beforeEach(() => {
  stubApi({
    '/api/forecast': FORECAST,
    '/api/accounts': ACCOUNTS,
    '/api/spend-bands': [],
  })
})

describe('verdict hero', () => {
  it('celebrates the verdict with the spend and the age-100 balance', async () => {
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent(/at \$45,000\.00 \/ year/i)
    expect(hero).toHaveTextContent("You don't run out.")
    expect(hero).toHaveTextContent('$5.51M')
    expect(hero).toHaveTextContent(/at age 100/)
    expect(hero).toHaveTextContent(/today's dollars/)
  })

  it('names the last funded age when the money runs out', async () => {
    stubApi({ '/api/forecast': FORECAST_RUNS_OUT, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent('Lasts to age 71')
  })
})

describe('bridge card', () => {
  it('celebrates taxable buckets that outlast the bridge', async () => {
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('22 yrs')
    expect(bridge).toHaveTextContent('22+ yrs')
  })

  it('reports how long the taxable buckets last when they break early', async () => {
    stubApi({
      '/api/forecast': FORECAST_BROKEN_BRIDGE,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
    })
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('14 yrs')
  })

  it('names the gate age from the accounts', async () => {
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('BRIDGE TO 401(k) @ 59½')
    expect(bridge).toHaveTextContent('Need to cover 22 yrs')
    expect(screen.getByTestId('forecast-chart')).toHaveTextContent(
      '401(k) · locked to 59½',
    )
  })

  it("follows a later gate when the first unlock is a spouse's", async () => {
    stubApi({
      '/api/forecast': { ...FORECAST, first_unlock_age: 62.5 },
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
    })
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('BRIDGE TO 401(k) @ 62½')
    expect(bridge).toHaveTextContent('Need to cover 25 yrs')
    expect(screen.getByTestId('forecast-chart')).toHaveTextContent(
      '401(k) · locked to 62½',
    )
  })

  it('drops the card when no bucket is gated', async () => {
    stubApi({
      '/api/forecast': { ...FORECAST, first_unlock_age: null },
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
    })
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    expect(screen.queryByTestId('forecast-bridge')).not.toBeInTheDocument()
    expect(screen.getByTestId('forecast-chart')).toHaveTextContent('401(k)')
    expect(screen.getByTestId('forecast-chart')).not.toHaveTextContent(
      /401\(k\) · locked/,
    )
  })

  it('derives the bridge years and chart range from the start age', async () => {
    stubApi({
      '/api/forecast': { ...FORECAST, start_age: 40 },
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
    })
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('Need to cover 20 yrs')
    expect(screen.getByTestId('forecast-chart')).toHaveTextContent('age 40 → 100')
  })
})

describe('HSA band', () => {
  it('draws the HSA tier and names it in the tooltip and legend', async () => {
    stubApi({
      '/api/forecast': {
        ...FORECAST,
        series: FORECAST.series.map((point) => ({ ...point, hsa: 100_000 })),
      },
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
    })
    render(<Forecast />)

    const tip = await screen.findByTestId('forecast-tip-38')
    expect(tip).toHaveTextContent('HSA $100,000.00')
    expect(screen.getByTestId('forecast-total-38')).toHaveTextContent(
      'Total $1,700,000.00',
    )
    expect(screen.getByTestId('forecast-chart')).toHaveTextContent(/HSA · drawn last/)
  })
})

describe('planned purchases section', () => {
  it('starts empty with only the add control', async () => {
    render(<Forecast />)

    const section = await screen.findByTestId('forecast-purchases')
    expect(section).toHaveTextContent('Planned purchases')
    expect(screen.getByTestId('forecast-purchase-add')).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-purchase-name-0')).not.toBeInTheDocument()
  })

  it('adds a purchase and refetches with its param', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      `purchase=${NEXT_YEAR}%3A50000`,
    )
    expect(screen.getByTestId('forecast-purchase-name-0')).toHaveValue('New purchase')
  })

  it('re-runs the simulation as the amount slider moves', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    fireEvent.change(screen.getByTestId('forecast-purchase-amount-0'), {
      target: { value: '250000' },
    })

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      `purchase=${NEXT_YEAR}%3A250000`,
    )
  })

  it('moves the purchase year through its input', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    fireEvent.change(screen.getByTestId('forecast-purchase-year-0'), {
      target: { value: '2040' },
    })

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('purchase=2040%3A50000')
  })

  it('stacks purchases as repeated params', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    fireEvent.click(screen.getByTestId('forecast-purchase-add'))

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      `purchase=${NEXT_YEAR}%3A50000&purchase=${NEXT_YEAR}%3A50000`,
    )
  })

  it('removes a purchase and refetches without it', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    fireEvent.click(screen.getByTestId('forecast-purchase-remove-0'))

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('purchase=')
    expect(screen.queryByTestId('forecast-purchase-name-0')).not.toBeInTheDocument()
  })

  it('keeps names client-side without refetching', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    const calls = fetchMock.mock.calls.length
    fireEvent.change(screen.getByTestId('forecast-purchase-name-0'), {
      target: { value: 'House' },
    })

    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(screen.getByTestId('forecast-purchase-name-0')).toHaveValue('House')
  })
})

describe('spend bands section', () => {
  const bandRoutes = () => ({
    '/api/forecast': FORECAST,
    '/api/accounts': ACCOUNTS,
    '/api/spend-bands': SPEND_BANDS,
    'POST /api/spend-bands': SPEND_BANDS,
  })

  const saveBody = (fetchMock: ReturnType<typeof stubApi>) => {
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/spend-bands' && init?.method === 'POST',
    )
    return call ? JSON.parse(call[1]?.body as string) : null
  }

  it('seeds the band rows from the saved schedule', async () => {
    stubApi(bandRoutes())
    render(<Forecast />)

    expect(await screen.findByTestId('forecast-band-start-0')).toHaveValue(2030)
    expect(screen.getByTestId('forecast-band-end-0')).toHaveValue(2044)
    expect(screen.getByTestId('forecast-band-note-0')).toHaveValue('peak travel years')
    // The open-ended band renders an empty end year.
    expect(screen.getByTestId('forecast-band-end-1')).toHaveValue(null)
    // Amounts are in today's dollars, and the section says so.
    expect(screen.getByTestId('forecast-bands')).toHaveTextContent("today's $")
  })

  it('editing a band refetches with the full band set', async () => {
    const fetchMock = stubApi(bandRoutes())
    render(<Forecast />)

    fireEvent.change(await screen.findByTestId('forecast-band-start-0'), {
      target: { value: '2032' },
    })

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      'band=2032%3A2044%3A55000&band=2045%3A%3A38000',
    )
  })

  it('an overlapping draft warns instead of fetching', async () => {
    const fetchMock = stubApi(bandRoutes())
    render(<Forecast />)

    const end = await screen.findByTestId('forecast-band-end-0')
    const calls = fetchMock.mock.calls.length
    fireEvent.change(end, { target: { value: '2046' } })

    expect(screen.getByTestId('forecast-band-problem')).toHaveTextContent(
      'bands 2030-2046 and 2045+ overlap',
    )
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('starts empty with no saved schedule and adds a band at the baseline', async () => {
    const fetchMock = stubApi({ ...bandRoutes(), '/api/spend-bands': [] })
    render(<Forecast />)

    const section = await screen.findByTestId('forecast-bands')
    expect(within(section).queryByTestId('forecast-band-start-0')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('forecast-band-add'))

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      `band=${NEXT_YEAR}%3A${NEXT_YEAR + 9}%3A45000`,
    )
  })

  it('removing every band sends the explicit flat override', async () => {
    const fetchMock = stubApi(bandRoutes())
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-band-remove-1'))
    fireEvent.click(screen.getByTestId('forecast-band-remove-0'))

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe('/api/forecast?band=')
  })

  it('keeps notes client-side without refetching, but saves them', async () => {
    const fetchMock = stubApi(bandRoutes())
    render(<Forecast />)

    const note = await screen.findByTestId('forecast-band-note-0')
    const calls = fetchMock.mock.calls.length
    fireEvent.change(note, { target: { value: 'travel heavy' } })
    expect(fetchMock.mock.calls.length).toBe(calls)

    fireEvent.click(screen.getByTestId('forecast-band-save'))
    await waitFor(() => {
      expect(saveBody(fetchMock)).toMatchObject({
        effective_date: todayIso(),
        bands: [
          expect.objectContaining({ note: 'travel heavy' }),
          expect.objectContaining({ start_year: 2045, end_year: null }),
        ],
      })
    })
  })

  it('save to plan stays disabled while the schedule is unchanged', async () => {
    stubApi(bandRoutes())
    render(<Forecast />)

    expect(await screen.findByTestId('forecast-band-save')).toBeDisabled()
    fireEvent.change(screen.getByTestId('forecast-band-start-0'), {
      target: { value: '2032' },
    })
    expect(screen.getByTestId('forecast-band-save')).toBeEnabled()
  })

  it('reset to plan restores the saved rows and refetches', async () => {
    const fetchMock = stubApi(bandRoutes())
    render(<Forecast />)

    fireEvent.change(await screen.findByTestId('forecast-band-start-0'), {
      target: { value: '2032' },
    })
    fireEvent.click(screen.getByTestId('forecast-band-reset'))

    expect(screen.getByTestId('forecast-band-start-0')).toHaveValue(2030)
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      'band=2030%3A2044%3A55000&band=2045%3A%3A38000',
    )
  })
})

describe('banded verdict and baseline slider', () => {
  const FORECAST_BANDED = {
    ...FORECAST,
    bands: [
      { start_year: 2030, end_year: 2044, annual_amount: 55_000 },
      { start_year: 2045, end_year: null, annual_amount: 38_000 },
    ],
  }

  it('labels the hero with the baseline and the band count', async () => {
    stubApi({
      '/api/forecast': FORECAST_BANDED,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': SPEND_BANDS,
    })
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent('At $45,000.00 baseline · 2 bands')
  })

  it('narrows the spend slider label to the baseline while bands are active', async () => {
    stubApi({
      '/api/forecast': FORECAST_BANDED,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': SPEND_BANDS,
    })
    render(<Forecast />)

    await screen.findByTestId('forecast-spend')
    expect(screen.getByText('Baseline spend / yr')).toBeInTheDocument()
  })

  it('keeps the flat labels with no bands', async () => {
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent(/at \$45,000\.00 \/ year/i)
    expect(screen.getByText('Spend / yr')).toBeInTheDocument()
  })
})

describe('spend step-chart', () => {
  // The saved schedule's first band start, on the same year ↔ age
  // mapping the component derives from the start age.
  const BAND_START_AGE =
    FORECAST.start_age + (SPEND_BANDS[0].start_year - new Date().getFullYear())

  it('shares the x-axis with the balance chart', async () => {
    render(<Forecast />)

    const chart = await screen.findByTestId('forecast-chart')
    const bars = within(chart).getAllByTestId(/^forecast-col-\d+$/)
    const steps = within(chart).getAllByTestId(/^forecast-step-\d+$/)
    expect(steps).toHaveLength(bars.length)
  })

  it('marks band years apart from baseline years', async () => {
    stubApi({
      '/api/forecast': FORECAST,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': SPEND_BANDS,
    })
    render(<Forecast />)

    const banded = await screen.findByTestId(`forecast-step-${BAND_START_AGE}`)
    expect(banded).toHaveAttribute('data-banded', 'true')
    expect(
      screen.getByTestId(`forecast-step-${FORECAST.start_age}`),
    ).toHaveAttribute('data-banded', 'false')
  })

  it('titles each column with its effective spend', async () => {
    stubApi({
      '/api/forecast': FORECAST,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': SPEND_BANDS,
    })
    render(<Forecast />)

    const banded = await screen.findByTestId(`forecast-step-${BAND_START_AGE}`)
    expect(banded.getAttribute('title')).toContain('$55,000.00')
  })
})

describe('step-chart dragging', () => {
  const BAND_START_AGE =
    FORECAST.start_age + (SPEND_BANDS[0].start_year - new Date().getFullYear())

  const bandedRoutes = () => ({
    '/api/forecast': FORECAST,
    '/api/accounts': ACCOUNTS,
    '/api/spend-bands': SPEND_BANDS,
  })

  beforeEach(() => {
    // jsdom has no layout: give the steps row a real width so a
    // horizontal drag can translate px into years — 630px across 63
    // columns is 10px per year.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 630,
      height: 56,
      top: 0,
      left: 0,
      bottom: 56,
      right: 630,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drags a band level vertically and refetches once on release', async () => {
    const fetchMock = stubApi(bandedRoutes())
    render(<Forecast />)

    // A mid-band column, not an edge: vertical drag owns the level.
    const column = await screen.findByTestId(`forecast-step-${BAND_START_AGE + 2}`)
    const calls = fetchMock.mock.calls.length
    fireEvent.pointerDown(column, { clientX: 100, clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(column, { clientX: 100, clientY: 30, pointerId: 1 })

    // 10px up on the 56px chart whose top is the 55,000 maximum:
    // 10/56 × 55,000 ≈ 9,821 → snapped to the $1,000 grid → 65,000.
    expect(screen.getByTestId('forecast-band-amount-0')).toHaveValue('65000')
    // Live while dragging, but no fetch until release.
    expect(fetchMock.mock.calls.length).toBe(calls)

    fireEvent.pointerUp(column, { clientX: 100, clientY: 30, pointerId: 1 })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      `band=${SPEND_BANDS[0].start_year}%3A2044%3A65000`,
    )
  })

  it('drags a band boundary horizontally to move its year', async () => {
    const fetchMock = stubApi(bandedRoutes())
    render(<Forecast />)

    const edge = await screen.findByTestId(`forecast-step-${BAND_START_AGE}`)
    fireEvent.pointerDown(edge, { clientX: 100, clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(edge, { clientX: 120, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(edge, { clientX: 120, clientY: 40, pointerId: 1 })

    // 20px right at 10px per column = two years later.
    expect(screen.getByTestId('forecast-band-start-0')).toHaveValue(
      SPEND_BANDS[0].start_year + 2,
    )
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      `band=${SPEND_BANDS[0].start_year + 2}%3A2044%3A55000`,
    )
  })

  it('leaves baseline years inert', async () => {
    const fetchMock = stubApi(bandedRoutes())
    render(<Forecast />)

    const column = await screen.findByTestId(`forecast-step-${FORECAST.start_age}`)
    const calls = fetchMock.mock.calls.length
    fireEvent.pointerDown(column, { clientX: 10, clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(column, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(column, { clientX: 10, clientY: 10, pointerId: 1 })

    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(screen.getByTestId('forecast-band-amount-0')).toHaveValue('55000')
  })

  it('opts the drag surface out of touch scrolling', async () => {
    stubApi(bandedRoutes())
    render(<Forecast />)

    const row = await screen.findByTestId('forecast-spend-steps')
    expect(row.className).toContain('touch-none')
  })
})

describe('max affordable button', () => {
  const MAX_AFFORDABLE = {
    year: NEXT_YEAR,
    age: 39,
    max_amount: 640_000,
    binding_constraint: 'purchase_year_liquidity',
    run_out_age: null,
    balance_at_100: 1_200_000,
  }

  it('fills the amount from the solver and re-runs the forecast', async () => {
    const fetchMock = stubApi({
      '/api/forecast': FORECAST,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
      '/api/forecast/max-affordable': MAX_AFFORDABLE,
    })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    fireEvent.click(screen.getByTestId('forecast-purchase-max-0'))

    const solverCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/api/forecast/max-affordable'),
    )
    expect(String(solverCall?.[0])).toContain(`year=${NEXT_YEAR}`)

    // The response fills the field, names the constraint, and re-runs
    // the simulation at the ceiling.
    expect(
      await screen.findByTestId('forecast-purchase-constraint-0'),
    ).toHaveTextContent('capped by the buckets reachable that year')
    expect(screen.getByTestId('forecast-purchase-amount-0')).toHaveValue('640000')
    await waitFor(() =>
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        `purchase=${NEXT_YEAR}%3A640000`,
      ),
    )
  })

  it('solves against the other purchases, not the row itself', async () => {
    const fetchMock = stubApi({
      '/api/forecast': FORECAST,
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
      '/api/forecast/max-affordable': MAX_AFFORDABLE,
    })
    render(<Forecast />)

    fireEvent.click(await screen.findByTestId('forecast-purchase-add'))
    fireEvent.click(screen.getByTestId('forecast-purchase-add'))
    fireEvent.change(screen.getByTestId('forecast-purchase-year-1'), {
      target: { value: '2040' },
    })
    fireEvent.click(screen.getByTestId('forecast-purchase-max-0'))

    const solverUrl = String(
      fetchMock.mock.calls
        .find((call) => String(call[0]).includes('/api/forecast/max-affordable'))?.[0],
    )
    expect(solverUrl).toContain(`year=${NEXT_YEAR}`)
    expect(solverUrl).toContain('purchase=2040%3A50000')
    expect(solverUrl).not.toContain(`purchase=${NEXT_YEAR}`)
  })
})

describe('purchase-aware verdict', () => {
  it('carries the delta against the baseline', async () => {
    stubApi({ '/api/forecast': FORECAST_WITH_PURCHASE, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent('$1.40M lower at 100 than without the purchases')
  })

  it('shows no delta line without purchases', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-verdict')
    expect(screen.queryByTestId('forecast-verdict-delta')).not.toBeInTheDocument()
  })
})

describe('purchases on the chart', () => {
  it('marks the purchase year with a diamond in the label row', async () => {
    stubApi({ '/api/forecast': FORECAST_WITH_PURCHASE, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    expect(screen.getByTestId('forecast-mark-48')).toHaveTextContent('◆')
    expect(screen.queryByTestId('forecast-mark-47')).not.toBeInTheDocument()
  })

  it('lists the purchase in the hover tooltip', async () => {
    stubApi({ '/api/forecast': FORECAST_WITH_PURCHASE, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    expect(screen.getByTestId('forecast-tip-48')).toHaveTextContent(
      'Purchase $800,000.00',
    )
  })

  it('turns the tick red and reports the short on an unaffordable year', async () => {
    stubApi({ '/api/forecast': FORECAST_UNAFFORDABLE, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    // You can't buy that in that year — but you don't go broke.
    expect(hero).toHaveTextContent("You don't run out.")
    expect(screen.getByTestId('forecast-mark-48')).toHaveClass('text-red-text')
    expect(screen.getByTestId('forecast-tip-48')).toHaveTextContent('$278,149.00 short')
  })

  it('caps each column with the forgone growth against the baseline', async () => {
    stubApi({ '/api/forecast': FORECAST_WITH_CAP, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    expect(screen.getByTestId('forecast-cap-38')).toHaveStyle({ height: '47.5px' })
  })
})

describe('purchase cost card', () => {
  it('prices each purchase as the outcome without it', async () => {
    stubApi({ '/api/forecast': FORECAST_WITH_PURCHASE, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    const card = await screen.findByTestId('forecast-purchase-costs')
    expect(card).toHaveTextContent('What do the purchases cost?')
    const [row] = screen.getAllByTestId('forecast-cost-row')
    // No client-side name exists for a purchase the screen didn't
    // add, so the year stands in.
    expect(row).toHaveTextContent('Purchase in 2046')
    expect(row).toHaveTextContent('$800,000.00')
    expect(row).toHaveTextContent('never runs out')
    expect(row).toHaveTextContent('✓ $5.51M @ 100')
  })

  it('is absent without purchases', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-verdict')
    expect(screen.queryByTestId('forecast-purchase-costs')).not.toBeInTheDocument()
  })
})

describe('balance-by-bucket chart', () => {
  it('renders one column per simulated year', async () => {
    render(<Forecast />)

    const chart = await screen.findByTestId('forecast-chart')
    expect(within(chart).getAllByTestId(/^forecast-col-/)).toHaveLength(63)
    expect(within(chart).getByTestId('forecast-col-38')).toBeInTheDocument()
    // 96 sits between the old 5-year picks — only a yearly chart has it.
    expect(within(chart).getByTestId('forecast-col-96')).toBeInTheDocument()
    expect(within(chart).getByTestId('forecast-col-100')).toBeInTheDocument()
  })

  it('thins the axis labels to every fifth age', async () => {
    render(<Forecast />)

    const chart = await screen.findByTestId('forecast-chart')
    expect(within(chart).getByText('40')).toBeInTheDocument()
    expect(within(chart).queryByText('39')).not.toBeInTheDocument()
  })

  it('gives each bar a hover tooltip with the year and the dollar breakdown', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    const tip = screen.getByTestId('forecast-tip-68')
    // The year age 68 is reached: 30 years past the start age's year.
    const year = new Date().getFullYear() + 68 - FORECAST.start_age
    expect(tip).toHaveTextContent(`Age 68 · ${year}`)
    expect(tip).toHaveTextContent('ETH $200,000.00')
    expect(tip).toHaveTextContent('Brokerage $800,000.00')
    expect(tip).toHaveTextContent('401(k) $600,000.00')
    expect(tip).toHaveTextContent('Soc. Sec. $34,800.00/yr')
  })

  it('names the first column Today rather than by year', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    // Every column is that year's January 1, but the first one holds
    // the balances held right now — a date only "Today" names.
    expect(screen.getByTestId('forecast-tip-38')).toHaveTextContent('Age 38 · Today')
    expect(screen.getByTestId('forecast-tip-39')).toHaveTextContent(
      `Age 39 · ${new Date().getFullYear() + 1}`,
    )
  })

  it('answers the year with a portfolio total that leaves Social Security out', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    // 200k + 800k + 600k. Age 68 also draws $34,800 of Social
    // Security — an income flow, so the total must not absorb it.
    expect(screen.getByTestId('forecast-total-68')).toHaveTextContent(
      'Total $1,600,000.00',
    )
  })

  it('shows the change against the previous simulated year', async () => {
    stubApi({ '/api/forecast': FORECAST_GROWING, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    expect(screen.getByTestId('forecast-total-39')).toHaveTextContent(
      'Total $245,000.00 (+$45,000.00)',
    )
    expect(screen.getByTestId('forecast-total-40')).toHaveTextContent(
      'Total $200,000.00 (-$45,000.00)',
    )
  })

  it('reports no change on the first simulated year', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    // Age 38 has no prior year, so the total stands alone.
    expect(screen.getByTestId('forecast-total-38')).toHaveTextContent(
      /^Total \$1,600,000\.00$/,
    )
  })

  it('sets the Social Security line apart from the balances with a rule', async () => {
    render(<Forecast />)

    await screen.findByTestId('forecast-chart')
    expect(screen.getByTestId('forecast-ss-line-68')).toHaveClass('border-t')
  })

  it('floors the Social Security sliver and hides it before the start age', async () => {
    render(<Forecast />)

    // 34,800 against the 1.6M max would be 4px — floored to 7.
    const visible = await screen.findByTestId('forecast-ss-68')
    expect(visible.style.height).toBe('7px')
    expect(screen.getByTestId('forecast-ss-38').style.height).toBe('0px')
  })

  it('legends the four series with the resolved start age', async () => {
    render(<Forecast />)

    const chart = await screen.findByTestId('forecast-chart')
    expect(within(chart).getByText(/ETH \(first\)/)).toBeInTheDocument()
    expect(within(chart).getByText(/Taxable brokerage/)).toBeInTheDocument()
    expect(within(chart).getByText(/401\(k\) · locked to 59½/)).toBeInTheDocument()
    expect(
      within(chart).getByText(/Soc\. Security · spent first from 67/),
    ).toBeInTheDocument()
  })
})

describe('sensitivity table', () => {
  it('shows each level with its outcome copy', async () => {
    render(<Forecast />)

    const table = await screen.findByTestId('forecast-sensitivity')
    expect(within(table).getByText('$30,000.00')).toBeInTheDocument()
    expect(within(table).getByText('✓ $7.20M @ 100')).toBeInTheDocument()
    expect(within(table).getByText('to age 91')).toBeInTheDocument()
    expect(within(table).getByText('tight')).toBeInTheDocument()
    expect(within(table).getByText('to age 70')).toBeInTheDocument()
    expect(within(table).getByText('⚠ runs out')).toBeInTheDocument()
  })

  it('highlights only the row nearest the resolved spend', async () => {
    render(<Forecast />)

    const table = await screen.findByTestId('forecast-sensitivity')
    const rows = within(table).getAllByTestId('forecast-sense-row')
    expect(rows.map((row) => row.getAttribute('data-current'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ])
  })
})

describe('assumption controls', () => {
  it('loads without overrides', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    await screen.findByTestId('forecast-verdict')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast')
  })

  it('widens the spend slider down to the resolved spend', async () => {
    render(<Forecast />)

    const slider = await screen.findByTestId('forecast-spend')
    expect(slider).toHaveAttribute('min', '45000')
    expect(slider).toHaveAttribute('max', '160000')
  })

  it('refetches at a what-if spend level', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-spend')

    fireEvent.change(slider, { target: { value: '60000' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?spend=60000')
  })

  it('refetches at a what-if return', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-return')
    expect(slider).toHaveAttribute('min', '3')
    expect(slider).toHaveAttribute('max', '11')
    expect(slider).toHaveAttribute('step', '0.5')

    fireEvent.change(slider, { target: { value: '5.5' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?return_pct=5.5')
  })

  it('seeds the ETH growth slider from the response', async () => {
    stubApi({
      '/api/forecast': { ...FORECAST, eth_growth_pct: 15 },
      '/api/accounts': ACCOUNTS,
      '/api/spend-bands': [],
    })
    render(<Forecast />)

    const slider = await screen.findByTestId('forecast-eth')
    expect(slider).toHaveValue('15')
    expect(slider).toHaveAttribute('min', '-85')
    expect(slider).toHaveAttribute('max', '470')
    expect(slider).toHaveAttribute('step', '1')
  })

  it('falls back to the return rate while ETH growth is unset', async () => {
    // A null eth_growth_pct means the engine grows ETH at the blended
    // rate — the slider shows exactly that.
    render(<Forecast />)

    expect(await screen.findByTestId('forecast-eth')).toHaveValue('7')
  })

  it('refetches at a what-if ETH growth rate', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-eth')

    fireEvent.change(slider, { target: { value: '28' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?eth_growth_pct=28')
  })

  it('refetches at a what-if inflation', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-inflation')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '6')

    fireEvent.change(slider, { target: { value: '4' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?inflation_pct=4')
  })

  it('accumulates overrides across controls', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)
    const spend = await screen.findByTestId('forecast-spend')
    const inflation = screen.getByTestId('forecast-inflation')

    fireEvent.change(spend, { target: { value: '60000' } })
    fireEvent.change(inflation, { target: { value: '4' } })

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/forecast?spend=60000&inflation_pct=4',
    )
  })

  it('prefills the Social Security panel from the response', async () => {
    render(<Forecast />)

    expect(await screen.findByTestId('forecast-ss-you')).toHaveValue(1_500)
    expect(screen.getByTestId('forecast-ss-spouse')).toHaveValue(1_400)
    expect(screen.getByTestId('forecast-ss-start')).toHaveValue(67)
  })

  it('refetches when a Social Security figure changes', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)
    const you = await screen.findByTestId('forecast-ss-you')

    fireEvent.change(you, { target: { value: '2000' } })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?ss_you=2000')

    fireEvent.change(screen.getByTestId('forecast-ss-start'), {
      target: { value: '62' },
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/forecast?ss_you=2000&ss_start=62',
    )
  })

  it('summarizes the real return under the sliders', async () => {
    render(<Forecast />)

    expect(await screen.findByText(/Real return 4\.0%/)).toBeInTheDocument()
  })
})

describe('empty state', () => {
  it('points at Settings until config and balances exist', async () => {
    stubApi({ '/api/forecast': null, '/api/accounts': ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    const empty = await screen.findByTestId('forecast-empty')
    expect(empty).toHaveTextContent(/tax parameters/i)
    expect(empty).toHaveTextContent(/assumptions/i)
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument()
  })

  it('points at account classification when no priorities are set', async () => {
    stubApi({ '/api/forecast': null, '/api/accounts': UNCLASSIFIED_ACCOUNTS, '/api/spend-bands': [] })
    render(<Forecast />)

    const empty = await screen.findByTestId('forecast-empty')
    expect(empty).toHaveTextContent(/withdrawal priority/i)
    expect(empty).toHaveTextContent(/Settings & data/)
    expect(empty).not.toHaveTextContent(/Ledger entries/)
  })
})

describe('responsive layout', () => {
  it('stacks the forecast grids into one column on narrow screens', async () => {
    render(<Forecast />)

    const view = await screen.findByTestId('view-forecast')
    expect(view.children[0]).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-[1.4fr_1fr]',
    )
    expect(view.children[2]).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-[1.3fr_1fr]',
    )
    expect(screen.getByTestId('forecast-ss-you').closest('.grid')).toHaveClass(
      'grid-cols-1',
      'sm:grid-cols-3',
    )
  })

  it('rides the shell width above xl instead of its own cap', async () => {
    render(<Forecast />)

    const view = await screen.findByTestId('view-forecast')
    expect(view).toHaveClass('max-w-[1000px]', 'xl:max-w-none')
  })
})
