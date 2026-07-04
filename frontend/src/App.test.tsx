import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'

beforeEach(() => {
  window.history.pushState({}, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', version: '1.2.3' }),
    }),
  )
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

  it('renders a nav link for each of the eight views', () => {
    render(<App />)

    for (const label of [
      'Dashboard',
      'Ledger entries',
      'Safe-to-spend',
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
