import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FundLogEntry } from '../api.ts'
import { monthYearLabel, previousMonth } from '../budget.ts'
import { todayIso } from '../ledger.ts'
import { FUNDS } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Funds from './Funds.tsx'

// Funds & Goals reads the selected fund from ?fund=, so it renders under a
// router; path is where the visit starts.
const renderFunds = (path = '/funds') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/funds" element={<Funds />} />
      </Routes>
    </MemoryRouter>,
  )

const MONTH = todayIso().slice(0, 7)

// This month's fund log, newest first, as GET /api/fund-entries returns it.
const LOG: FundLogEntry[] = [
  {
    id: 11,
    fund: { id: 3, name: 'Travel fund', emoji: null, archived: false },
    as_of_date: `${MONTH}-03`,
    source: 'spend',
    delta: -32.2,
    balance: 4_167.8,
    link: { type: 'expense', id: 7, label: 'The Home Depot', kind: 'draw' },
  },
  {
    id: 10,
    fund: { id: 1, name: 'Emergency fund', emoji: '🚨', archived: false },
    as_of_date: `${MONTH}-01`,
    source: 'top_up',
    delta: 500,
    balance: 10_000,
    link: null,
  },
]

// Every test starts from the funds list and an empty fund log; a test
// that reads the log stubs its month explicitly.
const ROUTES: Record<string, unknown> = {
  '/api/funds': FUNDS,
  '/api/fund-entries': [],
}

const postBody = (fetchMock: ReturnType<typeof stubApi>, path: string) => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => input === path && init?.method === 'POST',
  )
  return call ? JSON.parse(call[1]?.body as string) : undefined
}

const putBody = (fetchMock: ReturnType<typeof stubApi>, path: string) => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => input === path && init?.method === 'PUT',
  )
  return call ? JSON.parse(call[1]?.body as string) : undefined
}

// What POST /api/funds returns for the form's inputs: a goal (the date is
// set) with no balance yet — the initial saved amount lands via
// POST /api/fund-entries.
const CREATED = {
  id: 9,
  name: 'Vacation',
  emoji: null,
  kind: 'goal',
  target_amount: 5_000,
  target_date: '2027-03-01',
  monthly_plan: 250,
  balance: 0,
  note: 'needs $438 / mo to finish by 2027-03',
}

beforeEach(() => {
  stubApi({ ...ROUTES })
})

const fillForm = async (
  fields: Partial<
    Record<'Name' | 'Emoji' | 'Target $' | 'Saved $' | 'Target date' | '$ / month', string>
  >,
) => {
  const form = await screen.findByTestId('new-fund-form')
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(within(form).getByLabelText(label), { target: { value } })
  }
  return form
}

describe('Funds & goals card', () => {
  it('shows the total parked and the auto-calculate hint', async () => {
    renderFunds()

    expect(await screen.findByText('Total parked')).toBeInTheDocument()
    expect(screen.getByText('$24,200.00')).toBeInTheDocument()
    expect(
      screen.getByText('notes auto-calculate from target, saved & date'),
    ).toBeInTheDocument()
  })

  it('renders each fund with its meta, amount, bar and derived note', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('🚨 Emergency fund')).toBeInTheDocument()
    expect(within(rows[0]).getByText('· sinking · no date')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$10,000.00 / $30,000.00')).toBeInTheDocument()
    const bar = within(rows[0]).getByTestId('fund-bar')
    expect(bar).toHaveClass('bg-sidebar')
    expect(bar.style.width).toBe(`${(10_000 / 30_000) * 100}%`)
    const note = within(rows[0]).getByText('$500 / mo · ~3.3 yrs to target')
    expect(note).toHaveClass('text-muted-2')
  })

  it('leaves the name plain when a fund has no emoji', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[2]).getByText('Travel fund')).toBeInTheDocument()
  })

  it('formats a goal meta line from its ISO target date', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[1]).getByText('· goal · Jul 2026')).toBeInTheDocument()
  })

  it('renders a completed fund in accent green', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[1]).getByTestId('fund-bar')).toHaveClass('bg-accent')
    expect(
      within(rows[1]).getByText('✓ fully funded — ready to spend'),
    ).toHaveClass('text-accent')
  })

  it('renders an open-ended fund without a target or a bar', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[2]).getByText('$4,200.00')).toBeInTheDocument()
    expect(within(rows[2]).queryByTestId('fund-bar')).not.toBeInTheDocument()
    expect(
      within(rows[2]).getByText('$300 / mo · open-ended'),
    ).toBeInTheDocument()
  })
})

