import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayIso } from '../ledger.ts'
import { BUDGET_MONTH, FUNDS, MAY_BUDGET_MONTH } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import SafeToSpend from './SafeToSpend.tsx'

const postBody = (fetchMock: ReturnType<typeof stubApi>, path: string) => {
  const call = fetchMock.mock.calls.find(([input]) => input === path)
  return call ? JSON.parse(call[1]?.body as string) : undefined
}

const expenseBody = (fetchMock: ReturnType<typeof stubApi>) =>
  postBody(fetchMock, '/api/expenses')

beforeEach(() => {
  stubApi({ '/api/budget-month': BUDGET_MONTH, '/api/funds': FUNDS })
})

describe('Safe-to-spend hero', () => {
  it('shows the headline from the API', async () => {
    render(<SafeToSpend />)

    expect(await screen.findByText('$3,670.00')).toBeInTheDocument()
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
    expect(within(rows[0]).getByText('$387.00 · $113.00 left')).toBeInTheDocument()
    const bar = within(rows[0]).getByTestId('envelope-bar')
    expect(bar).toHaveClass('bg-accent')
    expect(bar.style.width).toBe(`${(387 / 500) * 100}%`)
  })

  it('shows the overage in red when a category is over budget', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('envelope-row')
    const overage = within(rows[2]).getByText('$546.00 of $500.00 · $46.00 over')
    expect(overage).toHaveClass('text-red')
    const bar = within(rows[2]).getByTestId('envelope-bar')
    expect(bar).toHaveClass('bg-red')
    expect(bar.style.width).toBe('100%')
  })

  it('renders an empty bar when a category has no plan yet', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('envelope-row')
    expect(within(rows[3]).getByText('$0.00 · $0.00 left')).toBeInTheDocument()
    expect(within(rows[3]).getByTestId('envelope-bar').style.width).toBe('0%')
  })
})

describe('Funds card', () => {
  it('shows the total parked in the header', async () => {
    render(<SafeToSpend />)

    expect(await screen.findByText('Money in funds')).toBeInTheDocument()
    expect(screen.getByText('$24,200.00')).toBeInTheDocument()
  })

  it('renders one row per active fund with its available balance', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('sts-fund-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('🚨 Emergency fund')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$10,000.00')).toBeInTheDocument()
    // A fund without an emoji keeps its plain name.
    expect(within(rows[2]).getByText('Travel fund')).toBeInTheDocument()
    expect(within(rows[2]).getByText('$4,200.00')).toBeInTheDocument()
  })

  it('shows the monthly plan, blank when a fund has none', async () => {
    render(<SafeToSpend />)

    const rows = await screen.findAllByTestId('sts-fund-row')
    expect(within(rows[0]).getByText('$500.00 / mo')).toBeInTheDocument()
    expect(within(rows[2]).getByText('$300.00 / mo')).toBeInTheDocument()
    // The Bike fund has no monthly plan — no "/ mo" label at all.
    expect(within(rows[1]).queryByText(/\/ mo/)).not.toBeInTheDocument()
  })
})

