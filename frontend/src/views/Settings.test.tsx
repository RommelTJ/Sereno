import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayIso } from '../ledger.ts'
import {
  ACCOUNTS,
  ASSUMPTION,
  balance,
  CATEGORIES,
  LEDGER,
  SOCIAL_SECURITY,
  SPEND_PLAN,
  TAX_PARAMS,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Settings from './Settings.tsx'

const routes = () => ({
  '/api/accounts': ACCOUNTS,
  '/api/ledger': LEDGER,
  '/api/categories': CATEGORIES,
  '/api/assumptions': ASSUMPTION,
  '/api/spend-plan': SPEND_PLAN,
  '/api/social-security': SOCIAL_SECURITY,
  '/api/tax-params': TAX_PARAMS,
})

const postBody = (fetchMock: ReturnType<typeof stubApi>, path: string) => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => input === path && init?.method === 'POST',
  )
  return call ? JSON.parse(call[1]?.body as string) : undefined
}

beforeEach(() => {
  stubApi(routes())
})

describe('Assets card', () => {
  it('lists active assets with emoji, name, and latest ledger value', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-asset-row')
    expect(rows).toHaveLength(9)
    expect(within(rows[0]).getByText('⚡')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Ethereum')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$70,000')).toBeInTheDocument()
    expect(within(rows[4]).getByText('Retirement')).toBeInTheDocument()
    expect(within(rows[4]).getByText('$350,000')).toBeInTheDocument()
  })

  it('falls back to an older month when the latest lacks an entry', async () => {
    const ledger = [
      {
        ...LEDGER[0],
        balances: LEDGER[0].balances.filter((b) => b.account_id !== 9),
      },
      LEDGER[1],
    ]
    stubApi({ ...routes(), '/api/ledger': ledger })
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-asset-row')
    expect(within(rows[8]).getByText('Car')).toBeInTheDocument()
    expect(within(rows[8]).getByText('$15,000')).toBeInTheDocument()
  })

  it('hides inactive accounts', async () => {
    stubApi({
      ...routes(),
      '/api/accounts': [
        ...ACCOUNTS,
        { ...ACCOUNTS[8], id: 11, name: 'Old boat', active: false },
      ],
    })
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-asset-row')
    expect(rows).toHaveLength(9)
    expect(screen.queryByText('Old boat')).not.toBeInTheDocument()
  })

  it('adds an asset and refreshes the lists', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    await screen.findAllByTestId('settings-asset-row')

    const card = screen.getByTestId('assets-card')
    fireEvent.change(within(card).getByLabelText('Name'), {
      target: { value: 'Gold coins' },
    })
    fireEvent.change(within(card).getByLabelText('Emoji'), {
      target: { value: '💎' },
    })
    fireEvent.change(within(card).getByLabelText('Initial value'), {
      target: { value: '2,500' },
    })

    const created = { ...ACCOUNTS[8], id: 11, name: 'Gold coins', emoji: '💎' }
    liveRoutes['POST /api/accounts'] = created
    liveRoutes['/api/accounts'] = [...ACCOUNTS, created]
    liveRoutes['/api/ledger'] = [
      {
        ...LEDGER[0],
        balances: [...LEDGER[0].balances, balance(11, '2026-06-15', 2_500)],
      },
      LEDGER[1],
    ]
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-asset-row')).toHaveLength(10),
    )
    expect(screen.getByText('Gold coins')).toBeInTheDocument()
    expect(screen.getByText('$2,500')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/accounts')).toEqual({
      name: 'Gold coins',
      emoji: '💎',
      is_liability: false,
      initial_value: 2500,
    })
  })

  it('deactivates an account and removes its row', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    const rows = await screen.findAllByTestId('settings-asset-row')

    liveRoutes['POST /api/accounts/9/deactivate'] = {
      ...ACCOUNTS[8],
      active: false,
    }
    liveRoutes['/api/accounts'] = ACCOUNTS.map((account) =>
      account.id === 9 ? { ...account, active: false } : account,
    )
    fireEvent.click(within(rows[8]).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-asset-row')).toHaveLength(8),
    )
    expect(screen.queryByText('Car')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === '/api/accounts/9/deactivate' && init?.method === 'POST',
      ),
    ).toBe(true)
  })
})

