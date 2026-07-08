import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCOUNTS,
  FORECAST,
  UNCLASSIFIED_ACCOUNTS,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Forecast from './Forecast.tsx'

// The same portfolio asked for too much: the money lasts to 71.
const FORECAST_RUNS_OUT = {
  ...FORECAST,
  spend: 200_000,
  run_out_age: 72,
  balance_at_100: 0,
}

// Taxable buckets emptied at 52 — six years short of the 59½ bridge.
const FORECAST_BROKEN_BRIDGE = {
  ...FORECAST,
  series: FORECAST.series.map((point) =>
    point.age >= 52 ? { ...point, eth: 0, brokerage: 0 } : point,
  ),
}

beforeEach(() => {
  stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
})

describe('verdict hero', () => {
  it('celebrates the verdict with the spend and the age-100 balance', async () => {
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent(/at \$45,000 \/ year/i)
    expect(hero).toHaveTextContent("You don't run out.")
    expect(hero).toHaveTextContent('$5.51M')
    expect(hero).toHaveTextContent(/at age 100/)
    expect(hero).toHaveTextContent(/today's dollars/)
  })

  it('names the last funded age when the money runs out', async () => {
    stubApi({ '/api/forecast': FORECAST_RUNS_OUT, '/api/accounts': ACCOUNTS })
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent('Lasts to age 71')
  })
})

describe('bridge card', () => {
  it('celebrates taxable buckets that outlast the bridge', async () => {
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('21.5 yrs')
    expect(bridge).toHaveTextContent('31+ yrs')
  })

  it('reports how long the taxable buckets last when they break early', async () => {
    stubApi({
      '/api/forecast': FORECAST_BROKEN_BRIDGE,
      '/api/accounts': ACCOUNTS,
    })
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('14 yrs')
  })

  it('derives the bridge years and chart range from the start age', async () => {
    stubApi({
      '/api/forecast': { ...FORECAST, start_age: 40 },
      '/api/accounts': ACCOUNTS,
    })
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('Need to cover 19.5 yrs')
    expect(screen.getByTestId('forecast-chart')).toHaveTextContent('age 40 → 100')
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
    expect(tip).toHaveTextContent('ETH $200,000')
    expect(tip).toHaveTextContent('Brokerage $800,000')
    expect(tip).toHaveTextContent('401(k) $600,000')
    expect(tip).toHaveTextContent('Soc. Sec. $34,800/yr')
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
    expect(within(table).getByText('$30,000')).toBeInTheDocument()
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
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
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
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-spend')

    fireEvent.change(slider, { target: { value: '60000' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?spend=60000')
  })

  it('refetches at a what-if return', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-return')
    expect(slider).toHaveAttribute('min', '3')
    expect(slider).toHaveAttribute('max', '11')
    expect(slider).toHaveAttribute('step', '0.5')

    fireEvent.change(slider, { target: { value: '5.5' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?return_pct=5.5')
  })

  it('refetches at a what-if inflation', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-inflation')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '6')

    fireEvent.change(slider, { target: { value: '4' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?inflation_pct=4')
  })

  it('accumulates overrides across controls', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
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
    const fetchMock = stubApi({ '/api/forecast': FORECAST, '/api/accounts': ACCOUNTS })
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
    stubApi({ '/api/forecast': null, '/api/accounts': ACCOUNTS })
    render(<Forecast />)

    const empty = await screen.findByTestId('forecast-empty')
    expect(empty).toHaveTextContent(/tax parameters/i)
    expect(empty).toHaveTextContent(/assumptions/i)
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument()
  })

  it('points at account classification when no priorities are set', async () => {
    stubApi({ '/api/forecast': null, '/api/accounts': UNCLASSIFIED_ACCOUNTS })
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
})
