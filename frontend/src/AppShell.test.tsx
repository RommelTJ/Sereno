import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { stubApi } from './test/stubs.ts'
import App from './App.tsx'

beforeEach(() => {
  window.history.pushState({}, '', '/')
  stubApi({
    '/api/health': { status: 'ok', version: '1.2.3' },
    '/api/accounts': [],
    '/api/ledger': [],
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
