import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { markerLeftPct } from '../guardrails.ts'
import {
  ACCOUNTS,
  GUARDRAILS,
  UNCLASSIFIED_ACCOUNTS,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Guardrails from './Guardrails.tsx'

// The same evaluation at a $60,000/yr what-if: 4.00% breaches the upper
// rail, so the capital-preservation rule fires.
const GUARDRAILS_AT_60K = {
  ...GUARDRAILS,
  spend: 60_000,
  rate: 0.04,
  zone: 'cut',
  raise_trigger: 2_551_020.41,
  cut_trigger: 1_700_680.27,
}

beforeEach(() => {
  stubApi({ '/api/guardrails': GUARDRAILS, '/api/accounts': ACCOUNTS })
})

describe('KPI row', () => {
  it('shows the investable portfolio, planned spend, and colored rate', async () => {
    render(<Guardrails />)

    const rate = await screen.findByTestId('guardrails-rate')
    expect(rate).toHaveTextContent('3.00%')
    expect(rate).toHaveClass('text-accent')
    expect(screen.getByText('$1,500,000')).toBeInTheDocument()
    expect(screen.getByText('$45,000')).toBeInTheDocument()
  })

  it('shows the 4% sanity ceiling, not as a binding rule', async () => {
    render(<Guardrails />)

    expect(await screen.findByText(/4% ceiling \$60,000/)).toBeInTheDocument()
  })
})

describe('three-zone band', () => {
  it('labels the zones and both rails at two decimals', async () => {
    render(<Guardrails />)

    expect(await screen.findByText('CUT 10%')).toBeInTheDocument()
    expect(screen.getByText('HOLD')).toBeInTheDocument()
    expect(screen.getByText('RAISE 10%')).toBeInTheDocument()
    expect(screen.getByText('upper guardrail 3.53%')).toBeInTheDocument()
    expect(screen.getByText('lower guardrail 2.35%')).toBeInTheDocument()
  })

  it('places the marker at the current rate', async () => {
    render(<Guardrails />)

    const marker = await screen.findByTestId('guardrails-marker')
    expect(marker.style.left).toBe(`${markerLeftPct(0.03, 0.02352, 0.03528)}%`)
  })
})

describe('recommendation banner', () => {
  it('holds steady inside the band', async () => {
    render(<Guardrails />)

    const banner = await screen.findByTestId('guardrails-banner')
    expect(
      within(banner).getByText('Hold steady — keep spending $45,000'),
    ).toBeInTheDocument()
    expect(
      within(banner).getByText(
        "You're inside both guardrails. No change recommended.",
      ),
    ).toBeInTheDocument()
  })
})

describe('trigger cards', () => {
  it('names the raise and cut portfolio levels', async () => {
    render(<Guardrails />)

    const raise = await screen.findByTestId('guardrails-raise-trigger')
    expect(raise).toHaveTextContent('$1,913,265')
    expect(raise).toHaveTextContent(/raise spend ~10%/)
    const cut = screen.getByTestId('guardrails-cut-trigger')
    expect(cut).toHaveTextContent('$1,275,510')
    expect(cut).toHaveTextContent(/cut spend ~10%/)
  })
})

describe('spend slider', () => {
  it('derives its bounds from the band edges', async () => {
    render(<Guardrails />)

    const slider = await screen.findByTestId('guardrails-slider')
    // 0.5 × 2.352% × 1.5M → $17k; 1.5 × 3.528% × 1.5M → $80k
    expect(slider).toHaveAttribute('min', '17000')
    expect(slider).toHaveAttribute('max', '80000')
    expect(slider).toHaveAttribute('step', '1000')
    expect(slider).toHaveValue('45000')
  })

  it('refetches the evaluation at the dragged spend level', async () => {
    const routes: Record<string, unknown> = {
      '/api/guardrails': GUARDRAILS,
      '/api/accounts': ACCOUNTS,
    }
    const fetchMock = stubApi(routes)
    render(<Guardrails />)
    const slider = await screen.findByTestId('guardrails-slider')
    routes['/api/guardrails'] = GUARDRAILS_AT_60K

    fireEvent.change(slider, { target: { value: '60000' } })

    const rate = await screen.findByText('4.00%')
    expect(rate).toHaveClass('text-red')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/guardrails?spend=60000')
    expect(
      screen.getByText('Trim spending ~10%'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your rate is above the upper guardrail — the capital-preservation rule kicks in.',
      ),
    ).toBeInTheDocument()
  })
})

describe('empty state', () => {
  it('points at Settings until a plan and balances exist', async () => {
    stubApi({ '/api/guardrails': null, '/api/accounts': ACCOUNTS })
    render(<Guardrails />)

    const empty = await screen.findByTestId('guardrails-empty')
    expect(empty).toHaveTextContent(/spend plan/i)
    expect(screen.queryByTestId('guardrails-rate')).not.toBeInTheDocument()
  })

  it('points at account classification when nothing is investable', async () => {
    stubApi({
      '/api/guardrails': null,
      '/api/accounts': UNCLASSIFIED_ACCOUNTS,
    })
    render(<Guardrails />)

    const empty = await screen.findByTestId('guardrails-empty')
    expect(empty).toHaveTextContent(/marked investable/i)
    expect(empty).toHaveTextContent(/Settings & data/)
    expect(empty).not.toHaveTextContent(/Ledger entries/)
  })

  it('ignores inactive accounts when looking for an investable one', async () => {
    const inactive = ACCOUNTS.map((account) => ({ ...account, active: false }))
    stubApi({ '/api/guardrails': null, '/api/accounts': inactive })
    render(<Guardrails />)

    expect(await screen.findByTestId('guardrails-empty')).toHaveTextContent(
      /marked investable/i,
    )
  })
})

describe('responsive layout', () => {
  it('stacks the trigger cards into one column on narrow screens', async () => {
    render(<Guardrails />)

    const raise = await screen.findByTestId('guardrails-raise-trigger')
    expect(raise.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })
})