describe('Add a spending item', () => {
  it('offers the envelopes and funds as grouped paid-from sources', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('spending-form')
    const select = within(form).getByLabelText('Paid from')
    const envelopes = within(select).getByRole('group', {
      name: 'Budget envelopes',
    })
    expect(
      within(envelopes)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['🛒 Groceries', '🛢️ Gas', '🤪 Entertainment', '✈️ Travel'])
    const funds = within(select).getByRole('group', { name: 'Funds' })
    // A fund without an emoji keeps its plain name.
    expect(
      within(funds)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['🚨 Emergency fund', '🚲 Bike fund', 'Travel fund'])
    // The old catch-all is gone — picking an envelope IS discretionary.
    expect(
      within(form).queryByRole('option', {
        name: 'June budget · discretionary',
      }),
    ).not.toBeInTheDocument()
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
    fireEvent.change(within(form).getByLabelText('Paid from'), {
      target: { value: 'cat:2' },
    })
    routes['/api/budget-month'] = {
      ...BUDGET_MONTH,
      total_spent: 1_575,
      safe_to_spend: 3_625,
    }
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    expect(await screen.findByText('$3,625.00')).toBeInTheDocument()
    expect(expenseBody(fetchMock)).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-06',
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

    fireEvent.change(within(form).getByLabelText('Paid from'), {
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

    // No category_id: the fund itself says what the spend was for, and
    // the envelope math never counts fund-funded lines anyway.
    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock)).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-06',
      amount: 1200,
      funded_from: 'fund',
      fund_id: 2,
    })
  })

  it('refreshes the funds card after a spend draws a fund down', async () => {
    const routes: Record<string, unknown> = {
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 101 },
    }
    stubApi(routes)
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.change(within(form).getByLabelText('Paid from'), {
      target: { value: 'fund:1' },
    })
    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '1,200' },
    })
    // The server appends the drawdown, so the refetched list must land on
    // the funds card — a stale $10,000.00 would misstate what's spendable.
    routes['/api/funds'] = FUNDS.map((fund) =>
      fund.id === 1 ? { ...fund, balance: 8_800 } : fund,
    )
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    expect(await screen.findByText('$8,800.00')).toBeInTheDocument()
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

  it('posts the note alongside the expense', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 102 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '180' },
    })
    fireEvent.change(within(form).getByLabelText('Note'), {
      target: { value: 'Anniversary dinner' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock)).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-06',
      category_id: 1,
      amount: 180,
      funded_from: 'discretionary',
      note: 'Anniversary dinner',
    })
    expect(within(form).getByLabelText('Note')).toHaveValue('')
  })

  it('omits a whitespace-only note from the payload', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 103 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '45' },
    })
    fireEvent.change(within(form).getByLabelText('Note'), {
      target: { value: '   ' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock)).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-06',
      category_id: 1,
      amount: 45,
      funded_from: 'discretionary',
    })
  })

  it('posts pending when the checkbox is ticked, then resets it', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 104 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '62' },
    })
    fireEvent.click(within(form).getByLabelText('Pending'))
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock)).toMatchObject({ pending: true })
    expect(within(form).getByLabelText('Pending')).not.toBeChecked()
  })

  it('omits pending when the checkbox is left unticked', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 105 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('spending-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '62' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock)).not.toHaveProperty('pending')
  })
})

