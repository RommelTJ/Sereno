import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { stepAction, stepDetail } from '../sourcing.ts'
import {
  ACCOUNTS,
  SOURCING,
  UNCLASSIFIED_ACCOUNTS,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Withdrawals from './Withdrawals.tsx'

// The same portfolio asked for $200,000.00: ETH exhausts its headroom,
// the brokerage sells at 15% on the gain, the gated 401(k) leaves
// $7,000.00 of the gap unfilled.
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
  stubApi({ '/api/sourcing': SOURCING, '/api/accounts': ACCOUNTS })
})

describe('sequencing waterfall', () => {
  it('walks target net through income and gap to net delivered', async () => {
    render(<Withdrawals />)

    const waterfall = await screen.findByTestId('sourcing-waterfall')
    expect(within(waterfall).getByText(/Target net spend/)).toBeInTheDocument()
    expect(within(waterfall).getAllByText('$45,000.00')).toHaveLength(2)
    expect(within(waterfall).getByText('−$3,000.00')).toBeInTheDocument()
    expect(within(waterfall).getByText(/Gap from portfolio/)).toBeInTheDocument()
    expect(within(waterfall).getByText('$42,000.00')).toBeInTheDocument()
    expect(within(waterfall).getByText(/Net delivered/)).toBeInTheDocument()
  })

  it('shows the active ETH step selling inside the headroom', async () => {
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-0')
    expect(step).toHaveTextContent('ETH')
    expect(step).toHaveTextContent('sell $42,000.00')
    expect(step).toHaveTextContent(/within \$96,700\.00 headroom/)
  })

  it('mutes an untouched bucket to $0.00 this yr', async () => {
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-1')
    expect(step).toHaveTextContent('Brokerage')
    expect(step).toHaveTextContent('$0.00 this yr')
  })

  it('surfaces the 401(k) age gate note', async () => {
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-2')
    expect(step).toHaveTextContent('401(k)')
    expect(step).toHaveTextContent('locked until age 59.5')
  })

  it('shows the tax cost on a taxed draw and flags a shortfall', async () => {
    stubApi({ '/api/sourcing': SOURCING_SHORT, '/api/accounts': ACCOUNTS })
    render(<Withdrawals />)

    const step = await screen.findByTestId('sourcing-step-1')
    expect(step).toHaveTextContent('sell $103,092.78')
    expect(step).toHaveTextContent(/tax \$3,092\.78/)
    expect(step).toHaveTextContent(/nets \$100,000\.00/)
    const banner = screen.getByTestId('sourcing-shortfall')
    expect(banner).toHaveTextContent('$7,000.00')
  })

  it('hides the shortfall banner when the gap is filled', async () => {
    render(<Withdrawals />)

    await screen.findByTestId('sourcing-waterfall')
    expect(screen.queryByTestId('sourcing-shortfall')).not.toBeInTheDocument()
  })
})

describe('what-if controls', () => {
  it('loads without an age and shows the server-derived one', async () => {
    // The server derives the default age from its birthdate constant —
    // the screen no longer hardcodes 38.
    const fetchMock = stubApi({
      '/api/sourcing': { ...SOURCING, age: 41 },
      '/api/accounts': ACCOUNTS,
    })
    render(<Withdrawals />)

    const age = await screen.findByTestId('sourcing-age')
    expect(fetchMock).toHaveBeenCalledWith('/api/sourcing')
    expect(age).toHaveValue(41)
  })

  it('refetches when the age changes', async () => {
    const fetchMock = stubApi({ '/api/sourcing': SOURCING, '/api/accounts': ACCOUNTS })
    render(<Withdrawals />)
    const age = await screen.findByTestId('sourcing-age')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/sourcing')

    fireEvent.change(age, { target: { value: '60' } })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/sourcing?age=60')
  })

  it('refetches at a what-if spend level', async () => {
    const fetchMock = stubApi({ '/api/sourcing': SOURCING, '/api/accounts': ACCOUNTS })
    render(<Withdrawals />)
    const spend = await screen.findByTestId('sourcing-spend')

    fireEvent.change(spend, { target: { value: '60000' } })

    // The untouched age stays server-derived rather than echoed back.
    expect(fetchMock).toHaveBeenLastCalledWith('/api/sourcing?spend=60000')
  })
})