describe('Liabilities card', () => {
  it('lists liabilities separately as negative red figures', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-liability-row')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('🏡')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Mortgage')).toBeInTheDocument()
    const amount = within(rows[0]).getByText('-$150,000')
    expect(amount).toHaveClass('text-red')
  })

  it('adds a liability with is_liability true', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    await screen.findAllByTestId('settings-liability-row')

    const card = screen.getByTestId('liabilities-card')
    fireEvent.change(within(card).getByLabelText('Name'), {
      target: { value: 'Student loan' },
    })
    fireEvent.change(within(card).getByLabelText('Emoji'), {
      target: { value: '🎓' },
    })
    fireEvent.change(within(card).getByLabelText('Initial value'), {
      target: { value: '20,000' },
    })
    liveRoutes['POST /api/accounts'] = {
      ...ACCOUNTS[9],
      id: 11,
      name: 'Student loan',
    }
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/accounts')).toEqual({
        name: 'Student loan',
        emoji: '🎓',
        is_liability: true,
        initial_value: 20000,
      }),
    )
  })
})

describe('Fund rows', () => {
  it('no longer render on Settings — funds live on Funds & Goals', async () => {
    render(<Settings />)

    await screen.findAllByTestId('settings-asset-row')
    expect(screen.queryAllByTestId('settings-fund-row')).toHaveLength(0)
    expect(screen.queryByText('Emergency fund')).not.toBeInTheDocument()
  })
})

describe('Envelopes card', () => {
  it('lists each envelope with its emoji, name, and planned amount', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-envelope-row')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByText('🛒')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Groceries')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$500 / mo')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Travel')).toBeInTheDocument()
    expect(within(rows[3]).getByText('$0 / mo')).toBeInTheDocument()
  })

  it('says so when no envelopes exist yet', async () => {
    stubApi({ ...routes(), '/api/categories': [] })
    render(<Settings />)

    const card = await screen.findByTestId('envelopes-card')
    expect(within(card).getByText('no envelopes yet')).toBeInTheDocument()
  })

  it('offers the curated emoji options in a select', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('envelopes-card')
    const select = within(card).getByLabelText('Emoji')
    expect(
      within(select).getByRole('option', { name: '🛒 Groceries' }),
    ).toBeInTheDocument()
    expect(
      within(select).getByRole('option', { name: '🏠 Housing' }),
    ).toBeInTheDocument()
  })

  it('posts a new envelope and refreshes the list', async () => {
    const CREATED = {
      id: 9,
      name: 'Housing',
      emoji: '🏠',
      is_fixed: false,
      planned: 2_000,
    }
    const liveRoutes = {
      ...routes(),
      'POST /api/categories': CREATED,
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)

    const card = await screen.findByTestId('envelopes-card')
    fireEvent.change(within(card).getByLabelText('Name'), {
      target: { value: 'Housing' },
    })
    fireEvent.change(within(card).getByLabelText('Emoji'), {
      target: { value: '🏠' },
    })
    fireEvent.change(within(card).getByLabelText('$ / month'), {
      target: { value: '2000' },
    })
    liveRoutes['/api/categories'] = [...CATEGORIES, CREATED]
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-envelope-row')).toHaveLength(5),
    )
    expect(postBody(fetchMock, '/api/categories')).toEqual({
      name: 'Housing',
      emoji: '🏠',
      planned: 2000,
    })
    expect(within(card).getByLabelText('Name')).toHaveValue('')
  })

  it('does not post a blank name or a negative amount', async () => {
    const fetchMock = stubApi(routes())
    render(<Settings />)

    const card = await screen.findByTestId('envelopes-card')
    fireEvent.change(within(card).getByLabelText('$ / month'), {
      target: { value: '100' },
    })
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    fireEvent.change(within(card).getByLabelText('Name'), {
      target: { value: 'Housing' },
    })
    fireEvent.change(within(card).getByLabelText('$ / month'), {
      target: { value: '-100' },
    })
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    expect(postBody(fetchMock, '/api/categories')).toBeUndefined()
  })

  it('appends a plan revision from the per-row edit and refreshes', async () => {
    const liveRoutes = {
      ...routes(),
      'POST /api/categories/1/plan': {
        id: 12,
        category_id: 1,
        effective_month: '2026-07',
        planned: 550,
      },
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-envelope-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('$ / month'), {
      target: { value: '550' },
    })
    liveRoutes['/api/categories'] = CATEGORIES.map((category) =>
      category.id === 1 ? { ...category, planned: 550 } : category,
    )
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        within(screen.getAllByTestId('settings-envelope-row')[0]).getByText(
          '$550 / mo',
        ),
      ).toBeInTheDocument(),
    )
    expect(postBody(fetchMock, '/api/categories/1/plan')).toEqual({
      planned: 550,
    })
  })
})