describe('Add an income item', () => {
  it('titles the form as income, freeing funding for fund entries', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('income-form')
    expect(within(form).getByText('Add an income item')).toBeInTheDocument()
  })

  it('offers the viewed month and the next two as the funds month', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('income-form')
    const select = within(form).getByLabelText('Funds month')
    const options = within(select).getAllByRole('option')
    expect(
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent,
      })),
    ).toEqual([
      { value: '2026-06', label: 'Jun 2026' },
      { value: '2026-07', label: 'Jul 2026' },
      { value: '2026-08', label: 'Aug 2026' },
    ])
  })

  it('posts the income tagged to the selected month and refreshes the hero', async () => {
    const routes: Record<string, unknown> = {
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 5 },
    }
    const fetchMock = stubApi(routes)
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '2,400' },
    })
    fireEvent.change(within(form).getByLabelText('Funds month'), {
      target: { value: '2026-07' },
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
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    expect(await screen.findByText('$6,070.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/income')).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-07',
      source: 'paycheck',
      amount: 2400,
      source_label: 'You paycheck',
    })
    expect(within(form).getByLabelText('Amount')).toHaveValue('')
  })

  it('prefills the source title from the selected option', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('income-form')
    expect(within(form).getByLabelText('Source title')).toHaveValue(
      'Spouse paycheck',
    )

    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'eth-harvest' },
    })

    expect(within(form).getByLabelText('Source title')).toHaveValue(
      'ETH harvest',
    )
  })

  it('posts an edited source title and a note', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 6 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '350' },
    })
    fireEvent.change(within(form).getByLabelText('Source title'), {
      target: { value: 'Freelance invoice' },
    })
    fireEvent.change(within(form).getByLabelText('Note'), {
      target: { value: 'June retainer' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/income')).toBeDefined(),
    )
    expect(postBody(fetchMock, '/api/income')).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-06',
      source: 'paycheck',
      amount: 350,
      source_label: 'Freelance invoice',
      note: 'June retainer',
    })
    expect(within(form).getByLabelText('Note')).toHaveValue('')
  })

  it('omits a blank source title and note from the payload', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 7 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '100' },
    })
    fireEvent.change(within(form).getByLabelText('Source title'), {
      target: { value: '   ' },
    })
    fireEvent.change(within(form).getByLabelText('Note'), {
      target: { value: '  ' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/income')).toBeDefined(),
    )
    expect(postBody(fetchMock, '/api/income')).toEqual({
      txn_date: todayIso(),
      budget_month: '2026-06',
      source: 'paycheck',
      amount: 100,
    })
  })

  it('posts pending when the checkbox is ticked, then resets it', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 6 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '120' },
    })
    fireEvent.click(within(form).getByLabelText('Pending'))
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() => expect(postBody(fetchMock, '/api/income')).toBeDefined())
    expect(postBody(fetchMock, '/api/income')).toMatchObject({ pending: true })
    expect(within(form).getByLabelText('Pending')).not.toBeChecked()
  })

  it('omits pending when the checkbox is left unticked', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 7 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '120' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() => expect(postBody(fetchMock, '/api/income')).toBeDefined())
    expect(postBody(fetchMock, '/api/income')).not.toHaveProperty('pending')
  })

  it('reveals the Draw-from funds only for a transfer-in source', async () => {
    render(<SafeToSpend />)

    // Paychecks, dividends, staking and interest never come out of a
    // fund, so the default form keeps its shape.
    const form = await screen.findByTestId('income-form')
    expect(within(form).queryByLabelText('Draw from')).not.toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'brokerage-withdrawal' },
    })

    const select = within(form).getByLabelText('Draw from')
    const options = within(select).getAllByRole('option')
    expect(
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: option.textContent,
      })),
    ).toEqual([
      { value: '', label: 'Not from a fund' },
      { value: '1', label: '🚨 Emergency fund' },
      { value: '2', label: '🚲 Bike fund' },
      { value: '3', label: 'Travel fund' },
    ])
  })

  it('posts the drawn fund and shows the hint when one is picked', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 8 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '5,200' },
    })
    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'brokerage-withdrawal' },
    })
    fireEvent.change(within(form).getByLabelText('Draw from'), {
      target: { value: '3' },
    })
    expect(
      within(form).getByText(
        '↳ Lowers Travel fund by this amount as the month is funded — no separate balance correction needed.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() => expect(postBody(fetchMock, '/api/income')).toBeDefined())
    expect(postBody(fetchMock, '/api/income')).toMatchObject({
      source: 'transfer_in',
      drawn_from_fund_id: 3,
    })
  })

  it('resets and omits the draw when the source leaves transfer-in', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 9 },
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'brokerage-withdrawal' },
    })
    fireEvent.change(within(form).getByLabelText('Draw from'), {
      target: { value: '3' },
    })
    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'spouse-paycheck' },
    })
    expect(within(form).queryByLabelText('Draw from')).not.toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '120' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() => expect(postBody(fetchMock, '/api/income')).toBeDefined())
    expect(postBody(fetchMock, '/api/income')).not.toHaveProperty(
      'drawn_from_fund_id',
    )
  })

  it('maps every source option onto the API source values', async () => {
    render(<SafeToSpend />)

    const form = await screen.findByTestId('income-form')
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
    // The note must describe the real model — leftover is assigned to
    // funds, or explicitly rolled into funding via an income row — not
    // the automatic roll-forward the system doesn't have.
    render(<SafeToSpend />)

    const form = await screen.findByTestId('income-form')
    expect(within(form).getByText('Rollover')).toBeInTheDocument()
    expect(
      within(form).getByText(/doesn't move on its own/),
    ).toBeInTheDocument()
    expect(
      within(form).getByText(/assign last month's leftover to a fund/),
    ).toBeInTheDocument()
  })

  it('does not post when the amount is empty', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    const form = await screen.findByTestId('income-form')

    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    expect(postBody(fetchMock, '/api/income')).toBeUndefined()
  })
})