describe('bucket rules', () => {
  it('states each bucket rule and the engine rule', async () => {
    render(<Withdrawals />)

    await screen.findByTestId('sourcing-waterfall')
    expect(screen.getByText(/Sold to exhaustion first/)).toBeInTheDocument()
    expect(screen.getByText(/Lot-level basis/)).toBeInTheDocument()
    expect(
      screen.getByTestId('sourcing-rules'),
    ).toHaveTextContent(/Drawn after the taxable buckets/)
    expect(
      screen.getByText(/never 0\.04 × balance per bucket/),
    ).toBeInTheDocument()
  })
})

describe('empty state', () => {
  it('points at Settings until tax params, balances, and a plan exist', async () => {
    stubApi({ '/api/sourcing': null, '/api/accounts': ACCOUNTS })
    render(<Withdrawals />)

    const empty = await screen.findByTestId('sourcing-empty')
    expect(empty).toHaveTextContent(/tax parameters/i)
    expect(screen.queryByTestId('sourcing-waterfall')).not.toBeInTheDocument()
  })

  it('points at account classification when no priorities are set', async () => {
    stubApi({ '/api/sourcing': null, '/api/accounts': UNCLASSIFIED_ACCOUNTS })
    render(<Withdrawals />)

    const empty = await screen.findByTestId('sourcing-empty')
    expect(empty).toHaveTextContent(/withdrawal priority/i)
    expect(empty).toHaveTextContent(/Settings & data/)
    expect(empty).not.toHaveTextContent(/Ledger entries/)
  })
})

describe('bucket rules', () => {
  it("names a gated tier's lock age from the waterfall", async () => {
    render(<Withdrawals />)

    const rules = await screen.findByTestId('sourcing-rules')
    expect(rules).toHaveTextContent('Under 59½ it stays locked')
  })

  it('leaves out a tier the portfolio does not hold', async () => {
    render(<Withdrawals />)

    const rules = await screen.findByTestId('sourcing-rules')
    expect(rules).not.toHaveTextContent('HSA')
  })

  it('adds the HSA tier and its own gate when the waterfall has one', async () => {
    stubApi({
      '/api/sourcing': {
        ...SOURCING,
        steps: [
          ...SOURCING.steps,
          {
            name: 'HSA · spouse',
            treatment: 'TAX_FREE',
            gross: 0,
            tax: 0,
            net: 0,
            note: 'locked until age 65',
            access_age: 65,
          },
        ],
      },
      '/api/accounts': ACCOUNTS,
    })
    render(<Withdrawals />)

    const rules = await screen.findByTestId('sourcing-rules')
    expect(rules).toHaveTextContent('④ HSA')
    expect(rules).toHaveTextContent('Under 65 it stays locked')
    expect(rules).toHaveTextContent('Under 59½ it stays locked')
  })

  it('drops the lock sentence for a tier with no gate', async () => {
    stubApi({
      '/api/sourcing': {
        ...SOURCING,
        steps: [
          SOURCING.steps[0],
          SOURCING.steps[1],
          { ...SOURCING.steps[2], note: null, access_age: null },
        ],
      },
      '/api/accounts': ACCOUNTS,
    })
    render(<Withdrawals />)

    const rules = await screen.findByTestId('sourcing-rules')
    expect(rules).toHaveTextContent('③ 401(k)')
    expect(rules).not.toHaveTextContent('stays locked')
  })
})

describe('step action derivation', () => {
  it('sells a capital-gains bucket and withdraws every other kind', () => {
    // A 401(k) or an HSA is withdrawn, not sold: there is no position
    // to realise, and "sell your HSA" reads as a mistake.
    expect(stepAction({ ...SOURCING.steps[0], treatment: 'LTCG' })).toBe('sell')
    expect(stepAction({ ...SOURCING.steps[0], treatment: 'ORDINARY' })).toBe(
      'withdraw',
    )
    expect(stepAction({ ...SOURCING.steps[0], treatment: 'TAX_FREE' })).toBe(
      'withdraw',
    )
  })
})

describe('step detail derivation', () => {
  it('prefers the gate note, then the idle label, then the tax cost', () => {
    expect(stepDetail(SOURCING.steps[2], 96_700)).toBe('locked until age 59.5')
    expect(stepDetail(SOURCING.steps[1], 96_700)).toBe('$0.00 this yr')
    expect(stepDetail(SOURCING.steps[0], 96_700)).toBe(
      'within $96,700.00 headroom · tax-free',
    )
    expect(stepDetail(SOURCING_SHORT.steps[1], 0)).toBe(
      'tax $3,092.78 → nets $100,000.00',
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
