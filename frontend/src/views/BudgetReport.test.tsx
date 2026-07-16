import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BUDGET_YEAR } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import BudgetReport from './BudgetReport.tsx'

describe('Budget report table', () => {
  it('renders one row per month with planned, actual, variance, and cumulative', async () => {
    stubApi({ '/api/budget-year': BUDGET_YEAR })
    render(<BudgetReport />)

    const rows = await screen.findAllByTestId('report-row')
    expect(rows).toHaveLength(12)
    const march = rows[2]
    expect(within(march).getByText('Mar')).toBeInTheDocument()
    expect(within(march).getByText('$7,500')).toBeInTheDocument()
    expect(within(march).getByText('$7,000')).toBeInTheDocument()
    // +$500 shows twice: the month's variance and the running cumulative.
    expect(within(march).getAllByText('+$500')).toHaveLength(2)
  })

  it('colors an over-plan variance red and an under-plan one green', async () => {
    stubApi({ '/api/budget-year': BUDGET_YEAR })
    render(<BudgetReport />)

    const rows = await screen.findAllByTestId('report-row')
    const april = rows[3]
    expect(within(april).getByText('-$700')).toHaveClass('text-red-text')
    expect(within(april).getByText('-$200')).toHaveClass('text-red-text')
    expect(within(rows[2]).getAllByText('+$500')[0]).toHaveClass('text-accent')
  })

  it('leaves months outside the data blank', async () => {
    stubApi({ '/api/budget-year': BUDGET_YEAR })
    render(<BudgetReport />)

    const rows = await screen.findAllByTestId('report-row')
    expect(within(rows[0]).getByText('Jan')).toBeInTheDocument()
    expect(within(rows[0]).queryByText(/\$/)).not.toBeInTheDocument()
    expect(within(rows[11]).queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('marks the in-progress month as provisional', async () => {
    stubApi({ '/api/budget-year': BUDGET_YEAR })
    render(<BudgetReport />)

    const rows = await screen.findAllByTestId('report-row')
    expect(within(rows[6]).getByText(/in progress/)).toBeInTheDocument()
    const marked = rows.filter((row) => within(row).queryByText(/in progress/))
    expect(marked).toHaveLength(1)
  })
})

describe('Year picker', () => {
  it('offers the data-start → current years and refetches on change', async () => {
    const fetchMock = stubApi({
      '/api/budget-year': { ...BUDGET_YEAR, data_start: '2024-03' },
    })
    render(<BudgetReport />)

    const select = await screen.findByLabelText('Year')
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/budget-year')
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['2025', '2024'])

    fireEvent.change(select, { target: { value: '2024' } })
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/api/budget-year?year=2024'),
      ),
    ).toBe(true)
  })
})