describe('Month pager', () => {
  it('steps the whole view back a month', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    await screen.findByText('June envelopes')

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    // The selected month drives everything: the hero, the envelopes card,
    // and the pager's own label.
    expect(await screen.findByText('May envelopes')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByTestId('month-pager-label')).toHaveTextContent(
      'May 2026',
    )
    expect(
      fetchMock.mock.calls.some(
        ([input]) => input === '/api/budget-month?month=2026-05',
      ),
    ).toBe(true)
  })

  it('steps the whole view forward a month', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-07': {
        ...BUDGET_MONTH,
        month: '2026-07',
        safe_to_spend: 5_800,
      },
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    await screen.findByText('June envelopes')

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))

    expect(await screen.findByText('July envelopes')).toBeInTheDocument()
    expect(screen.getByText('$5,800.00')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([input]) => input === '/api/budget-month?month=2026-07',
      ),
    ).toBe(true)
  })

  it('clears the envelope filter when paging', async () => {
    stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    const rows = await screen.findAllByTestId('envelope-row')
    fireEvent.click(rows[0])
    expect(
      await screen.findByTestId('activity-filter-chip'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    // An old month may not carry the filtered envelope at all, so paging
    // starts the month unfiltered.
    await screen.findByText('May envelopes')
    expect(
      screen.queryByTestId('activity-filter-chip'),
    ).not.toBeInTheDocument()
  })
})

describe('Single-month Activity card', () => {
  it('offers no month paging of its own — the view pager owns it', async () => {
    stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    const feed = await screen.findByTestId('sts-activity')

    // One navigation model for the month concept: no feed buttons.
    expect(
      within(feed).queryByRole('button', { name: /2026/ }),
    ).not.toBeInTheDocument()

    // After paging, only the viewed month's section renders.
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByText('May envelopes')
    expect(within(feed).getByText('May 2026')).toBeInTheDocument()
    expect(within(feed).queryByText('June 2026')).not.toBeInTheDocument()
  })
})

describe('Spending posts to the viewed month', () => {
  it('tags a spending post to the month on screen', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/expenses': { id: 99 },
    })
    render(<SafeToSpend />)
    await screen.findByText('June envelopes')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByText('May envelopes')

    const form = screen.getByTestId('spending-form')
    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '12' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add spending row' }),
    )

    await waitFor(() => expect(expenseBody(fetchMock)).toBeDefined())
    expect(expenseBody(fetchMock).budget_month).toBe('2026-05')
  })

  it('hints the posting month only while paged off the current month', async () => {
    stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    await screen.findByText('June envelopes')
    // On the month the view opened to, the form needs no reminder.
    expect(screen.queryByText('Posts to June 2026')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    await screen.findByText('May envelopes')
    expect(screen.getByText('Posts to May 2026')).toBeInTheDocument()
  })
})

describe('Income months derived from the viewed month', () => {
  it('offers the viewed month and the next two after paging', async () => {
    stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    await screen.findByText('June envelopes')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByText('May envelopes')

    const form = screen.getByTestId('income-form')
    const select = within(form).getByLabelText('Funds month')
    const options = within(select).getAllByRole('option')
    expect(
      options.map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['2026-05', '2026-06', '2026-07'])
    // The default is the month on screen — the prepay window slides with
    // the pager.
    expect(select).toHaveValue('2026-05')
  })

  it('tags an income post to the viewed month by default', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
      '/api/income': { id: 7 },
    })
    render(<SafeToSpend />)
    await screen.findByText('June envelopes')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByText('May envelopes')

    const form = screen.getByTestId('income-form')
    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '500' },
    })
    fireEvent.click(
      within(form).getByRole('button', { name: '+ Add income row' }),
    )

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/income')).toBeDefined(),
    )
    expect(postBody(fetchMock, '/api/income').budget_month).toBe('2026-05')
  })
})

