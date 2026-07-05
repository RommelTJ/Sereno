import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { stepDetail } from '../sourcing.ts'
import { SOURCING } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Withdrawals from './Withdrawals.tsx'

// The same portfolio asked for $200,000: ETH exhausts its headroom,
// the brokerage sells at 15% on the gain, the gated 401(k) leaves
// $7,000 of the gap unfilled.
const SOURCING_SHORT = {
  ...SOURCING,
  target_net: 200_000,
  gap: 197_000,
  steps: [
    { ...SOURCING.steps[0], gross: 90_000, net: 90_000 },
    {
      ...SOURCING.steps[1],
      gross: 103_092.78,
      tax: 3_092.78,
      net: 100_000,
    },
    SOURCING.steps[2],
  ],
  net_delivered: 193_000,
  shortfall: 7_000,
}

beforeEach(() => {
  stubApi({ '/api/sourcing': SOURCING })
})

describe('sequencing waterfall', () => {
  it('walks target net through income and gap to net delivered', async () => {
    render(<Withdrawals />)

    const waterfall = await screen.findByTestId('sourcing-waterfall')
    expect(within(waterfall).getByText(/Target net spend/)).toBeInTheDocument()
    expect(within(waterfall).getAllByText('$45,000')).toHaveLength(2)
    expect(within(waterfall).getByText('−$3,000')).toBeInTheDocument()
    expect(within(waterfall).getByText(/Gap from portfolio/)).toBeInTheDocument()
    expect(within(waterfall).getByText('$42,000')).toBeInTheDocument()
    expect(within(waterfall).getByText(/Net delivered/)).toBeInTheDocument()
  })

  it('shows the active ETH step selling inside the headroom', async () => {
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-0')
    expect(step).toHaveTextContent('ETH')
    expect(step).toHaveTextContent('sell $42,000')
    expect(step).toHaveTextContent(/within \$96,700 headroom/)
  })

  it('mutes an untouched bucket to $0 this yr', async () => {
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-1')
    expect(step).toHaveTextContent('Brokerage')
    expect(step).toHaveTextContent('$0 this yr')
  })

  it('surfaces the 401(k) age gate note', async () => {
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-2')
    expect(step).toHaveTextContent('401(k)')
    expect(step).toHaveTextContent('locked until age 59.5')
  })

  it('shows the tax cost on a taxed draw and flags a shortfall', async () => {
    stubApi({ '/api/sourcing': SOURCING_SHORT })
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-1')
    expect(step).toHaveTextContent('sell $103,093')
    expect(step).toHaveTextContent(/tax \$3,093/)
    expect(step).toHaveTextContent(/nets \$100,000/)
    const banner = screen.getByTestId('sourcing-shortfall')
    expect(banner).toHaveTextContent('$7,000')
  })

  it('hides the shortfall banner when the gap is filled', async () => {
    render(<Withdrawals />)

    await screen.findByTestId('sourcing-waterfall')
    expect(screen.queryByTestId('sourcing-shortfall')).not.toBeInTheDocument()
  })
})

describe('what-if controls', () => {
  it('refetches when the age changes', async () => {
    const fetchMock = stubApi({ '/api/sourcing': SOURCING })
    render(<Withdrawals />)
    const age = await screen.findByTestId('sourcing-age')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/sourcing?age=38')

    fireEvent.change(age, { target: { value: '60' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/sourcing?age=60')
  })

  it('refetches at a what-if spend level', async () => {
    const fetchMock = stubApi({ '/api/sourcing': SOURCING })
    render(<Withdrawals />)
    const spend = await screen.findByTestId('sourcing-spend')

    fireEvent.change(spend, { target: { value: '60000' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/sourcing?age=38&spend=60000')
  })
})

describe('bucket rules', () => {
  it('states each bucket rule and the engine rule', async () => {
    render(<Withdrawals />)

    await screen.findByTestId('sourcing-waterfall')
    expect(screen.getByText(/Harvest up to the 0% LTCG ceiling/)).toBeInTheDocument()
    expect(screen.getByText(/Lot-level basis/)).toBeInTheDocument()
    expect(screen.getByText(/Drawn last/)).toBeInTheDocument()
    expect(
      screen.getByText(/never 0\.04 × balance per bucket/),
    ).toBeInTheDocument()
  })
})

describe('empty state', () => {
  it('points at Settings until tax params, balances, and a plan exist', async () => {
    stubApi({ '/api/sourcing': null })
    render(<Withdrawals />)

    const empty = await screen.findByTestId('sourcing-empty')
    expect(empty).toHaveTextContent(/tax parameters/i)
    expect(screen.queryByTestId('sourcing-waterfall')).not.toBeInTheDocument()
  })
})

describe('step detail derivation', () => {
  it('prefers the gate note, then the idle label, then the tax cost', () => {
    expect(stepDetail(SOURCING.steps[2], 96_700)).toBe('locked until age 59.5')
    expect(stepDetail(SOURCING.steps[1], 96_700)).toBe('$0 this yr')
    expect(stepDetail(SOURCING.steps[0], 96_700)).toBe(
      'within $96,700 headroom · tax-free',
    )
    expect(stepDetail(SOURCING_SHORT.steps[1], 0)).toBe(
      'tax $3,093 → nets $100,000',
    )
  })
})

describe('responsive layout', () => {
  it('stacks the waterfall and rule cards into one column on narrow screens', async () => {
    render(<Withdrawals />)

    const view = await screen.findByTestId('view-withdrawals')
    expect(view.firstElementChild).toHaveClass('grid-cols-1', 'lg:grid-cols-2')
  })
})
