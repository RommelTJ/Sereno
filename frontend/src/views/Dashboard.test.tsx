import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import NetWorthProvider from '../components/NetWorthProvider.tsx'
import { markerLeftPct } from '../guardrails.ts'
import { BUDGET_MONTH, FORECAST, FUNDS, GUARDRAILS, NET_WORTH } from '../test/fixtures.ts'
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

// The wired dashboard fetches all five APIs; tests override per route.
const stubDashboard = (routes: Record<string, unknown> = {}) =>
  stubApi({
    '/api/net-worth': NET_WORTH,
    '/api/budget-month': BUDGET_MONTH,
    '/api/funds': FUNDS,
    '/api/guardrails': GUARDRAILS,
    '/api/forecast': FORECAST,
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

describe('Spend guardrail card', () => {
  it('deep-links and shows the live rate, marker, and status', async () => {
    stubDashboard()
    renderDashboard()

    const card = screen.getByRole('link', { name: /spend guardrail/i })
    expect(card).toHaveAttribute('href', '/guardrails')
    expect(await within(card).findByText('3.00%')).toBeInTheDocument()
    expect(within(card).getByText('Hold steady')).toBeInTheDocument()
    const marker = within(card).getByTestId('guardrail-marker')
    expect(marker.style.left).toBe(`${markerLeftPct(0.03, 0.02352, 0.03528)}%`)
  })

  it('turns red when the rate breaches the upper rail', async () => {
    stubDashboard({
      '/api/guardrails': { ...GUARDRAILS, spend: 60_000, rate: 0.04, zone: 'cut' },
    })
    renderDashboard()

    const card = screen.getByRole('link', { name: /spend guardrail/i })
    const rate = await within(card).findByText('4.00%')
    expect(rate).toHaveClass('text-red')
    expect(within(card).getByText('Cut ~10%')).toBeInTheDocument()
  })

  it('keeps a muted placeholder before a plan exists', async () => {
    stubDashboard({ '/api/guardrails': null })
    renderDashboard()

    const card = screen.getByRole('link', { name: /spend guardrail/i })
    expect(await within(card).findByText('—')).toBeInTheDocument()
    expect(within(card).getByText('no spend plan yet')).toBeInTheDocument()
    expect(within(card).queryByTestId('guardrail-marker')).not.toBeInTheDocument()
  })
})

describe('Longevity card', () => {
  it('deep-links and shows the live verdict, spend, and age-100 balance', async () => {
    stubDashboard()
    renderDashboard()

    const card = screen.getByRole('link', { name: /longevity/i })
    expect(card).toHaveAttribute('href', '/forecast')
    expect(await within(card).findByText("You don't run out.")).toBeInTheDocument()
    expect(within(card).getByText('at $45,000/yr')).toBeInTheDocument()
    expect(within(card).getByText('~$5.51M')).toBeInTheDocument()
    expect(within(card).getByText('projected at age 100')).toBeInTheDocument()
  })

  it('turns red when the money runs out early', async () => {
    stubDashboard({
      '/api/forecast': { ...FORECAST, spend: 90_000, run_out_age: 72, balance_at_100: 0 },
    })
    renderDashboard()

    const card = screen.getByRole('link', { name: /longevity/i })
    const headline = await within(card).findByText('Lasts to age 71')
    expect(headline).toHaveClass('text-red')
    expect(within(card).getByText('at $90,000/yr')).toBeInTheDocument()
  })

  it('keeps a muted placeholder before the forecast can run', async () => {
    stubDashboard({ '/api/forecast': null })
    renderDashboard()

    const card = screen.getByRole('link', { name: /longevity/i })
    expect(await within(card).findByText('no forecast yet')).toBeInTheDocument()
    expect(within(card).queryByText("You don't run out.")).not.toBeInTheDocument()
  })
})

describe('Funds & goals card', () => {
  it('deep-links and shows the live total parked from the funds API', async () => {
    stubDashboard()
    renderDashboard()

    const card = screen.getByRole('link', { name: /funds & goals/i })
    expect(card).toHaveAttribute('href', '/funds')
    expect(await within(card).findByText('$24,200')).toBeInTheDocument()
    expect(within(card).getByText('parked across 3 funds')).toBeInTheDocument()
  })

  it('lists the top three funds with their percent to target', async () => {
    stubDashboard()
    renderDashboard()

    const card = screen.getByRole('link', { name: /funds & goals/i })
    expect(await within(card).findByText('Emergency fund')).toBeInTheDocument()
    expect(within(card).getByText('33%')).toBeInTheDocument()
    expect(within(card).getByText('Bike fund')).toBeInTheDocument()
    expect(within(card).getByText('100%')).toBeInTheDocument()
  })

  it('shows an open-ended fund by its balance instead of a percent', async () => {
    stubDashboard()
    renderDashboard()

    const card = screen.getByRole('link', { name: /funds & goals/i })
    expect(await within(card).findByText('Travel fund')).toBeInTheDocument()
    expect(within(card).getByText('$4,200')).toBeInTheDocument()
  })
})

describe('Recent activity', () => {
  it('renders a spending row with its category emoji and ink amount', async () => {
    stubDashboard()
    renderDashboard()

    expect(await screen.findByText('Groceries · Jun 10')).toBeInTheDocument()
    expect(screen.getByText('🛒')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('−$387').className).toContain('text-ink')
  })

  it('renders a treat in red when its category is over budget', async () => {
    stubDashboard()
    renderDashboard()

    expect(await screen.findByText('Poke — treat yourself')).toBeInTheDocument()
    expect(screen.getByText('Entertainment · Jun 26')).toBeInTheDocument()
    expect(screen.getByText('−$28.40').className).toContain('text-red')
  })

  it('renders a funding row with a green amount and the funded month', async () => {
    stubDashboard()
    renderDashboard()

    expect(await screen.findByText('Spouse paycheck')).toBeInTheDocument()
    expect(screen.getByText('Funds June · May 27')).toBeInTheDocument()
    expect(screen.getByText('💵')).toBeInTheDocument()
    expect(screen.getByText('+$2,400').className).toContain('text-accent')
  })

  it('renders a fund row with its fund emoji and parked tone', async () => {
    stubDashboard()
    renderDashboard()

    const rows = await screen.findAllByTestId('activity-row')
    const fundRow = rows[2]
    expect(within(fundRow).getByText('Emergency fund')).toBeInTheDocument()
    expect(within(fundRow).getByText('Funding · Jun 1')).toBeInTheDocument()
    // The emoji resolves from the funds list, like an expense's resolves
    // from its envelope; parked money is neither income nor spending.
    expect(within(fundRow).getByText('🚨')).toHaveClass('bg-amber-soft')
    expect(within(fundRow).getByText('−$500').className).toContain('text-muted')
  })

  it('renders a release with a plus and a fallback icon for an archived fund', async () => {
    stubDashboard({
      '/api/budget-month': {
        ...BUDGET_MONTH,
        activity: [
          {
            type: 'fund',
            id: 11,
            txn_date: '2026-06-18',
            amount: -200,
            category: 'Piano fund',
            source: 'top_up',
            note: null,
          },
        ],
      },
    })
    renderDashboard()

    // 'Piano fund' is archived, so GET /api/funds no longer lists it —
    // the row keeps its name but falls back to the generic icon.
    const rows = await screen.findAllByTestId('activity-row')
    expect(within(rows[0]).getByText('💰')).toBeInTheDocument()
    expect(within(rows[0]).getByText('+$200').className).toContain('text-muted')
  })

  it('deep-links the header to add an item on the safe-to-spend view', async () => {
    stubDashboard()
    renderDashboard()

    const link = await screen.findByRole('link', { name: 'Add an item →' })
    expect(link).toHaveAttribute('href', '/safe-to-spend')
  })

  it('caps the list at the five newest items', async () => {
    stubDashboard({
      '/api/budget-month': {
        ...BUDGET_MONTH,
        activity: Array.from({ length: 7 }, (_, i) => ({
          type: 'expense',
          id: i + 1,
          txn_date: `2026-06-${String(20 - i).padStart(2, '0')}`,
          amount: 10 + i,
          category: 'Groceries',
          source: null,
          note: null,
        })),
      },
    })
    renderDashboard()

    expect(await screen.findAllByTestId('activity-row')).toHaveLength(5)
  })

  it('keeps the empty state when the month has no activity', async () => {
    stubDashboard({
      '/api/budget-month': { ...BUDGET_MONTH, activity: [] },
    })
    renderDashboard()

    expect(await screen.findByText('Recent activity')).toBeInTheDocument()
    expect(
      screen.getByText('No activity yet — spending and funding items land here.'),
    ).toBeInTheDocument()
  })
})

describe('Responsive layout', () => {
  it('stacks both dashboard grids into one column on narrow screens', async () => {
    stubDashboard()
    renderDashboard()
    await screen.findByText('$1,744,000')

    const view = screen.getByTestId('view-dashboard')
    expect(view.children[0]).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-[1.5fr_1fr]',
    )
    expect(view.children[1]).toHaveClass('grid-cols-1', 'sm:grid-cols-3')
  })

  it('scales the hero figures down on narrow screens', async () => {
    stubDashboard()
    renderDashboard()

    const netWorth = await screen.findByText('$1,744,000')
    expect(netWorth).toHaveClass('text-4xl', 'sm:text-[52px]')
    const card = screen.getByRole('link', { name: /safe-to-spend/i })
    expect(within(card).getByText('$3,670')).toHaveClass(
      'text-3xl',
      'sm:text-[44px]',
    )
  })
})
