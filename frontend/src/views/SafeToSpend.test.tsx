import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BUDGET_MONTH, FUNDS } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import SafeToSpend from './SafeToSpend.tsx'

beforeEach(() => {
  stubApi({ '/api/budget-month': BUDGET_MONTH, '/api/funds': FUNDS })
})

describe('Safe-to-spend hero', () => {
  it('shows the headline from the API', async () => {
    render(<SafeToSpend />)

    expect(await screen.findByText('$3,670')).toBeInTheDocument()
  })

  it('shows the formula pill', async () => {
    render(<SafeToSpend />)

    expect(
      await screen.findByText('total cash − bills due − money in funds'),
    ).toBeInTheDocument()
  })
})

describe('Envelopes card', () => {
  it('titles the card with the budget month and the overspend hint', async () => {
    render(<SafeToSpend />)

    expect(await screen.findByText('June envelopes')).toBeInTheDocument()
    expect(
      screen.getByText('over is OK — trims safe-to-spend'),
    ).toBeInTheDocument()
  })

  it('renders spent and left for an under-budget category', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('envelope-row')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByText('🛒 Groceries')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$387 · $113 left')).toBeInTheDocument()
    const bar = within(rows[0]).getByTestId('envelope-bar')
    expect(bar).toHaveClass('bg-accent')
    expect(bar.style.width).toBe(`${(387 / 500) * 100}%`)
  })

  it('shows the overage in red when a category is over budget', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('envelope-row')
    const overage = within(rows[2]).getByText('$46 over')
    expect(overage).toHaveClass('text-red')
    const bar = within(rows[2]).getByTestId('envelope-bar')
    expect(bar).toHaveClass('bg-red')
    expect(bar.style.width).toBe('100%')
  })

  it('renders an empty bar when a category has no plan yet', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('envelope-row')
    expect(within(rows[3]).getByText('$0 · $0 left')).toBeInTheDocument()
    expect(within(rows[3]).getByTestId('envelope-bar').style.width).toBe('0%')
  })
})
