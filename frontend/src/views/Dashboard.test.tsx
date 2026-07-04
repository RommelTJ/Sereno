import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
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