describe('Leftover line retirement', () => {
  it('renders no leftover line and never asks for the previous month', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/budget-month?month=2026-05': MAY_BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)

    await screen.findByText('$3,670.00')
    // Month paging supersedes the line: last month's closing number is one
    // tap back, in the hero itself.
    expect(
      fetchMock.mock.calls.some(
        ([input]) => input === '/api/budget-month?month=2026-05',
      ),
    ).toBe(false)
    await waitFor(() =>
      expect(screen.queryByTestId('leftover-line')).not.toBeInTheDocument(),
    )
  })
})

describe('Activity feed', () => {
  it('renders every item of the month in its own column', async () => {
    render(<SafeToSpend />)

    const view = await screen.findByTestId('view-safe-to-spend')
    const feed = screen.getByTestId('sts-activity')
    // A column of its own: a direct grid child, not stacked under the forms.
    expect(feed.parentElement).toBe(view)
    expect(within(feed).queryByTestId('income-form')).not.toBeInTheDocument()
    expect(within(feed).getByText('Activity')).toBeInTheDocument()
    // Uncapped: all four fixture items, the fund entry among them.
    expect(within(feed).getAllByTestId('activity-row')).toHaveLength(4)
    expect(within(feed).getByText('Funding · Jun 1')).toBeInTheDocument()
    expect(within(feed).getByText('June 2026')).toBeInTheDocument()
  })

})

describe('Responsive layout', () => {
  it('stacks into one column, widening to two and then three', async () => {
    render(<SafeToSpend />)
    await screen.findByText('$3,670.00')

    expect(screen.getByTestId('view-safe-to-spend')).toHaveClass(
      'grid-cols-1',
      'md:grid-cols-2',
      '3col:grid-cols-3',
    )
    expect(screen.getByTestId('month-pager')).toHaveClass(
      'md:col-span-2',
      '3col:col-span-3',
    )
  })

  it('gives the hero its own full-width row under the month pager', async () => {
    render(<SafeToSpend />)
    const view = await screen.findByTestId('view-safe-to-spend')

    const hero = screen.getByTestId('sts-hero')
    // A row of its own, directly under the pager — not the first card of
    // the envelopes column.
    expect(hero.parentElement).toBe(view)
    expect(screen.getByTestId('month-pager').nextElementSibling).toBe(hero)
    expect(hero).toHaveClass('md:col-span-2', '3col:col-span-3')
  })

  it('stacks the form field grids into one column on narrow screens', async () => {
    render(<SafeToSpend />)

    const spending = await screen.findByTestId('spending-form')
    expect(
      within(spending).getByLabelText('Amount').closest('.grid'),
    ).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
    const income = screen.getByTestId('income-form')
    expect(
      within(income).getByLabelText('Amount').closest('.grid'),
    ).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })

  it('scales the hero figure down on narrow screens', async () => {
    render(<SafeToSpend />)

    expect(await screen.findByText('$3,670.00')).toHaveClass(
      'text-4xl',
      'sm:text-[56px]',
    )
  })
})