describe('+ New fund or goal form', () => {
  it('explains that a blank date makes a sinking fund', async () => {
    renderFunds()

    const form = await screen.findByTestId('new-fund-form')
    expect(within(form).getByText('+ New fund or goal')).toBeInTheDocument()
    expect(within(form).getByText('· blank = sinking fund')).toBeInTheDocument()
  })

  it('creates the fund, posts the saved amount and refetches the list', async () => {
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds': CREATED,
      'POST /api/fund-entries': { id: 7 },
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const form = await fillForm({
      Name: 'Vacation',
      'Target $': '5,000',
      'Saved $': '1,500',
      'Target date': '2027-03-01',
      '$ / month': '250',
    })
    routes['/api/funds'] = [...FUNDS, { ...CREATED, balance: 1_500 }]

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    expect(await screen.findByText('$1,500.00 / $5,000.00')).toBeInTheDocument()
    expect(screen.getAllByTestId('fund-row')).toHaveLength(4)
    expect(postBody(fetchMock, '/api/funds')).toEqual({
      name: 'Vacation',
      target_amount: 5000,
      target_date: '2027-03-01',
      monthly_plan: 250,
    })
    expect(postBody(fetchMock, '/api/fund-entries')).toEqual({
      fund_id: 9,
      as_of_date: todayIso(),
      balance: 1500,
    })
    expect(within(form).getByLabelText('Name')).toHaveValue('')
  })

  it('posts the chosen emoji with the new fund', async () => {
    const fetchMock = stubApi({
      ...ROUTES,
      'POST /api/funds': { ...CREATED, kind: 'sinking', emoji: '✈️' },
    })
    renderFunds()
    const form = await fillForm({ Name: 'Vacation', Emoji: '✈️' })

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/funds')).toEqual({
        name: 'Vacation',
        emoji: '✈️',
      }),
    )
    expect(within(form).getByLabelText('Emoji')).toHaveValue('')
  })

  it('omits a blank target and date so the fund is open-ended', async () => {
    const fetchMock = stubApi({
      ...ROUTES,
      'POST /api/funds': { ...CREATED, kind: 'sinking' },
    })
    renderFunds()
    const form = await fillForm({ Name: 'Travel', '$ / month': '300' })

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/funds')).toEqual({
        name: 'Travel',
        monthly_plan: 300,
      }),
    )
  })

  it('skips the fund entry when nothing is saved yet', async () => {
    const fetchMock = stubApi({
      ...ROUTES,
      'POST /api/funds': { ...CREATED, kind: 'sinking' },
    })
    renderFunds()
    const form = await fillForm({ Name: 'Travel' })

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/funds')).toBeDefined(),
    )
    expect(postBody(fetchMock, '/api/fund-entries')).toBeUndefined()
  })

  it('does not post without a name', async () => {
    const fetchMock = stubApi({ ...ROUTES })
    renderFunds()
    const form = await fillForm({ 'Target $': '5,000' })

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    expect(postBody(fetchMock, '/api/funds')).toBeUndefined()
  })
})

describe('archiving a fund', () => {
  it('shows an Archive button on each fund card', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    for (const row of rows) {
      expect(
        within(row).getByRole('button', { name: 'Archive' }),
      ).toBeInTheDocument()
    }
  })

  it('posts the archive and refetches the list', async () => {
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds/1/archive': { ...FUNDS[0], balance: 0 },
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    routes['/api/funds'] = FUNDS.slice(1)

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Archive' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('fund-row')).toHaveLength(2),
    )
    expect(screen.queryByText('🚨 Emergency fund')).not.toBeInTheDocument()
    expect(screen.getByText('$14,200.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/archive')).toEqual({})
  })
})