describe('Assumptions card', () => {
  it('shows return, inflation, ETH growth and planned spend', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getByText('Return')).toBeInTheDocument()
    expect(within(card).getByText('7.0%')).toBeInTheDocument()
    expect(within(card).getByText('Inflation')).toBeInTheDocument()
    expect(within(card).getByText('3.0%')).toBeInTheDocument()
    expect(within(card).getByText('ETH growth')).toBeInTheDocument()
    expect(
      within(card).getByText('· refined from tracking'),
    ).toBeInTheDocument()
    expect(within(card).getByText('Planned spend')).toBeInTheDocument()
    expect(within(card).getByText('$45,000 / yr')).toBeInTheDocument()
  })

  it('shows placeholders when no config rows exist yet', async () => {
    stubApi({ ...routes(), '/api/assumptions': null, '/api/spend-plan': null })
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getAllByText('—')).toHaveLength(4)
  })
})

describe('Social Security card', () => {
  it('shows each person with start age and monthly amount', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('social-security-card')
    expect(within(card).getByText('· editable, dated')).toBeInTheDocument()
    expect(within(card).getByText('You — from 67')).toBeInTheDocument()
    expect(within(card).getByText('$1,500/mo')).toBeInTheDocument()
    expect(within(card).getByText('Spouse — from 67')).toBeInTheDocument()
    expect(within(card).getByText('$1,400/mo')).toBeInTheDocument()
  })

  it('says so when no estimates exist yet', async () => {
    stubApi({ ...routes(), '/api/social-security': [] })
    render(<Settings />)

    const card = await screen.findByTestId('social-security-card')
    expect(within(card).getByText('no estimates yet')).toBeInTheDocument()
  })
})

describe('Tax parameters card', () => {
  it('shows the latest year with its ceilings, NIIT and deduction', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('2026 · MFJ')).toBeInTheDocument()
    expect(within(card).getByText('0% LTCG up to')).toBeInTheDocument()
    expect(within(card).getByText('$96,700')).toBeInTheDocument()
    expect(within(card).getByText('15% → 20% at')).toBeInTheDocument()
    expect(within(card).getByText('$600,050')).toBeInTheDocument()
    expect(within(card).getByText('NIIT')).toBeInTheDocument()
    expect(within(card).getByText('3.8% over $250,000')).toBeInTheDocument()
    expect(within(card).getByText('Std deduction')).toBeInTheDocument()
    expect(within(card).getByText('$30,000')).toBeInTheDocument()
  })

  it('lists the ordinary brackets', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('10% to $24,800')).toBeInTheDocument()
    expect(within(card).getByText('12% to $100,800')).toBeInTheDocument()
    expect(within(card).getByText('22% to $211,400')).toBeInTheDocument()
    expect(within(card).getByText('24% and up')).toBeInTheDocument()
  })

  it('says so when no tax years are loaded yet', async () => {
    stubApi({ ...routes(), '/api/tax-params': [] })
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('no tax years loaded yet')).toBeInTheDocument()
  })
})

describe('Data model note', () => {
  it('explains append-only and points at schema.sql', async () => {
    render(<Settings />)

    const note = await screen.findByTestId('data-note')
    expect(
      within(note).getByText('Data model · append-only'),
    ).toBeInTheDocument()
    expect(within(note).getByText(/Never UPDATE a balance/)).toBeInTheDocument()
    expect(within(note).getByText('schema.sql')).toBeInTheDocument()
  })
})

const postCalls = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => input === path && init?.method === 'POST',
  )

describe('Editing appends new config rows', () => {
  it('saves edited assumptions as a new row effective today', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/assumptions': { ...ASSUMPTION, id: 2 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Return %'), {
      target: { value: '6.5' },
    })
    fireEvent.change(within(card).getByLabelText('Inflation %'), {
      target: { value: '2.8' },
    })
    r['/api/assumptions'] = {
      ...ASSUMPTION,
      id: 2,
      return_pct: 6.5,
      inflation_pct: 2.8,
    }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('6.5%')).toBeInTheDocument()
    expect(within(card).getByText('2.8%')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/assumptions')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      return_pct: 6.5,
      inflation_pct: 2.8,
    })
    expect(postCalls(fetchMock, '/api/spend-plan')).toHaveLength(0)
  })

  it('saves an edited planned spend carrying the guardrail knobs forward', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2, annual_target: 48_000 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Spend $ / yr'), {
      target: { value: '48,000' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2, annual_target: 48_000 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$48,000 / yr')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 48_000,
      initial_rate: 0.0294,
      guardrail_band: 0.2,
    })
    expect(postCalls(fetchMock, '/api/assumptions')).toHaveLength(0)
  })

  it('saves an edited Social Security amount for that person only', async () => {
    const you = { ...SOCIAL_SECURITY[0], id: 3, monthly_amount: 1_550 }
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/social-security': you,
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('social-security-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('You $ / mo'), {
      target: { value: '1,550' },
    })
    r['/api/social-security'] = [you, SOCIAL_SECURITY[1]]

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$1,550/mo')).toBeInTheDocument()
    const calls = postCalls(fetchMock, '/api/social-security')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual({
      person: 'you',
      effective_date: todayIso(),
      start_age: 67,
      monthly_amount: 1_550,
    })
  })
})