describe('Activity item editing', () => {
  // The fixture feed: [expense id 5, expense id 3, fund id 9, income id 2].
  const feedRows = async () => {
    const feed = await screen.findByTestId('sts-activity')
    return within(feed).getAllByTestId('activity-row')
  }

  it('tapping an expense row opens a form pre-filled from the row', async () => {
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])

    const form = await screen.findByTestId('expense-edit-form')
    expect(within(form).getByLabelText('Amount')).toHaveValue('28.4')
    expect(within(form).getByLabelText('Paid from')).toHaveValue('cat:3')
    expect(within(form).getByLabelText('Budget month')).toHaveValue('2026-06')
    expect(within(form).getByLabelText('Date')).toHaveValue('2026-06-26')
    expect(within(form).getByLabelText('Note')).toHaveValue(
      'Poke — treat yourself',
    )
  })

  it('saving an edited expense PUTs the full body and refetches', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      'PUT /api/expenses/5': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])
    const form = await screen.findByTestId('expense-edit-form')
    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '42.75' },
    })
    const budgetCalls = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/budget-month'),
      ).length
    const fundsCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/funds')
        .length
    const budgetBefore = budgetCalls()
    const fundsBefore = fundsCalls()
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    )
    const [url, init] = fetchMock.mock.calls.find(
      ([, callInit]) => callInit?.method === 'PUT',
    )!
    expect(url).toBe('/api/expenses/5')
    expect(JSON.parse(init?.body as string)).toEqual({
      txn_date: '2026-06-26',
      budget_month: '2026-06',
      category_id: 3,
      amount: 42.75,
      funded_from: 'discretionary',
      note: 'Poke — treat yourself',
    })
    // The hero, envelopes, funds card, and feed all refetch after a save.
    await waitFor(() => expect(budgetCalls()).toBeGreaterThan(budgetBefore))
    expect(fundsCalls()).toBeGreaterThan(fundsBefore)
    await waitFor(() =>
      expect(
        screen.queryByTestId('expense-edit-form'),
      ).not.toBeInTheDocument(),
    )
  })

  it('prefills a pending row checked and clears the flag on save', async () => {
    // Unticking Pending and saving PUTs a body without the key — the
    // server's full replace defaults it false, and the row drops its ⚠️.
    const pendingFeed = {
      ...BUDGET_MONTH,
      activity: BUDGET_MONTH.activity.map((item) =>
        item.id === 5 ? { ...item, pending: true } : item,
      ),
    }
    const fetchMock = stubApi({
      '/api/budget-month': pendingFeed,
      '/api/funds': FUNDS,
      'PUT /api/expenses/5': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])
    const form = await screen.findByTestId('expense-edit-form')
    expect(within(form).getByLabelText('Pending')).toBeChecked()
    fireEvent.click(within(form).getByLabelText('Pending'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, callInit]) => callInit?.method === 'PUT',
    )!
    expect(JSON.parse(init?.body as string)).not.toHaveProperty('pending')
  })

  it('saves a newly ticked pending flag', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      'PUT /api/expenses/5': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])
    const form = await screen.findByTestId('expense-edit-form')
    expect(within(form).getByLabelText('Pending')).not.toBeChecked()
    fireEvent.click(within(form).getByLabelText('Pending'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, callInit]) => callInit?.method === 'PUT',
    )!
    expect(JSON.parse(init?.body as string)).toMatchObject({ pending: true })
  })

  it('cancel closes the form without a request', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])
    const form = await screen.findByTestId('expense-edit-form')
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('expense-edit-form')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(
      false,
    )
  })

  it('fund rows offer no edit affordance', async () => {
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[2])

    expect(screen.queryByTestId('expense-edit-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('income-edit-form')).not.toBeInTheDocument()
  })
})