describe('editing a fund plan', () => {
  it('shows an Edit button on each fund card', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    for (const row of rows) {
      expect(
        within(row).getByRole('button', { name: 'Edit' }),
      ).toBeInTheDocument()
    }
  })

  it('reveals the $ / month input prefilled with the current plan', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[0]).getByLabelText('$ / month')).toHaveValue('500')
  })

  it('prefills a blank input for a fund with no plan', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[1]).getByLabelText('$ / month')).toHaveValue('')
  })

  it('saves the revised plan and refetches the list', async () => {
    const revised = {
      ...FUNDS[0],
      monthly_plan: 1_000,
      note: '$1,000 / mo · ~1.7 yrs to target',
    }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'PUT /api/funds/1': revised,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ / month'), {
      target: { value: '1,000' },
    })
    routes['/api/funds'] = [revised, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('$1,000 / mo · ~1.7 yrs to target'),
    ).toBeInTheDocument()
    expect(putBody(fetchMock, '/api/funds/1')).toEqual({
      name: 'Emergency fund',
      emoji: '🚨',
      monthly_plan: 1000,
    })
    expect(
      within(rows[0]).queryByLabelText('$ / month'),
    ).not.toBeInTheDocument()
  })

  it('pauses the plan when the input is blank', async () => {
    const paused = {
      ...FUNDS[2],
      monthly_plan: null,
      note: 'open-ended · add a monthly plan',
    }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'PUT /api/funds/3': paused,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[2]).getByLabelText('$ / month'), {
      target: { value: '' },
    })
    routes['/api/funds'] = [...FUNDS.slice(0, 2), paused]

    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('open-ended · add a monthly plan'),
    ).toBeInTheDocument()
    expect(putBody(fetchMock, '/api/funds/3')).toEqual({
      name: 'Travel fund',
      emoji: null,
      monthly_plan: null,
    })
  })

  it('cancels without saving', async () => {
    const fetchMock = stubApi({ ...ROUTES })
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ / month'), {
      target: { value: '1,000' },
    })

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Cancel' }))

    expect(
      within(rows[0]).queryByLabelText('$ / month'),
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT'),
    ).toHaveLength(0)
  })
})

describe('editing a fund name and emoji', () => {
  it('reveals the name and emoji inputs prefilled with the current values', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[0]).getByLabelText('Name')).toHaveValue('Emergency fund')
    expect(within(rows[0]).getByLabelText('Emoji')).toHaveValue('🚨')
  })

  it('prefills a blank emoji for a fund with none', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[2]).getByLabelText('Name')).toHaveValue('Travel fund')
    expect(within(rows[2]).getByLabelText('Emoji')).toHaveValue('')
  })

  it('saves the renamed fund and refetches the list', async () => {
    const renamed = { ...FUNDS[2], name: 'Japan fund', emoji: '✈️' }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'PUT /api/funds/3': renamed,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[2]).getByLabelText('Name'), {
      target: { value: 'Japan fund' },
    })
    fireEvent.change(within(rows[2]).getByLabelText('Emoji'), {
      target: { value: '✈️' },
    })
    routes['/api/funds'] = [...FUNDS.slice(0, 2), renamed]

    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Japan fund/)).toBeInTheDocument()
    expect(putBody(fetchMock, '/api/funds/3')).toEqual({
      name: 'Japan fund',
      emoji: '✈️',
      monthly_plan: 300,
    })
  })

  it('clears the emoji when the blank option is picked', async () => {
    const cleared = { ...FUNDS[0], emoji: null }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'PUT /api/funds/1': cleared,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('Emoji'), {
      target: { value: '' },
    })
    routes['/api/funds'] = [cleared, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/funds/1')).toEqual({
        name: 'Emergency fund',
        emoji: null,
        monthly_plan: 500,
      }),
    )
  })
})

