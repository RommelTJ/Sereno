import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayIso } from '../ledger.ts'
import { FUNDS } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Funds from './Funds.tsx'

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
  stubApi({ '/api/funds': FUNDS })
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
    expect(within(rows[0]).getByText('🚨 Emergency fund')).toBeInTheDocument()
    expect(within(rows[0]).getByText('· sinking · no date')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$10,000 / $30,000')).toBeInTheDocument()
    const bar = within(rows[0]).getByTestId('fund-bar')
    expect(bar).toHaveClass('bg-sidebar')
    expect(bar.style.width).toBe(`${(10_000 / 30_000) * 100}%`)
    const note = within(rows[0]).getByText('$500 / mo · ~3.3 yrs to target')
    expect(note).toHaveClass('text-muted-2')
  })

  it('leaves the name plain when a fund has no emoji', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    expect(within(rows[2]).getByText('Travel fund')).toBeInTheDocument()
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

describe('+ New fund or goal form', () => {
  it('explains that a blank date makes a sinking fund', async () => {
    render(<Funds />)

    const form = await screen.findByTestId('new-fund-form')
    expect(within(form).getByText('+ New fund or goal')).toBeInTheDocument()
    expect(within(form).getByText('· blank = sinking fund')).toBeInTheDocument()
  })

  it('creates the fund, posts the saved amount and refetches the list', async () => {
    const routes: Record<string, unknown> = {
      '/api/funds': FUNDS,
      'POST /api/funds': CREATED,
      'POST /api/fund-entries': { id: 7 },
    }
    const fetchMock = stubApi(routes)
    render(<Funds />)
    const form = await fillForm({
      Name: 'Vacation',
      'Target $': '5,000',
      'Saved $': '1,500',
      'Target date': '2027-03-01',
      '$ / month': '250',
    })
    routes['/api/funds'] = [...FUNDS, { ...CREATED, balance: 1_500 }]

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    expect(await screen.findByText('$1,500 / $5,000')).toBeInTheDocument()
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
      '/api/funds': FUNDS,
      'POST /api/funds': { ...CREATED, kind: 'sinking', emoji: '✈️' },
    })
    render(<Funds />)
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
      '/api/funds': FUNDS,
      'POST /api/funds': { ...CREATED, kind: 'sinking' },
    })
    render(<Funds />)
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
      '/api/funds': FUNDS,
      'POST /api/funds': { ...CREATED, kind: 'sinking' },
    })
    render(<Funds />)
    const form = await fillForm({ Name: 'Travel' })

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/funds')).toBeDefined(),
    )
    expect(postBody(fetchMock, '/api/fund-entries')).toBeUndefined()
  })

  it('does not post without a name', async () => {
    const fetchMock = stubApi({ '/api/funds': FUNDS })
    render(<Funds />)
    const form = await fillForm({ 'Target $': '5,000' })

    fireEvent.click(within(form).getByRole('button', { name: '+ Add' }))

    expect(postBody(fetchMock, '/api/funds')).toBeUndefined()
  })
})

describe('archiving a fund', () => {
  it('shows an Archive button on each fund card', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    for (const row of rows) {
      expect(
        within(row).getByRole('button', { name: 'Archive' }),
      ).toBeInTheDocument()
    }
  })

  it('posts the archive and refetches the list', async () => {
    const routes: Record<string, unknown> = {
      '/api/funds': FUNDS,
      'POST /api/funds/1/archive': { ...FUNDS[0], balance: 0 },
    }
    const fetchMock = stubApi(routes)
    render(<Funds />)
    const rows = await screen.findAllByTestId('fund-row')
    routes['/api/funds'] = FUNDS.slice(1)

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Archive' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('fund-row')).toHaveLength(2),
    )
    expect(screen.queryByText('🚨 Emergency fund')).not.toBeInTheDocument()
    expect(screen.getByText('$14,200')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/archive')).toEqual({})
  })
})

describe('editing a fund plan', () => {
  it('shows an Edit button on each fund card', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    for (const row of rows) {
      expect(
        within(row).getByRole('button', { name: 'Edit' }),
      ).toBeInTheDocument()
    }
  })

  it('reveals the $ / month input prefilled with the current plan', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[0]).getByLabelText('$ / month')).toHaveValue('500')
  })

  it('prefills a blank input for a fund with no plan', async () => {
    render(<Funds />)

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
      '/api/funds': FUNDS,
      'PUT /api/funds/1': revised,
    }
    const fetchMock = stubApi(routes)
    render(<Funds />)
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
    expect(putBody(fetchMock, '/api/funds/1')).toEqual({ monthly_plan: 1000 })
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
      '/api/funds': FUNDS,
      'PUT /api/funds/3': paused,
    }
    const fetchMock = stubApi(routes)
    render(<Funds />)
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
    expect(putBody(fetchMock, '/api/funds/3')).toEqual({ monthly_plan: null })
  })

  it('cancels without saving', async () => {
    const fetchMock = stubApi({ '/api/funds': FUNDS })
    render(<Funds />)
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

describe('topping up a fund', () => {
  it('shows a Top up button on each fund card', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    for (const row of rows) {
      expect(
        within(row).getByRole('button', { name: 'Top up' }),
      ).toBeInTheDocument()
    }
  })

  it('reveals a blank $ amount input with the release hint', async () => {
    render(<Funds />)

    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    const input = within(rows[0]).getByLabelText('$ amount')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'negative releases')
  })

  it('closes an open plan editor when the top-up form opens', async () => {
    render(<Funds />)

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
      '/api/funds': FUNDS,
      'POST /api/funds/1/top-up': toppedUp,
    }
    const fetchMock = stubApi(routes)
    render(<Funds />)
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '250' },
    })
    routes['/api/funds'] = [toppedUp, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$10,250 / $30,000')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({ amount: 250 })
    expect(
      within(rows[0]).queryByLabelText('$ amount'),
    ).not.toBeInTheDocument()
  })

  it('posts a negative amount as a release', async () => {
    const released = { ...FUNDS[0], balance: 9_500 }
    const routes: Record<string, unknown> = {
      '/api/funds': FUNDS,
      'POST /api/funds/1/top-up': released,
    }
    const fetchMock = stubApi(routes)
    render(<Funds />)
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ amount'), {
      target: { value: '-500' },
    })
    routes['/api/funds'] = [released, ...FUNDS.slice(1)]

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$9,500 / $30,000')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/funds/1/top-up')).toEqual({ amount: -500 })
  })

  it('does not post a blank amount', async () => {
    const fetchMock = stubApi({ '/api/funds': FUNDS })
    render(<Funds />)
    const rows = await screen.findAllByTestId('fund-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Top up' }))

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(postBody(fetchMock, '/api/funds/1/top-up')).toBeUndefined()
  })

  it('cancels without posting', async () => {
    const fetchMock = stubApi({ '/api/funds': FUNDS })
    render(<Funds />)
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

describe('responsive layout', () => {
  it('stacks the new-fund form grids into one column on narrow screens', async () => {
    render(<Funds />)

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
