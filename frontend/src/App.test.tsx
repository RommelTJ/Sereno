import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { stubApi } from './test/stubs.ts'
import App from './App.tsx'

beforeEach(() => {
  window.history.pushState({}, '', '/')
  stubApi({
    '/api/health': { status: 'ok', version: '1.2.3' },
    '/api/net-worth': { current: null, yoy: null, series: [] },
    '/api/budget-month': {
      month: '2026-06',
      baseline: 0,
      total_spent: 0,
      safe_to_spend: 0,
      categories: [],
      activity: [],
    },
    '/api/funds': [],
    '/api/guardrails': null,
    '/api/forecast': null,
    '/api/budget-year': { year: 2026, data_start: null, months: [] },
  })
})

describe('App shell', () => {
  it('renders the sidebar with the three nav groups', () => {
    render(<App />)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByText('TRACK')).toBeInTheDocument()
    expect(screen.getByText('PLAN')).toBeInTheDocument()
    expect(screen.getByText('SETTINGS')).toBeInTheDocument()
  })

  it('renders a nav link for each of the nine views', () => {
    render(<App />)

    for (const label of [
      'Dashboard',
      'Ledger entries',
      'Safe-to-spend',
      'Budget report',
      'Funds & goals',
      'Guardrails',
      'Withdrawal sourcing',
      'Longevity forecast',
      'Settings & data',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('renders the sticky header with the page title and net-worth slot', () => {
    render(<App />)

    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeInTheDocument()
    expect(within(header).getByText('Net worth')).toBeInTheDocument()
    expect(within(header).getByText('$—')).toBeInTheDocument()
  })

  it('shows the current month in the sidebar footer chip', () => {
    render(<App />)

    const month = new Date().toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
    expect(screen.getByText(month)).toBeInTheDocument()
  })
})

describe('Budget report route', () => {
  it('renders the Budget report view at /report with its header title', () => {
    window.history.pushState({}, '', '/report')
    render(<App />)

    expect(screen.getByTestId('view-budget-report')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Budget report' }),
    ).toBeInTheDocument()
  })
})
