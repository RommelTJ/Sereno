import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FORECAST } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Forecast from './Forecast.tsx'

// The same portfolio asked for too much: the money lasts to 71.
const FORECAST_RUNS_OUT = {
  ...FORECAST,
  spend: 200_000,
  run_out_age: 72,
  balance_at_90: 0,
}

// Taxable buckets emptied at 52 — six years short of the 59½ bridge.
const FORECAST_BROKEN_BRIDGE = {
  ...FORECAST,
  series: FORECAST.series.map((point) =>
    point.age >= 52 ? { ...point, eth: 0, brokerage: 0 } : point,
  ),
}

beforeEach(() => {
  stubApi({ '/api/forecast': FORECAST })
})

describe('verdict hero', () => {
  it('celebrates the verdict with the spend and the age-90 balance', async () => {
    render(<Forecast />)

    const hero = await screen.findByTestId('forecast-verdict')
    expect(hero).toHaveTextContent(/at \$45,000 \/ year/i)
    expect(hero).toHaveTextContent("You don't run out.")
    expect(hero).toHaveTextContent('$5.51M')
    expect(hero).toHaveTextContent(/today's dollars/)
  })

  it('names the last funded age when the money runs out', async () => {
    stubApi({ '/api/forecast': FORECAST_RUNS_OUT })
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
    stubApi({ '/api/forecast': FORECAST_BROKEN_BRIDGE })
    render(<Forecast />)

    const bridge = await screen.findByTestId('forecast-bridge')
    expect(bridge).toHaveTextContent('14 yrs')
  })
})

describe('balance-by-bucket chart', () => {
  it('renders twelve sampled age columns', async () => {
    render(<Forecast />)

    const chart = await screen.findByTestId('forecast-chart')
    expect(within(chart).getAllByTestId(/^forecast-col-/)).toHaveLength(12)
    expect(within(chart).getByTestId('forecast-col-38')).toBeInTheDocument()
    expect(within(chart).getByTestId('forecast-col-93')).toBeInTheDocument()
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
    expect(within(table).getByText('✓ $7.20M @ 90')).toBeInTheDocument()
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
    const fetchMock = stubApi({ '/api/forecast': FORECAST })
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
    const fetchMock = stubApi({ '/api/forecast': FORECAST })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-spend')

    fireEvent.change(slider, { target: { value: '60000' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?spend=60000')
  })

  it('refetches at a what-if return', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-return')
    expect(slider).toHaveAttribute('min', '3')
    expect(slider).toHaveAttribute('max', '11')
    expect(slider).toHaveAttribute('step', '0.5')

    fireEvent.change(slider, { target: { value: '5.5' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?return_pct=5.5')
  })

  it('refetches at a what-if inflation', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST })
    render(<Forecast />)
    const slider = await screen.findByTestId('forecast-inflation')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '6')

    fireEvent.change(slider, { target: { value: '4' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/forecast?inflation_pct=4')
  })

  it('accumulates overrides across controls', async () => {
    const fetchMock = stubApi({ '/api/forecast': FORECAST })
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
    const fetchMock = stubApi({ '/api/forecast': FORECAST })
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
    stubApi({ '/api/forecast': null })
    render(<Forecast />)

    const empty = await screen.findByTestId('forecast-empty')
    expect(empty).toHaveTextContent(/tax parameters/i)
    expect(empty).toHaveTextContent(/assumptions/i)
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument()
  })
})
