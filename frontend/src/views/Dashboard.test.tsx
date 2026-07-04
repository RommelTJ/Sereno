import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import NetWorthProvider from '../components/NetWorthProvider.tsx'
import { NET_WORTH } from '../test/fixtures.ts'
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

describe('Net worth hero', () => {
  it('shows the current net worth from the API', async () => {
    stubApi({ '/api/net-worth': NET_WORTH })
    renderDashboard()

    expect(await screen.findByText('$1,744,000')).toBeInTheDocument()
  })

  it('shows a rising YoY pill with the baseline month', async () => {
    stubApi({ '/api/net-worth': NET_WORTH })
    renderDashboard()

    expect(await screen.findByText('▲ 5.7%')).toBeInTheDocument()
    expect(screen.getByText('vs. Jun 2025')).toBeInTheDocument()
  })

  it('shows a falling YoY pill when the change is negative', async () => {
    stubApi({ '/api/net-worth': { ...NET_WORTH, yoy: -0.023 } })
    renderDashboard()

    expect(await screen.findByText('▼ 2.3%')).toBeInTheDocument()
  })

  it('renders one sparkline bar per series month, scaled to the max', async () => {
    stubApi({ '/api/net-worth': NET_WORTH })
    renderDashboard()

    const bars = await screen.findAllByTestId('spark-bar')
    expect(bars).toHaveLength(12)
    expect(bars[11].style.height).toBe('100%')
    expect(bars[0].style.height).toBe(`${(1_480_000 / 1_744_000) * 100}%`)
  })

  it('shows a placeholder and no pill before any data exists', async () => {
    stubApi({ '/api/net-worth': { current: null, yoy: null, series: [] } })
    renderDashboard()

    expect(await screen.findByText('$—')).toBeInTheDocument()
    expect(screen.queryByText(/[▲▼]/)).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('spark-bar')).toHaveLength(0)
  })

  it('omits the pill when under 12 months of history', async () => {
    stubApi({
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

describe('Placeholder cards', () => {
  beforeEach(() => {
    stubApi({ '/api/net-worth': NET_WORTH })
    renderDashboard()
  })

  it('deep-links the safe-to-spend card with its placeholder number', () => {
    const card = screen.getByRole('link', { name: /safe-to-spend/i })
    expect(card).toHaveAttribute('href', '/safe-to-spend')
    expect(within(card).getByText('$2,438')).toBeInTheDocument()
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
    stubApi({ '/api/net-worth': NET_WORTH })
    renderDashboard()

    expect(await screen.findByText('Recent activity')).toBeInTheDocument()
    expect(
      screen.getByText('No activity yet — spending and funding items land here.'),
    ).toBeInTheDocument()
  })
})