describe('Tax parameter editing', () => {
  it('revises the displayed year in place', async () => {
    const revised = {
      ...TAX_PARAMS[0],
      ltcg_0_ceiling: 97_350,
      std_deduction: 30_250,
      ordinary_brackets: [
        { rate: 0.1, upto: 25_000 },
        ...TAX_PARAMS[0].ordinary_brackets.slice(1),
      ],
    }
    const r: Record<string, unknown> = {
      ...routes(),
      'PUT /api/tax-params/2026': revised,
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('tax-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('0% LTCG up to $'), {
      target: { value: '97,350' },
    })
    fireEvent.change(within(card).getByLabelText('Std deduction $'), {
      target: { value: '30,250' },
    })
    fireEvent.change(within(card).getByLabelText('Bracket 1 up to $'), {
      target: { value: '25,000' },
    })
    r['/api/tax-params'] = [revised]

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$97,350')).toBeInTheDocument()
    expect(within(card).getByText('10% to $25,000')).toBeInTheDocument()
    const puts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        input === '/api/tax-params/2026' && init?.method === 'PUT',
    )
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1]?.body as string)).toEqual({
      filing_status: 'MFJ',
      ltcg_0_ceiling: 97_350,
      ltcg_15_ceiling: 600_050,
      niit_rate: 0.038,
      niit_threshold: 250_000,
      state_treatment: 'CA_ordinary',
      std_deduction: 30_250,
      ordinary_brackets: [
        { rate: 0.1, upto: 25_000 },
        { rate: 0.12, upto: 100_800 },
        { rate: 0.22, upto: 211_400 },
        { rate: 0.24, upto: null },
      ],
    })
  })

  it('adds the next year prefilled from the current one', async () => {
    const added = { ...TAX_PARAMS[0], tax_year: 2027, ltcg_0_ceiling: 99_000 }
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/tax-params': added,
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('tax-card')
    fireEvent.click(within(card).getByRole('button', { name: '+ Add 2027' }))
    fireEvent.change(within(card).getByLabelText('0% LTCG up to $'), {
      target: { value: '99,000' },
    })
    r['/api/tax-params'] = [TAX_PARAMS[0], added]

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('2027 · MFJ')).toBeInTheDocument()
    const calls = postCalls(fetchMock, '/api/tax-params')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual({
      tax_year: 2027,
      filing_status: 'MFJ',
      ltcg_0_ceiling: 99_000,
      ltcg_15_ceiling: 600_050,
      niit_rate: 0.038,
      niit_threshold: 250_000,
      state_treatment: 'CA_ordinary',
      std_deduction: 30_000,
      ordinary_brackets: TAX_PARAMS[0].ordinary_brackets,
    })
  })

  it('adds the first year on a fresh database', async () => {
    const first = { ...TAX_PARAMS[0] }
    const r: Record<string, unknown> = {
      ...routes(),
      '/api/tax-params': [],
      'POST /api/tax-params': first,
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('tax-card')
    fireEvent.click(within(card).getByRole('button', { name: '+ Add 2026' }))
    fireEvent.change(within(card).getByLabelText('0% LTCG up to $'), {
      target: { value: '96,700' },
    })
    r['/api/tax-params'] = [first]

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('2026 · MFJ')).toBeInTheDocument()
    const calls = postCalls(fetchMock, '/api/tax-params')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual({
      tax_year: 2026,
      filing_status: 'MFJ',
      ltcg_0_ceiling: 96_700,
      niit_rate: 0.038,
      state_treatment: 'CA_ordinary',
    })
  })
})

describe('Responsive layout', () => {
  it('stacks the assumptions row into one column on narrow screens', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(card.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })

  it('stacks the add-envelope form into one column on narrow screens', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('envelopes-card')
    const nameField = within(card).getByLabelText('Name')
    expect(nameField.closest('.grid')).toHaveClass(
      'grid-cols-1',
      'sm:grid-cols-[1fr_1fr_1fr_auto]',
    )
  })
})
