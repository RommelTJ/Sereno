import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayIso } from '../ledger.ts'
import { BUDGET_MONTH, FUNDS } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import SafeToSpend from './SafeToSpend.tsx'

const postBody = (fetchMock: ReturnType<typeof stubApi>, path: string) => {
  const call = fetchMock.mock.calls.find(([input]) => input === path)
  return call ? JSON.parse(call[1]?.body as string) : undefined
}

const expenseBody = (fetchMock: ReturnType<typeof stubApi>) =>
  postBody(fetchMock, '/api/expenses')

// The funds-month options: the current month and the next two, as the
// funding form should offer them.
const fundsMonth = (offset: number) => {
  const now = new Date()
  const month = new Date(now.getFullYear(), now.getMonth() + offset)
  return {
    value: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
    label: month.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    }),
  }
}

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

describe('Add a spending item', () => {
  it('offers the discretionary budget and each active fund as sources', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('spending-form')
    const options = within(form)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toContain('June budget · discretionary')
    expect(options).toContain('Emergency fund')
    expect(options).toContain('Bike fund')
  })

  it('posts the expense and refreshes the hero and envelopes', async () => {
    const routes: Record<string, unknown> = {
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 99 },
    }
    const fetchMock = stubApi(routes)
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '45' },
    })
    fireEvent.change(within(form).getByLabelText('Category'), {
      target: { value: '2' },
    })
    routes['/api/budget-month'] = {
      ...BUDGET_MONTH,
      total_spent: 1_575,
      safe_to_spend: 3_625,
    }
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    expect(await screen.findByText('$3,625')).toBeInTheDocument()
    expect(expenseBody(fetchMock)).toEqual({
      txn_date: todayIso(),
      category_id: 2,
      amount: 45,
      funded_from: 'discretionary',
    })
    expect(within(form).getByLabelText('Amount')).toHaveValue('')
  })

  it('reveals the Cash Plus reminder and posts the fund id for fund spending', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 100 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    expect(
      within(form).queryByText(/Log a matching withdrawal/),
    ).not.toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Funded from'), {
      target: { value: 'fund:2' },
    })

    expect(
      within(form).getByText(
        '↳ Log a matching withdrawal from Vanguard Cash Plus so the fund and cash draw down together.',
      ),
    ).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '1,200' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock)).toEqual({
      txn_date: todayIso(),
      category_id: 1,
      amount: 1200,
      funded_from: 'fund',
      fund_id: 2,
    })
  })

  it('does not post when the amount is empty', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    expect(expenseBody(fetchMock)).toBeUndefined()
  })
})

describe('Add a funding item', () => {
  it('offers the current and next two months as the funds month', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('funding-form')
    const select = within(form).getByLabelText('Funds month')
    const options = within(select).getAllByRole('option')
    expect(
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent,
      })),
    ).toEqual([fundsMonth(0), fundsMonth(1), fundsMonth(2)])
  })

  it('posts the income tagged to the selected month and refreshes the hero', async () => {
    const routes: Record<string, unknown> = {
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 5 },
    }
    const fetchMock = stubApi(routes)
    render(<SafeToSpend />)
    const form = await screen.findByTestId('funding-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '2,400' },
    })
    fireEvent.change(within(form).getByLabelText('Funds month'), {
      target: { value: fundsMonth(1).value },
    })
    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'your-paycheck' },
    })
    routes['/api/budget-month'] = {
      ...BUDGET_MONTH,
      baseline: 7_600,
      safe_to_spend: 6_070,
    }
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add funding row' }),
    )

    expect(await screen.findByText('$6,070')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/income')).toEqual({
      txn_date: todayIso(),
      budget_month: fundsMonth(1).value,
      source: 'paycheck',
      amount: 2400,
      note: 'You paycheck',
    })
    expect(within(form).getByLabelText('Amount')).toHaveValue('')
  })

  it('maps every source option onto the API source values', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('funding-form')
    const select = within(form).getByLabelText('Source')
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      '💵 Spouse paycheck',
      '💵 Your paycheck',
      '🏦 Brokerage withdrawal',
      'Ξ ETH harvest',
      '🏠 Cash Plus transfer',
    ])
  })

  it('explains the rollover behavior', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('funding-form')
    expect(within(form).getByText('Rollover')).toBeInTheDocument()
    expect(
      within(form).getByText(/rolls into the next month's funding/),
    ).toBeInTheDocument()
  })

  it('does not post when the amount is empty', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('funding-form')

    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add funding row' }),
    )

    expect(postBody(fetchMock, '/api/income')).toBeUndefined()
  })
})

describe('Responsive layout', () => {
  it('stacks the hero column and forms into one column on narrow screens', async () => {
    render(<SafeToSpend />)
    await screen.findByText('$3,670')

    expect(screen.getByTestId('view-safe-to-spend')).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-[1fr_1fr]',
    )
  })

  it('stacks the form field grids into one column on narrow screens', async () => {
    render(<SafeToSpend />)

    const spending = await screen.findByTestId('spending-form')
    expect(
      within(spending).getByLabelText('Amount').closest('.grid'),
    ).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
    const funding = screen.getByTestId('funding-form')
    expect(
      within(funding).getByLabelText('Amount').closest('.grid'),
    ).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })

  it('scales the hero figure down on narrow screens', async () => {
    render(<SafeToSpend />)

    expect(await screen.findByText('$3,670')).toHaveClass(
      'text-4xl',
      'sm:text-[56px]',
    )
  })
})