describe('Income item editing', () => {
  const feedRows = async () => {
    const feed = await screen.findByTestId('sts-activity')
    return within(feed).getAllByTestId('activity-row')
  }

  it('tapping an income row opens a form pre-filled from the row', async () => {
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[3])

    const form = await screen.findByTestId('income-edit-form')
    expect(within(form).getByLabelText('Amount')).toHaveValue('2400')
    expect(within(form).getByLabelText('Funds month')).toHaveValue('2026-06')
    expect(within(form).getByLabelText('Source')).toHaveValue('spouse-paycheck')
    expect(within(form).getByLabelText('Source title')).toHaveValue(
      'Spouse paycheck',
    )
    expect(within(form).getByLabelText('Date')).toHaveValue('2026-05-27')
    expect(within(form).getByLabelText('Note')).toHaveValue('')
  })

  it('switching the source re-prefills the title like the create form', async () => {
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[3])

    const form = await screen.findByTestId('income-edit-form')
    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'eth-harvest' },
    })
    expect(within(form).getByLabelText('Source title')).toHaveValue(
      'ETH harvest',
    )
  })

  it('saving an edited income PUTs the full body and refetches', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      'PUT /api/income/2': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[3])
    const form = await screen.findByTestId('income-edit-form')
    fireEvent.change(within(form).getByLabelText('Amount'), {
      target: { value: '2500' },
    })
    const budgetCalls = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/budget-month'),
      ).length
    const budgetBefore = budgetCalls()
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    )
    const [url, init] = fetchMock.mock.calls.find(
      ([, callInit]) => callInit?.method === 'PUT',
    )!
    expect(url).toBe('/api/income/2')
    expect(JSON.parse(init?.body as string)).toEqual({
      txn_date: '2026-05-27',
      budget_month: '2026-06',
      source: 'paycheck',
      amount: 2500,
      source_label: 'Spouse paycheck',
    })
    await waitFor(() => expect(budgetCalls()).toBeGreaterThan(budgetBefore))
    await waitFor(() =>
      expect(screen.queryByTestId('income-edit-form')).not.toBeInTheDocument(),
    )
  })

  it('prefills a pending row checked and clears the flag on save', async () => {
    const pendingFeed = {
      ...BUDGET_MONTH,
      activity: BUDGET_MONTH.activity.map((item) =>
        item.id === 2 && item.type === 'income'
          ? { ...item, pending: true }
          : item,
      ),
    }
    const fetchMock = stubApi({
      '/api/budget-month': pendingFeed,
      '/api/funds': FUNDS,
      'PUT /api/income/2': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[3])
    const form = await screen.findByTestId('income-edit-form')
    expect(within(form).getByLabelText('Pending')).toBeChecked()
    fireEvent.click(within(form).getByLabelText('Pending'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, callInit]) => callInit?.method === 'PUT',
    )!
    expect(JSON.parse(init?.body as string)).not.toHaveProperty('pending')
  })

  it('saves a newly ticked pending flag', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      'PUT /api/income/2': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[3])
    const form = await screen.findByTestId('income-edit-form')
    expect(within(form).getByLabelText('Pending')).not.toBeChecked()
    fireEvent.click(within(form).getByLabelText('Pending'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
      ).toBe(true),
    )
    const [, init] = fetchMock.mock.calls.find(
      ([, callInit]) => callInit?.method === 'PUT',
    )!
    expect(JSON.parse(init?.body as string)).toMatchObject({ pending: true })
  })
})

describe('Item delete', () => {
  const feedRows = async () => {
    const feed = await screen.findByTestId('sts-activity')
    return within(feed).getAllByTestId('activity-row')
  }
  const deleteCalls = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')

  it('arms on the first tap and deletes the expense on the second', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      'DELETE /api/expenses/5': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])
    const form = await screen.findByTestId('expense-edit-form')
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))

    // Armed, not deleted: the destructive tap must be a deliberate pair.
    expect(deleteCalls(fetchMock)).toHaveLength(0)
    const budgetCalls = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/budget-month'),
      ).length
    const budgetBefore = budgetCalls()
    fireEvent.click(
      within(form).getByRole('button', { name: 'Tap again to delete' }),
    )

    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(1))
    expect(String(deleteCalls(fetchMock)[0][0])).toBe('/api/expenses/5')
    await waitFor(() => expect(budgetCalls()).toBeGreaterThan(budgetBefore))
    await waitFor(() =>
      expect(
        screen.queryByTestId('expense-edit-form'),
      ).not.toBeInTheDocument(),
    )
  })

  it('deletes an income row the same way', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
      'DELETE /api/income/2': {},
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[3])
    const form = await screen.findByTestId('income-edit-form')
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))
    fireEvent.click(
      within(form).getByRole('button', { name: 'Tap again to delete' }),
    )

    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(1))
    expect(String(deleteCalls(fetchMock)[0][0])).toBe('/api/income/2')
  })

  it('reopening the form disarms an armed delete', async () => {
    const fetchMock = stubApi({
      '/api/budget-month': BUDGET_MONTH,
      '/api/funds': FUNDS,
    })
    render(<SafeToSpend />)
    fireEvent.click((await feedRows())[0])
    const form = await screen.findByTestId('expense-edit-form')
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('expense-edit-form')).not.toBeInTheDocument()
    fireEvent.click((await feedRows())[0])
    const reopened = await screen.findByTestId('expense-edit-form')
    expect(
      within(reopened).getByRole('button', { name: 'Delete' }),
    ).toBeInTheDocument()
    expect(deleteCalls(fetchMock)).toHaveLength(0)
  })
})