describe('topping up a fund', () => {
  it('shows a Top up button on each fund card', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    for (const row of rows) {
      expect(
        within(row).getByRole('button', { name: 'Top up' }),
      ).toBeInTheDocument()
    }
  })

  it('reveals a blank $ amount input with the release hint', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    const input = within(rows[0]).getByLabelText('$ amount')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'negative releases')
  })

  it('closes an open plan editor when the top-up form opens', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    expect(
      within(rows[0]).queryByLabelText('$ / month'),
    ).not.toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('$ amount')).toBeInTheDocument()
  })

  it('posts the amount and refetches the list', async () => {
    const toppedUp = { ...FUNDS[0], balance: 10_250 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds/1/top-up': toppedUp,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '250' },
    })
    routes['/api/funds'] = [toppedUp, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$10,250.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({ amount: 250 })
    expect(
      within(rows[0]).queryByLabelText('$ amount'),
    ).not.toBeInTheDocument()
  })

  it('posts a negative amount as a release', async () => {
    const released = { ...FUNDS[0], balance: 9_500 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds/1/top-up': released,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '-500' },
    })
    routes['/api/funds'] = [released, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$9,500.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({ amount: -500 })
  })

  it('offers a source choice defaulting to the regular top-up', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    const source = within(rows[0]).getByLabelText('Source')
    expect(source).toHaveValue('top_up')
    expect(
      within(source).getByRole('option', {
        name: 'Regular top-up (counts against this month)',
      }),
    ).toBeInTheDocument()
    expect(
      within(source).getByRole('option', {
        name: "From last month's leftover",
      }),
    ).toBeInTheDocument()
  })

  it('offers an As-of date defaulting to today', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    expect(within(rows[0]).getByLabelText('As of')).toHaveValue(todayIso())
  })

  it('posts a changed As-of date so the move lands in its own month', async () => {
    // The existing payload tests lock the mirror case with toEqual: an
    // untouched date stays out of the body, so the server keeps stamping
    // today.
    const toppedUp = { ...FUNDS[0], balance: 10_250 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds/1/top-up': toppedUp,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '250' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('As of'), {
      target: { value: '2026-07-02' },
    })
    routes['/api/funds'] = [toppedUp, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$10,250.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({
      amount: 250,
      as_of_date: '2026-07-02',
    })
  })

  it('posts the rollover source when the leftover option is picked', async () => {
    const toppedUp = { ...FUNDS[0], balance: 10_400 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds/1/top-up': toppedUp,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '400' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('Source'), {
      target: { value: 'rollover' },
    })
    routes['/api/funds'] = [toppedUp, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$10,400.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({
      amount: 400,
      source: 'rollover',
    })
  })

  it('posts a negative rollover to un-assign leftover', async () => {
    const released = { ...FUNDS[0], balance: 9_800 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/funds/1/top-up': released,
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '-200' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('Source'), {
      target: { value: 'rollover' },
    })
    routes['/api/funds'] = [released, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$9,800.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({
      amount: -200,
      source: 'rollover',
    })
  })

  it('does not post a blank amount', async () => {
    const fetchMock = stubApi({ ...ROUTES })
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(postBody(fetchMock, '/api/funds/1/top-up')).toBeUndefined()
  })

  it('cancels without posting', async () => {
    const fetchMock = stubApi({ ...ROUTES })
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '250' },
    })

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Cancel' }))

    expect(
      within(rows[0]).queryByLabelText('$ amount'),
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(0)
  })
})

describe('correcting a fund balance', () => {
  // The restatement is the headline-neutral lever: a hand-entered fund
  // entry (NULL source) moves the tracker while safe-to-spend never
  // hears about it — reconciling against the real account, and the
  // neutral half of income-row + drawdown month-funding.
  it('opens prefilled with the current balance', async () => {
    renderFunds()

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Correct balance' }),
    )

    expect(within(rows[0]).getByLabelText('New balance')).toHaveValue('10000')
  })

  it('posts a restatement dated today and refetches', async () => {
    const corrected = { ...FUNDS[0], balance: 9_500 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/fund-entries': { id: 99 },
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Correct balance' }),
    )
    fireEvent.change(within(rows[0]).getByLabelText('New balance'), {
      target: { value: '9500' },
    })
    routes['/api/funds'] = [corrected, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$9,500.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/fund-entries')).toEqual({
      fund_id: 1,
      as_of_date: todayIso(),
      balance: 9500,
    })
    expect(
      within(rows[0]).queryByLabelText('New balance'),
    ).not.toBeInTheDocument()
  })

  it('posts a zero balance — blank and 0 are different corrections', async () => {
    const corrected = { ...FUNDS[0], balance: 0 }
    const routes: Record<string, unknown> = {
      ...ROUTES,
      'POST /api/fund-entries': { id: 99 },
    }
    const fetchMock = stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Correct balance' }),
    )
    fireEvent.change(within(rows[0]).getByLabelText('New balance'), {
      target: { value: '0' },
    })
    routes['/api/funds'] = [corrected, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$0.00 / $30,000.00')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/fund-entries')).toEqual({
      fund_id: 1,
      as_of_date: todayIso(),
      balance: 0,
    })
  })

  it('does not post an unchanged balance', async () => {
    const fetchMock = stubApi({ ...ROUTES })
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Correct balance' }),
    )

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(postBody(fetchMock, '/api/fund-entries')).toBeUndefined()
  })

  it('does not post a blank balance', async () => {
    const fetchMock = stubApi({ ...ROUTES })
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Correct balance' }),
    )
    fireEvent.change(within(rows[0]).getByLabelText('New balance'), {
      target: { value: '' },
    })

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(postBody(fetchMock, '/api/fund-entries')).toBeUndefined()
  })

  it('closes an open top-up form when it opens', async () => {
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    fireEvent.click(
      within(rows[0]).getByRole('button', { name: 'Correct balance' }),
    )

    expect(
      within(rows[0]).queryByLabelText('$ amount'),
    ).not.toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('New balance')).toBeInTheDocument()
  })
})

