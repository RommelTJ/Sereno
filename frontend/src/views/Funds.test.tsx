import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FUNDS } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Funds from './Funds.tsx'

beforeEach(() => {
  stubApi({ '/api/funds': FUNDS })
})

describe('Funds & goals card', () => {
  it('shows the total parked and the auto-calculate hint', async () => {
    render(<Funds />)

    expect(await screen.findByText('Total parked')).toBeInTheDocument()
    expect(screen.getByText('$24,200')).toBeInTheDocument()
    expect(
      screen.getByText('notes auto-calculate from target, saved & date'),
    ).toBeInTheDocument()
  })

  it('renders each fund with its meta, amount, bar and derived note', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Emergency fund')).toBeInTheDocument()
    expect(within(rows[0]).getByText('· sinking · no date')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$10,000 / $30,000')).toBeInTheDocument()
    const bar = within(rows[0]).getByTestId('fund-bar')
    expect(bar).toHaveClass('bg-sidebar')
    expect(bar.style.width).toBe(`${(10_000 / 30_000) * 100}%`)
    const note = within(rows[0]).getByText('$500 / mo · ~3.3 yrs to target')
    expect(note).toHaveClass('text-muted-2')
  })

  it('formats a goal meta line from its ISO target date', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[1]).getByText('· goal · Jul 2026')).toBeInTheDocument()
  })

  it('renders a completed fund in accent green', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[1]).getByTestId('fund-bar')).toHaveClass('bg-accent')
    expect(
      within(rows[1]).getByText('✓ fully funded — ready to spend'),
    ).toHaveClass('text-accent')
  })

  it('renders an open-ended fund without a target or a bar', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[2]).getByText('$4,200')).toBeInTheDocument()
    expect(within(rows[2]).queryByTestId('fund-bar')).not.toBeInTheDocument()
    expect(
      within(rows[2]).getByText('$300 / mo · open-ended'),
    ).toBeInTheDocument()
  })
})