describe('Envelope activity filter', () => {
  it('filters the feed to the tapped envelope', async () => {
    render(<SafeToSpend />)

    const feed = await screen.findByTestId('sts-activity')
    const groceries = screen.getAllByTestId('envelope-row')[0]
    fireEvent.click(groceries)

    // The tapped row reads as selected, and the feed keeps only the
    // envelope's own expenses — the Entertainment expense, the fund entry,
    // and the income row all drop out.
    expect(groceries).toHaveAttribute('aria-pressed', 'true')
    const rows = within(feed).getAllByTestId('activity-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Groceries · Jun 10')).toBeInTheDocument()
  })

  it('shows a filter-aware empty state for an envelope with no activity', async () => {
    render(<SafeToSpend />)

    const feed = await screen.findByTestId('sts-activity')
    // Travel has a row in the envelopes card but no expenses in the feed.
    fireEvent.click(screen.getAllByTestId('envelope-row')[3])

    expect(within(feed).queryAllByTestId('activity-row')).toHaveLength(0)
    expect(
      within(feed).getByText('No ✈️ Travel activity this month.'),
    ).toBeInTheDocument()
  })

  it('shows a chip in the Activity header that clears the filter', async () => {
    render(<SafeToSpend />)

    const feed = await screen.findByTestId('sts-activity')
    const groceries = screen.getAllByTestId('envelope-row')[0]
    fireEvent.click(groceries)

    const chip = within(feed).getByTestId('activity-filter-chip')
    expect(chip).toHaveTextContent('Filtering: 🛒 Groceries ✕')
    fireEvent.click(chip)

    // Cleared: the chip goes away, the full feed returns, and the
    // envelope row reads unselected again.
    expect(
      within(feed).queryByTestId('activity-filter-chip'),
    ).not.toBeInTheDocument()
    expect(within(feed).getAllByTestId('activity-row')).toHaveLength(4)
    expect(groceries).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles the filter off when the selected envelope is tapped again', async () => {
    render(<SafeToSpend />)

    const feed = await screen.findByTestId('sts-activity')
    const groceries = screen.getAllByTestId('envelope-row')[0]
    fireEvent.click(groceries)
    fireEvent.click(groceries)

    expect(groceries).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(feed).queryByTestId('activity-filter-chip'),
    ).not.toBeInTheDocument()
    expect(within(feed).getAllByTestId('activity-row')).toHaveLength(4)
  })

  it('replaces the filter when a different envelope is tapped', async () => {
    render(<SafeToSpend />)

    const feed = await screen.findByTestId('sts-activity')
    const rows = screen.getAllByTestId('envelope-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[2])

    // Entertainment replaces Groceries — one filter at a time.
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false')
    expect(rows[2]).toHaveAttribute('aria-pressed', 'true')
    const visible = within(feed).getAllByTestId('activity-row')
    expect(visible).toHaveLength(1)
    expect(
      within(visible[0]).getByText('Entertainment · Jun 26'),
    ).toBeInTheDocument()
    expect(within(feed).getByTestId('activity-filter-chip')).toHaveTextContent(
      'Filtering: 🤪 Entertainment ✕',
    )
  })
})