describe('responsive layout', () => {
  it('stacks the new-fund form grids into one column on narrow screens', async () => {
    renderFunds()

    const form = await screen.findByTestId('new-fund-form')
    expect(within(form).getByLabelText('Name').closest('.grid')).toHaveClass(
      'grid-cols-1',
      'sm:grid-cols-[2fr_1fr_1fr_1fr]',
    )
    expect(
      within(form).getByLabelText('$ / month').closest('.grid'),
    ).toHaveClass('grid-cols-1', 'sm:grid-cols-[1.4fr_1fr_auto]')
  })
})

describe('fund log', () => {
  const logRows = async () => {
    const log = await screen.findByTestId('fund-log')
    await within(log).findAllByTestId('fund-log-row')
    return within(log).getAllByTestId('fund-log-row')
  }

  it("shows this month's entries beside the funds", async () => {
    stubApi({ ...ROUTES, [`/api/fund-entries?month=${MONTH}`]: LOG })
    renderFunds()

    const log = await screen.findByTestId('fund-log')
    expect(within(log).getByText('Fund log')).toBeInTheDocument()
    expect(within(log).getByTestId('fund-log-month')).toHaveTextContent(
      monthYearLabel(MONTH),
    )
    const rows = await logRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('The Home Depot')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Travel fund')).toBeInTheDocument()
    expect(within(rows[0]).getByText('−$32.20')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$4,167.80')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Top-up')).toBeInTheDocument()
    expect(within(rows[1]).getByText('+$500.00')).toBeInTheDocument()
  })

  it('pages back and forward a month at a time', async () => {
    const earlier = previousMonth(MONTH)
    const fetchMock = stubApi({
      ...ROUTES,
      [`/api/fund-entries?month=${MONTH}`]: LOG,
      [`/api/fund-entries?month=${earlier}`]: [
        { ...LOG[1], id: 9, as_of_date: `${earlier}-15`, source: 'rollover' },
      ],
    })
    renderFunds()
    const log = await screen.findByTestId('fund-log')
    await logRows()

    fireEvent.click(within(log).getByRole('button', { name: 'Previous month' }))

    await waitFor(() =>
      expect(within(log).getByTestId('fund-log-month')).toHaveTextContent(
        monthYearLabel(earlier),
      ),
    )
    expect(await within(log).findByText('Rollover')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/fund-entries?month=${earlier}`,
    )

    fireEvent.click(within(log).getByRole('button', { name: 'Next month' }))

    expect(await within(log).findByText('The Home Depot')).toBeInTheDocument()
  })

  it('says so when a month has no fund activity', async () => {
    renderFunds()

    const log = await screen.findByTestId('fund-log')
    expect(
      await within(log).findByText(
        `No fund activity in ${monthYearLabel(MONTH)}.`,
      ),
    ).toBeInTheDocument()
  })

  it('refetches the log after a fund changes', async () => {
    const routes: Record<string, unknown> = {
      ...ROUTES,
      [`/api/fund-entries?month=${MONTH}`]: [],
      'POST /api/funds/1/top-up': FUNDS[0],
    }
    stubApi(routes)
    renderFunds()
    const rows = await screen.findAllByTestId('fund-row')
    await screen.findByText(`No fund activity in ${monthYearLabel(MONTH)}.`)
    routes[`/api/fund-entries?month=${MONTH}`] = [LOG[1]]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '500' },
    })
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await logRows()).toHaveLength(1)
  })

  it('sits in a third column beside the funds from lg up', async () => {
    renderFunds()

    const view = await screen.findByTestId('view-funds')
    expect(view).toHaveClass('grid-cols-1', 'lg:grid-cols-3')
    expect(screen.getByTestId('funds-column')).toHaveClass('lg:col-span-2')
  })
})
