import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNTS, LEDGER } from './test/fixtures.ts'
import { stubApi } from './test/stubs.ts'
import App from './App.tsx'

const EMPTY_BUDGET_MONTH = {
  month: '2026-06',
  baseline: 0,
  total_spent: 0,
  safe_to_spend: 0,
  categories: [],
  activity: [],
}

beforeEach(() => {
  window.history.pushState({}, '', '/')
  stubApi({
    '/api/health': { status: 'ok', version: '1.2.3' },
    '/api/accounts': [],
    '/api/ledger': [],
    '/api/net-worth': { current: null, yoy: null, series: [] },
    '/api/budget-month': EMPTY_BUDGET_MONTH,
    '/api/funds': [],
    '/api/guardrails': null,
    '/api/sourcing': null,
    '/api/forecast': null,
    // The Settings view's config fetches, as a fresh database answers.
    '/api/assumptions': null,
    '/api/spend-plan': null,
    '/api/social-security': [],
    '/api/tax-params': [],
  })
})

describe('App shell navigation', () => {
  it('navigates to a view when its sidebar item is clicked', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: 'Guardrails' }))

    expect(
      screen.getByRole('heading', { level: 1, name: 'Spending guardrails' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('view-guardrails')).toBeInTheDocument()
  })

  it('renders each of the eight views as it navigates through the sidebar', () => {
    render(<App />)

    const views: Array<[string, string]> = [
      ['Ledger entries', 'view-ledger'],
      ['Safe-to-spend', 'view-safe-to-spend'],
      ['Funds & goals', 'view-funds'],
      ['Guardrails', 'view-guardrails'],
      ['Withdrawal sourcing', 'view-withdrawals'],
      ['Longevity forecast', 'view-forecast'],
      ['Settings & data', 'view-settings'],
      ['Dashboard', 'view-dashboard'],
    ]
    for (const [label, testId] of views) {
      fireEvent.click(screen.getByRole('link', { name: label }))
      expect(screen.getByTestId(testId)).toBeInTheDocument()
    }
  })

  it('deep-links straight to a view from the URL', () => {
    window.history.pushState({}, '', '/ledger')

    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ledger entries' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('view-ledger')).toBeInTheDocument()
  })

  it('marks only the active nav item with aria-current', () => {
    render(<App />)

    const dashboard = screen.getByRole('link', { name: 'Dashboard' })
    const funds = screen.getByRole('link', { name: 'Funds & goals' })
    expect(dashboard).toHaveAttribute('aria-current', 'page')
    expect(funds).not.toHaveAttribute('aria-current')

    fireEvent.click(funds)

    expect(funds).toHaveAttribute('aria-current', 'page')
    expect(dashboard).not.toHaveAttribute('aria-current')
  })
})

describe('Header net worth', () => {
  it('shows the live net worth from the API', async () => {
    stubApi({
      '/api/health': { status: 'ok', version: '1.2.3' },
      '/api/net-worth': { current: 1_744_000, yoy: 0.017, series: [] },
      '/api/budget-month': EMPTY_BUDGET_MONTH,
      '/api/funds': [],
      '/api/guardrails': null,
      '/api/forecast': null,
    })

    render(<App />)

    // The dashboard hero shows the same figure; scope to the header.
    const header = screen.getByRole('banner')
    expect(await within(header).findByText('$1,744,000')).toBeInTheDocument()
  })

  it('refreshes the readout after saving balances on the ledger view', async () => {
    const routes: Record<string, unknown> = {
      '/api/health': { status: 'ok', version: '1.2.3' },
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER,
      '/api/net-worth': { current: 1_744_000, yoy: 0.017, series: [] },
      '/api/budget-month': EMPTY_BUDGET_MONTH,
      '/api/funds': [],
      '/api/guardrails': null,
      '/api/forecast': null,
      '/api/balance-entries': { id: 999 },
    }
    stubApi(routes)
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Ledger entries' }))
    await screen.findByRole('button', { name: 'Save balances' })

    // The server's net worth moves once the new entries land.
    routes['/api/net-worth'] = { current: 1_754_000, yoy: 0.023, series: [] }
    fireEvent.click(screen.getByRole('button', { name: 'Save balances' }))

    expect(await screen.findByText('$1,754,000')).toBeInTheDocument()
  })
})
