import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import NetWorthProvider from '../components/NetWorthProvider.tsx'
import { BUDGET_MONTH, FUNDS, NET_WORTH } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Dashboard from './Dashboard.tsx'

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <NetWorthProvider>
        <Dashboard />
      </NetWorthProvider>
    </MemoryRouter>,
  )

// The wired dashboard fetches all three APIs; tests override per route.
const stubDashboard = (routes: Record<string, unknown> = {}) =>
  stubApi({
    '/api/net-worth': NET_WORTH,
    '/api/budget-month': BUDGET_MONTH,
    '/api/funds': FUNDS,
    ...routes,
  })

describe('Net worth hero', () => {
  it('shows the current net worth from the API', async () => {
    stubDashboard()
    renderDashboard()

    expect(await screen.findByText('$1,744,000')).toBeInTheDocument()
  })

  it('shows a rising YoY pill with the baseline month', async () => {
    stubDashboard()
    renderDashboard()

    expect(await screen.findByText('▲ 5.7%')).toBeInTheDocument()
    expect(screen.getByText('vs. Jun 2025')).toBeInTheDocument()
  })

  it('shows a falling YoY pill when the change is negative', async () => {
    stubDashboard({ '/api/net-worth': { ...NET_WORTH, yoy: -0.023 } })
    renderDashboard()

    expect(await screen.findByText('▼ 2.3%')).toBeInTheDocument()
  })

  it('renders one sparkline bar per series month, scaled to the max', async () => {
    stubDashboard()
    renderDashboard()

    const bars = await screen.findAllByTestId('spark-bar')
    expect(bars).toHaveLength(12)
    expect(bars[11].style.height).toBe('100%')
    expect(bars[0].style.height).toBe(`${(1_480_000 / 1_744_000) * 100}%`)
  })

  it('shows a placeholder and no pill before any data exists', async () => {
    stubDashboard({
      '/api/net-worth': { current: null, yoy: null, series: [] },
    })
    renderDashboard()

    expect(await screen.findByText('$—')).toBeInTheDocument()
    expect(screen.queryByText(/[▲▼]/)).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('spark-bar')).toHaveLength(0)
  })

  it('omits the pill when under 12 months of history', async () => {
    stubDashboard({
      '/api/net-worth': {
        current: 1_744_000,
        yoy: null,
        series: NET_WORTH.series.slice(-3),
      },
    })
    renderDashboard()

    expect(await screen.findByText('$1,744,000')).toBeInTheDocument()
    expect(screen.queryByText(/[▲▼]/)).not.toBeInTheDocument()
  })
})

describe('Safe-to-spend card', () => {
  it('deep-links and shows the live headline from the budget API', async () => {
    stubDashboard()
    renderDashboard()

    const card = screen.getByRole('link', { name: /safe-to-spend/i })
    expect(card).toHaveAttribute('href', '/safe-to-spend')
    expect(await within(card).findByText('$3,670')).toBeInTheDocument()
  })

  it('fills the progress bar with the safe-to-spend share of the baseline', async () => {
    stubDashboard()
    renderDashboard()

    const bar = await screen.findByTestId('sts-bar')
    expect(bar.style.width).toBe(`${(3_670 / 5_200) * 100}%`)
  })
})

describe('Placeholder cards', () => {
  beforeEach(() => {
    stubDashboard()
    renderDashboard()
  })

  it('deep-links the guardrail card with its placeholder rate and status', () => {
    const card = screen.getByRole('link', { name: /spend guardrail/i })
    expect(card).toHaveAttribute('href', '/guardrails')
    expect(within(card).getByText('3.0%')).toBeInTheDocument()
    expect(within(card).getByText('Hold steady')).toBeInTheDocument()
  })

  it('deep-links the longevity card with its placeholder verdict', () => {
    const card = screen.getByRole('link', { name: /longevity/i })
    expect(card).toHaveAttribute('href', '/forecast')
    expect(within(card).getByText("You don't run out.")).toBeInTheDocument()
    expect(within(card).getByText('~$5.5M')).toBeInTheDocument()
  })

  it('deep-links the funds card with its placeholder totals and mini list', () => {
    const card = screen.getByRole('link', { name: /funds & goals/i })
    expect(card).toHaveAttribute('href', '/funds')
    expect(within(card).getByText('$66,000')).toBeInTheDocument()
    expect(within(card).getByText('parked across 5 funds')).toBeInTheDocument()
    expect(within(card).getByText('Emergency fund')).toBeInTheDocument()
    expect(within(card).getByText('House maintenance')).toBeInTheDocument()
    expect(within(card).getByText('1st-year fund')).toBeInTheDocument()
  })
})

describe('Recent activity scaffold', () => {
  it('renders the empty card awaiting the safe-to-spend slice', async () => {
    stubDashboard()
    renderDashboard()

    expect(await screen.findByText('Recent activity')).toBeInTheDocument()
    expect(
      screen.getByText('No activity yet — spending and funding items land here.'),
    ).toBeInTheDocument()
  })
})
