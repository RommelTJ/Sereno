import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayIso } from '../ledger.ts'
import { NetWorthContext } from '../netWorth.ts'
import {
  ACCOUNTS,
  ASSUMPTION,
  balance,
  CATEGORIES,
  LEDGER,
  LEDGER_PAGE,
  MORTGAGE,
  QUICK_LINKS,
  SOCIAL_SECURITY,
  SPEND_BANDS,
  SPEND_PLAN,
  TAX_PARAMS,
  ledgerPage,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Settings from './Settings.tsx'

const routes = () => ({
  '/api/accounts': ACCOUNTS,
  '/api/ledger': LEDGER_PAGE,
  '/api/categories': CATEGORIES,
  '/api/quick-links': QUICK_LINKS,
  '/api/assumptions': ASSUMPTION,
  '/api/spend-plan': SPEND_PLAN,
  '/api/social-security': SOCIAL_SECURITY,
  '/api/tax-params': TAX_PARAMS,
  '/api/mortgage': MORTGAGE,
  '/api/spend-bands': SPEND_BANDS,
})

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
    expect(within(rows[0]).getByText('$70,000.00')).toBeInTheDocument()
    expect(within(rows[4]).getByText('Retirement')).toBeInTheDocument()
    expect(within(rows[4]).getByText('$350,000.00')).toBeInTheDocument()
  })

  it('falls back to an older month when the latest lacks an entry', async () => {
    const ledger = [
      {
        ...LEDGER[0],
        balances: LEDGER[0].balances.filter((b) => b.account_id !== 9),
      },
      LEDGER[1],
    ]
    stubApi({ ...routes(), '/api/ledger': ledgerPage(ledger) })
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-asset-row')
    expect(within(rows[8]).getByText('Car')).toBeInTheDocument()
    expect(within(rows[8]).getByText('$15,000.00')).toBeInTheDocument()
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

  it('offers the curated emoji options in a select', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assets-card')
    const select = within(card).getByLabelText('Emoji')
    expect(
      within(select).getByRole('option', { name: '⚡ Ethereum' }),
    ).toBeInTheDocument()
    expect(
      within(select).getByRole('option', { name: '🏡 Mortgage' }),
    ).toBeInTheDocument()
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
    liveRoutes['/api/ledger'] = ledgerPage([
      {
        ...LEDGER[0],
        balances: [...LEDGER[0].balances, balance(11, '2026-06-15', 2_500)],
      },
      LEDGER[1],
    ])
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-asset-row')).toHaveLength(10),
    )
    expect(screen.getByText('Gold coins')).toBeInTheDocument()
    expect(screen.getByText('$2,500.00')).toBeInTheDocument()
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
    const amount = within(rows[0]).getByText('-$150,000.00')
    expect(amount).toHaveClass('text-red')
  })

  it('offers no classification edit on liability rows', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-liability-row')
    expect(
      within(rows[0]).queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument()
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

describe('Account classification', () => {
  // The per-row Edit sets the planner-facing dimensions — kind, tax
  // treatment, the investable flag, withdrawal priority, and access age —
  // so accounts created here can feed Guardrails, Sourcing, and Forecast.
  it('opens a per-row edit prefilled with the classification', async () => {
    render(<Settings />)
    const rows = await screen.findAllByTestId('settings-asset-row')

    fireEvent.click(within(rows[4]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[4]).getByLabelText('Kind')).toHaveValue('401k')
    expect(within(rows[4]).getByLabelText('Tax treatment')).toHaveValue(
      'ORDINARY',
    )
    expect(within(rows[4]).getByLabelText('Investable')).toBeChecked()
    expect(within(rows[4]).getByLabelText('Withdrawal priority')).toHaveValue(
      '3',
    )
    expect(within(rows[4]).getByLabelText('Access age')).toHaveValue('59.5')
    expect(within(rows[4]).getByLabelText('Owner')).toHaveValue('you')
  })

  it('offers the HSA withdrawal tier', async () => {
    render(<Settings />)
    const rows = await screen.findAllByTestId('settings-asset-row')

    fireEvent.click(within(rows[4]).getByRole('button', { name: 'Edit' }))

    const priority = within(rows[4]).getByLabelText('Withdrawal priority')
    expect(
      Array.from(priority.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['—', '1 — ETH', '2 — Brokerage', '3 — 401(k)', '4 — HSA'])
  })

  it('classifies an account via PUT and closes the edit', async () => {
    // The issue's scenario: an account created from Settings sits at kind
    // 'other', invisible to every planner, until it is classified here.
    const robinhood = {
      ...ACCOUNTS[8],
      id: 11,
      name: 'Robinhood',
      kind: 'other',
      emoji: '🪙',
    }
    const liveRoutes: Record<string, unknown> = {
      ...routes(),
      '/api/accounts': [...ACCOUNTS, robinhood],
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    const rows = await screen.findAllByTestId('settings-asset-row')
    const row = rows[9]

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(row).getByLabelText('Kind'), {
      target: { value: 'brokerage_fund' },
    })
    fireEvent.change(within(row).getByLabelText('Tax treatment'), {
      target: { value: 'LTCG' },
    })
    fireEvent.click(within(row).getByLabelText('Investable'))
    fireEvent.change(within(row).getByLabelText('Withdrawal priority'), {
      target: { value: '2' },
    })
    fireEvent.change(within(row).getByLabelText('Owner'), {
      target: { value: 'spouse' },
    })

    const classified = {
      ...robinhood,
      kind: 'brokerage_fund',
      tax_treatment: 'LTCG',
      is_investable: true,
      withdrawal_priority: 2,
    }
    liveRoutes['PUT /api/accounts/11'] = classified
    liveRoutes['/api/accounts'] = [...ACCOUNTS, classified]
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/accounts/11')).toEqual({
        kind: 'brokerage_fund',
        tax_treatment: 'LTCG',
        is_investable: true,
        withdrawal_priority: 2,
        access_age: null,
        owner: 'spouse',
      }),
    )
    await waitFor(() =>
      expect(within(row).queryByLabelText('Kind')).not.toBeInTheDocument(),
    )
  })
})

describe('Header net worth', () => {
  // The provider's refresh() reloads /api/net-worth for the header readout;
  // Settings must call it whenever an account change moves net worth.
  const renderWithRefresh = () => {
    const liveRoutes: Record<string, unknown> = routes()
    stubApi(liveRoutes)
    const refresh = vi.fn(async () => undefined)
    render(
      <NetWorthContext value={{ netWorth: null, refresh }}>
        <Settings />
      </NetWorthContext>,
    )
    return { liveRoutes, refresh }
  }

  it('refreshes after adding an account', async () => {
    const { liveRoutes, refresh } = renderWithRefresh()
    await screen.findAllByTestId('settings-asset-row')

    const card = screen.getByTestId('assets-card')
    fireEvent.change(within(card).getByLabelText('Name'), {
      target: { value: 'Gold coins' },
    })
    fireEvent.change(within(card).getByLabelText('Initial value'), {
      target: { value: '2,500' },
    })
    const created = { ...ACCOUNTS[8], id: 11, name: 'Gold coins' }
    liveRoutes['POST /api/accounts'] = created
    liveRoutes['/api/accounts'] = [...ACCOUNTS, created]
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-asset-row')).toHaveLength(10),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('refreshes after deactivating an account', async () => {
    const { liveRoutes, refresh } = renderWithRefresh()
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
    expect(refresh).toHaveBeenCalled()
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
    expect(within(rows[0]).getByText('$500.00 / mo')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Travel')).toBeInTheDocument()
    expect(within(rows[3]).getByText('$0.00 / mo')).toBeInTheDocument()
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
          '$550.00 / mo',
        ),
      ).toBeInTheDocument(),
    )
    expect(postBody(fetchMock, '/api/categories/1/plan')).toEqual({
      planned: 550,
    })
  })

  it('prefills name, emoji, and planned in the row edit', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-envelope-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))

    expect(within(rows[0]).getByLabelText('Name')).toHaveValue('Groceries')
    expect(within(rows[0]).getByLabelText('Emoji')).toHaveValue('🛒')
    expect(within(rows[0]).getByLabelText('$ / month')).toHaveValue('500')
  })

  it('puts the rename and posts the plan revision when all fields change', async () => {
    const liveRoutes: Record<string, unknown> = {
      ...routes(),
      'PUT /api/categories/1': {
        id: 1,
        name: 'Food',
        emoji: '🍽️',
        is_fixed: false,
        planned: 550,
      },
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
    fireEvent.change(within(rows[0]).getByLabelText('Name'), {
      target: { value: 'Food' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('Emoji'), {
      target: { value: '🍽️' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('$ / month'), {
      target: { value: '550' },
    })
    liveRoutes['/api/categories'] = CATEGORIES.map((category) =>
      category.id === 1
        ? { ...category, name: 'Food', emoji: '🍽️', planned: 550 }
        : category,
    )
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        within(screen.getAllByTestId('settings-envelope-row')[0]).getByText(
          'Food',
        ),
      ).toBeInTheDocument(),
    )
    expect(putBody(fetchMock, '/api/categories/1')).toEqual({
      name: 'Food',
      emoji: '🍽️',
    })
    expect(postBody(fetchMock, '/api/categories/1/plan')).toEqual({
      planned: 550,
    })
  })

  it('sends no rename when only the planned amount changes', async () => {
    const liveRoutes: Record<string, unknown> = {
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
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/categories/1/plan')).toEqual({
        planned: 550,
      }),
    )
    expect(putBody(fetchMock, '/api/categories/1')).toBeUndefined()
  })

  it('sends no plan revision when only the name changes', async () => {
    const liveRoutes: Record<string, unknown> = {
      ...routes(),
      'PUT /api/categories/1': {
        id: 1,
        name: 'Food',
        emoji: '🛒',
        is_fixed: false,
        planned: 500,
      },
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-envelope-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('Name'), {
      target: { value: 'Food' },
    })
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/categories/1')).toEqual({
        name: 'Food',
        emoji: '🛒',
      }),
    )
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === '/api/categories/1/plan' && init?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('sends nothing when the name is blanked', async () => {
    const fetchMock = stubApi(routes())
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-envelope-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('Name'), {
      target: { value: '   ' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('$ / month'), {
      target: { value: '550' },
    })
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    expect(putBody(fetchMock, '/api/categories/1')).toBeUndefined()
    expect(postBody(fetchMock, '/api/categories/1/plan')).toBeUndefined()
  })

  it('archives an envelope and removes its row', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    const rows = await screen.findAllByTestId('settings-envelope-row')

    liveRoutes['POST /api/categories/1/archive'] = CATEGORIES[0]
    liveRoutes['/api/categories'] = CATEGORIES.filter(
      (category) => category.id !== 1,
    )
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Archive' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-envelope-row')).toHaveLength(3),
    )
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          input === '/api/categories/1/archive' && init?.method === 'POST',
      ),
    ).toBe(true)
  })
})

describe('Quick links card', () => {
  it('lists each link with its label and URL', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-quick-link-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Chase')).toBeInTheDocument()
    expect(
      within(rows[0]).getByText('https://bank.example.com/accounts'),
    ).toBeInTheDocument()
    expect(within(rows[1]).getByText('Vanguard')).toBeInTheDocument()
  })

  it('says so when no links exist yet', async () => {
    stubApi({ ...routes(), '/api/quick-links': [] })
    render(<Settings />)

    const card = await screen.findByTestId('quick-links-card')
    expect(within(card).getByText('no links yet')).toBeInTheDocument()
  })

  it('posts a new link and refreshes the list', async () => {
    const CREATED = {
      id: 3,
      label: 'Fidelity',
      url: 'https://401k.example.com/summary',
    }
    const liveRoutes = {
      ...routes(),
      'POST /api/quick-links': CREATED,
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)

    const card = await screen.findByTestId('quick-links-card')
    fireEvent.change(within(card).getByLabelText('Label'), {
      target: { value: 'Fidelity' },
    })
    fireEvent.change(within(card).getByLabelText('URL'), {
      target: { value: 'https://401k.example.com/summary' },
    })
    liveRoutes['/api/quick-links'] = [...QUICK_LINKS, CREATED]
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-quick-link-row')).toHaveLength(3),
    )
    expect(postBody(fetchMock, '/api/quick-links')).toEqual({
      label: 'Fidelity',
      url: 'https://401k.example.com/summary',
    })
    expect(within(card).getByLabelText('Label')).toHaveValue('')
    expect(within(card).getByLabelText('URL')).toHaveValue('')
  })

  it('does not post a blank label or URL', async () => {
    const fetchMock = stubApi(routes())
    render(<Settings />)

    const card = await screen.findByTestId('quick-links-card')
    fireEvent.change(within(card).getByLabelText('URL'), {
      target: { value: 'https://bank.example.com' },
    })
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    fireEvent.change(within(card).getByLabelText('Label'), {
      target: { value: 'Chase' },
    })
    fireEvent.change(within(card).getByLabelText('URL'), {
      target: { value: '  ' },
    })
    fireEvent.click(within(card).getByRole('button', { name: '+ Add' }))

    expect(postBody(fetchMock, '/api/quick-links')).toBeUndefined()
  })

  it('revises a link from the per-row edit and refreshes', async () => {
    const REVISED = {
      id: 1,
      label: 'Chase checking',
      url: 'https://bank.example.com/login',
    }
    const liveRoutes = {
      ...routes(),
      'PUT /api/quick-links/1': REVISED,
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-quick-link-row')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(rows[0]).getByLabelText('Label'), {
      target: { value: 'Chase checking' },
    })
    fireEvent.change(within(rows[0]).getByLabelText('URL'), {
      target: { value: 'https://bank.example.com/login' },
    })
    liveRoutes['/api/quick-links'] = [REVISED, QUICK_LINKS[1]]
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        within(screen.getAllByTestId('settings-quick-link-row')[0]).getByText(
          'Chase checking',
        ),
      ).toBeInTheDocument(),
    )
    expect(putBody(fetchMock, '/api/quick-links/1')).toEqual({
      label: 'Chase checking',
      url: 'https://bank.example.com/login',
    })
  })

  it('deletes a link and refreshes the list', async () => {
    // The stub's method-key lookup falls through on null (`?? routes[path]`),
    // so the DELETE's empty body is stubbed as {}.
    const liveRoutes: Record<string, unknown> = {
      ...routes(),
      'DELETE /api/quick-links/1': {},
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-quick-link-row')
    liveRoutes['/api/quick-links'] = [QUICK_LINKS[1]]
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('settings-quick-link-row')).toHaveLength(1),
    )
    const deleted = fetchMock.mock.calls.find(
      ([input, init]) =>
        input === '/api/quick-links/1' && init?.method === 'DELETE',
    )
    expect(deleted).toBeDefined()
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
    expect(within(card).getByText('$45,000.00 / yr')).toBeInTheDocument()
  })

  it('shows the staking yield', async () => {
    stubApi({
      ...routes(),
      '/api/assumptions': { ...ASSUMPTION, staking_yield_pct: 3.5 },
    })
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getByText('Staking yield')).toBeInTheDocument()
    expect(within(card).getByText('3.5%')).toBeInTheDocument()
  })

  it('shows the initial withdrawal rate and guardrail band', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getByText('Initial rate')).toBeInTheDocument()
    expect(within(card).getByText('2.94%')).toBeInTheDocument()
    expect(within(card).getByText('Guardrail band')).toBeInTheDocument()
    expect(within(card).getByText('±20%')).toBeInTheDocument()
  })

  it('shows placeholders when no config rows exist yet', async () => {
    stubApi({ ...routes(), '/api/assumptions': null, '/api/spend-plan': null })
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getAllByText('—')).toHaveLength(7)
  })

  it('shows the drawdown start beside the guardrail knobs', async () => {
    stubApi({
      ...routes(),
      '/api/spend-plan': { ...SPEND_PLAN, drawdown_start: '2028-01-01' },
    })
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getByText('Drawdown start')).toBeInTheDocument()
    expect(within(card).getByText('2028-01-01')).toBeInTheDocument()
  })

  it('prefills the drawdown start date', async () => {
    stubApi({
      ...routes(),
      '/api/spend-plan': { ...SPEND_PLAN, drawdown_start: '2028-01-01' },
    })
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    expect(within(card).getByLabelText('Drawdown start')).toHaveValue('2028-01-01')
  })

  it('prefills the rate and band fields as percentages', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    expect(within(card).getByLabelText('Initial rate %')).toHaveValue('2.94')
    expect(within(card).getByLabelText('Guardrail band %')).toHaveValue('20')
  })

  it('previews the derived guardrails under the rate and band fields', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    expect(within(card).getByTestId('band-preview')).toHaveTextContent(
      'Guardrails: 2.35% – 3.53%',
    )

    fireEvent.change(within(card).getByLabelText('Guardrail band %'), {
      target: { value: '10' },
    })
    expect(within(card).getByTestId('band-preview')).toHaveTextContent(
      'Guardrails: 2.65% – 3.23%',
    )
  })

  it('hides the preview while the rate is blank', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Initial rate %'), {
      target: { value: '' },
    })
    expect(within(card).queryByTestId('band-preview')).not.toBeInTheDocument()
  })
})

describe('Social Security card', () => {
  it('shows each person with start age and monthly amount', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('social-security-card')
    expect(within(card).getByText('· editable, dated')).toBeInTheDocument()
    expect(within(card).getByText('You — from 67')).toBeInTheDocument()
    expect(within(card).getByText('$1,500.00/mo')).toBeInTheDocument()
    expect(within(card).getByText('Spouse — from 67')).toBeInTheDocument()
    expect(within(card).getByText('$1,400.00/mo')).toBeInTheDocument()
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
    expect(within(card).getByText('$96,700.00')).toBeInTheDocument()
    expect(within(card).getByText('15% → 20% at')).toBeInTheDocument()
    expect(within(card).getByText('$600,050.00')).toBeInTheDocument()
    expect(within(card).getByText('NIIT')).toBeInTheDocument()
    expect(within(card).getByText('3.8% over $250,000.00')).toBeInTheDocument()
    expect(within(card).getByText('Std deduction')).toBeInTheDocument()
    expect(within(card).getByText('$30,000.00')).toBeInTheDocument()
  })

  it('lists the ordinary brackets', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('10% to $24,800.00')).toBeInTheDocument()
    expect(within(card).getByText('12% to $100,800.00')).toBeInTheDocument()
    expect(within(card).getByText('22% to $211,400.00')).toBeInTheDocument()
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

describe('Mortgage card', () => {
  it('lists the effective terms with the rate as a percentage', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('mortgage-card')
    expect(within(card).getByText('🏡 Mortgage')).toBeInTheDocument()
    expect(within(card).getByText('3.00%')).toBeInTheDocument()
    expect(within(card).getByText('$1,075.00 / mo')).toBeInTheDocument()
    expect(within(card).getByText('$200.00 / mo')).toBeInTheDocument()
    expect(within(card).getByText('$450.00 / mo')).toBeInTheDocument()
  })

  it('offers only liability accounts to link', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('mortgage-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    const select = within(card).getByLabelText('Account')
    expect(
      within(select).getByRole('option', { name: '🏡 Mortgage' }),
    ).toBeInTheDocument()
    // Assets can carry no loan; offering them would amortize the wrong
    // balance without ever erroring.
    expect(within(select).queryByRole('option', { name: /VFIAX/ })).toBeNull()
    expect(within(select).getAllByRole('option')).toHaveLength(1)
  })

  it('prefills the form from the effective row', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('mortgage-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    expect(within(card).getByLabelText('Rate %')).toHaveValue('3')
    expect(within(card).getByLabelText('P&I $ / mo')).toHaveValue('1075')
    expect(within(card).getByLabelText('Extra principal $ / mo')).toHaveValue(
      '200',
    )
    expect(within(card).getByLabelText('Escrow $ / mo')).toHaveValue('450')
  })

  it('appends a revision effective today, the rate back to a fraction', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/mortgage': { ...MORTGAGE, id: 2 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('mortgage-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Extra principal $ / mo'), {
      target: { value: '500' },
    })
    r['/api/mortgage'] = { ...MORTGAGE, id: 2, monthly_extra: 500 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$500.00 / mo')).toBeInTheDocument()
    expect(postBody(fetchMock, '/api/mortgage')).toEqual({
      effective_date: todayIso(),
      account_id: 10,
      annual_rate: 0.03,
      monthly_pi: 1075,
      monthly_extra: 500,
      monthly_escrow: 450,
    })
  })

  it('treats a blank extra or escrow as none', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/mortgage': { ...MORTGAGE, id: 2 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('mortgage-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Extra principal $ / mo'), {
      target: { value: '' },
    })

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(postBody(fetchMock, '/api/mortgage')).toMatchObject({
        monthly_extra: 0,
      }),
    )
  })

  it('appends nothing when the terms did not change', async () => {
    const fetchMock = stubApi(routes())
    render(<Settings />)
    const card = await screen.findByTestId('mortgage-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument(),
    )
    expect(postCalls(fetchMock, '/api/mortgage')).toHaveLength(0)
  })

  it('shows dashes until the terms are entered', async () => {
    stubApi({ ...routes(), '/api/mortgage': null })
    render(<Settings />)

    const card = await screen.findByTestId('mortgage-card')
    expect(within(card).getAllByText('—').length).toBeGreaterThan(0)
  })
})

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

  it('saves an edited staking yield as a new row', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/assumptions': { ...ASSUMPTION, id: 2, staking_yield_pct: 3.5 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Staking yield %'), {
      target: { value: '3.5' },
    })
    r['/api/assumptions'] = { ...ASSUMPTION, id: 2, staking_yield_pct: 3.5 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('3.5%')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/assumptions')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      return_pct: 7,
      inflation_pct: 3,
      staking_yield_pct: 3.5,
    })
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

    expect(await within(card).findByText('$48,000.00 / yr')).toBeInTheDocument()
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

  it('saves an edited initial rate as a fraction on a new spend-plan row', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2, initial_rate: 0.032 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Initial rate %'), {
      target: { value: '3.2' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2, initial_rate: 0.032 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('3.2%')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 45_000,
      initial_rate: 0.032,
      guardrail_band: 0.2,
    })
    expect(postCalls(fetchMock, '/api/assumptions')).toHaveLength(0)
  })

  it('saves an edited guardrail band as a fraction on a new spend-plan row', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2, guardrail_band: 0.25 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Guardrail band %'), {
      target: { value: '25' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2, guardrail_band: 0.25 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('±25%')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 45_000,
      initial_rate: 0.0294,
      guardrail_band: 0.25,
    })
  })

  it('saves an edited drawdown start on a new spend-plan row', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2, drawdown_start: '2028-01-01' },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Drawdown start'), {
      target: { value: '2028-01-01' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2, drawdown_start: '2028-01-01' }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('2028-01-01')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 45_000,
      initial_rate: 0.0294,
      guardrail_band: 0.2,
      drawdown_start: '2028-01-01',
    })
    expect(postCalls(fetchMock, '/api/assumptions')).toHaveLength(0)
  })

  it('carries a stored drawdown start through an unrelated edit', async () => {
    // An assumptions save that never touched the date must not clear
    // it — the payload is a full spend-plan row.
    const stored = { ...SPEND_PLAN, drawdown_start: '2028-01-01' }
    const r: Record<string, unknown> = {
      ...routes(),
      '/api/spend-plan': stored,
      'POST /api/spend-plan': { ...stored, id: 2, annual_target: 48_000 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Spend $ / yr'), {
      target: { value: '48,000' },
    })
    r['/api/spend-plan'] = { ...stored, id: 2, annual_target: 48_000 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$48,000.00 / yr')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 48_000,
      initial_rate: 0.0294,
      guardrail_band: 0.2,
      drawdown_start: '2028-01-01',
    })
  })

  it('clears the drawdown start when the date is blanked', async () => {
    const stored = { ...SPEND_PLAN, drawdown_start: '2028-01-01' }
    const r: Record<string, unknown> = {
      ...routes(),
      '/api/spend-plan': stored,
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Drawdown start'), {
      target: { value: '' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await within(card).findByText('$45,000.00 / yr')
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 45_000,
      initial_rate: 0.0294,
      guardrail_band: 0.2,
    })
  })

  it('clears the anchor when the rate is blanked', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2, initial_rate: null },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Initial rate %'), {
      target: { value: '' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2, initial_rate: null }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(postCalls(fetchMock, '/api/spend-plan')).toHaveLength(1),
    )
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 45_000,
      guardrail_band: 0.2,
    })
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

    expect(await within(card).findByText('$1,550.00/mo')).toBeInTheDocument()
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

    expect(await within(card).findByText('$97,350.00')).toBeInTheDocument()
    expect(within(card).getByText('10% to $25,000.00')).toBeInTheDocument()
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

// jsdom reports zero-size rects for everything, so the keyboard drag
// sensor can't tell rows apart. Stack every element 40px below its
// previous sibling instead — enough geometry for "down means the next row".
const stubRects = () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const siblings = this.parentElement
        ? Array.from(this.parentElement.children)
        : [this]
      const top = siblings.indexOf(this) * 40
      return {
        x: 0,
        y: top,
        top,
        bottom: top + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect
    },
  )
}

// Lift a row by its drag handle, move it one step, and drop it. The drag
// sensor attaches its document listener on a timeout, so flush it between
// the lift and the move.
const dragByOne = async (handle: HTMLElement, code: 'ArrowDown' | 'ArrowUp') => {
  fireEvent.keyDown(handle, { code: 'Enter' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  fireEvent.keyDown(handle, { code })
  fireEvent.keyDown(handle, { code: 'Enter' })
}

describe('Account reordering', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists a dragged asset row and re-renders the new order', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    await screen.findAllByTestId('settings-asset-row')
    stubRects()

    const reordered = [ACCOUNTS[1], ACCOUNTS[0], ...ACCOUNTS.slice(2)]
    liveRoutes['PUT /api/accounts/order'] = reordered.filter(
      (account) => !account.is_liability,
    )
    liveRoutes['/api/accounts'] = reordered
    const card = screen.getByTestId('assets-card')
    await dragByOne(within(card).getByLabelText('Reorder Ethereum'), 'ArrowDown')

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/accounts/order')).toEqual({
        ids: [2, 1, 3, 4, 5, 6, 7, 8, 9, 10],
      }),
    )
    await waitFor(() => {
      const rows = screen.getAllByTestId('settings-asset-row')
      expect(within(rows[0]).getByText('VFIAX')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Ethereum')).toBeInTheDocument()
    })
  })

  it('reorders liabilities within their own card, after the assets', async () => {
    const carLoan = {
      ...ACCOUNTS[9],
      id: 11,
      name: 'Car loan',
      emoji: '🚗',
    }
    const liveRoutes: Record<string, unknown> = {
      ...routes(),
      '/api/accounts': [...ACCOUNTS, carLoan],
    }
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    await screen.findAllByTestId('settings-liability-row')
    stubRects()

    liveRoutes['PUT /api/accounts/order'] = []
    liveRoutes['/api/accounts'] = [
      ...ACCOUNTS.slice(0, 9),
      carLoan,
      ACCOUNTS[9],
    ]
    const card = screen.getByTestId('liabilities-card')
    await dragByOne(within(card).getByLabelText('Reorder Mortgage'), 'ArrowDown')

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/accounts/order')).toEqual({
        ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 10],
      }),
    )
    await waitFor(() => {
      const rows = screen.getAllByTestId('settings-liability-row')
      expect(within(rows[0]).getByText('Car loan')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Mortgage')).toBeInTheDocument()
    })
  })
})

describe('Envelope reordering', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists a dragged envelope row and re-renders the new order', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    await screen.findAllByTestId('settings-envelope-row')
    stubRects()

    liveRoutes['PUT /api/categories/order'] = []
    liveRoutes['/api/categories'] = [
      CATEGORIES[1],
      CATEGORIES[0],
      ...CATEGORIES.slice(2),
    ]
    const card = screen.getByTestId('envelopes-card')
    await dragByOne(within(card).getByLabelText('Reorder Groceries'), 'ArrowDown')

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/categories/order')).toEqual({
        ids: [2, 1, 3, 4],
      }),
    )
    await waitFor(() => {
      const rows = screen.getAllByTestId('settings-envelope-row')
      expect(within(rows[0]).getByText('Gas')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Groceries')).toBeInTheDocument()
    })
  })
})

describe('Quick link reordering', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists a dragged quick-link row and re-renders the new order', async () => {
    const liveRoutes: Record<string, unknown> = routes()
    const fetchMock = stubApi(liveRoutes)
    render(<Settings />)
    await screen.findAllByTestId('settings-quick-link-row')
    stubRects()

    liveRoutes['PUT /api/quick-links/order'] = []
    liveRoutes['/api/quick-links'] = [QUICK_LINKS[1], QUICK_LINKS[0]]
    const card = screen.getByTestId('quick-links-card')
    await dragByOne(within(card).getByLabelText('Reorder Chase'), 'ArrowDown')

    await waitFor(() =>
      expect(putBody(fetchMock, '/api/quick-links/order')).toEqual({
        ids: [2, 1],
      }),
    )
    await waitFor(() => {
      const rows = screen.getAllByTestId('settings-quick-link-row')
      expect(within(rows[0]).getByText('Vanguard')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Chase')).toBeInTheDocument()
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

describe('Spend schedule card', () => {
  it('lists the schedule with ranges, amounts, and notes', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    expect(within(card).getByText('2030-2044')).toBeInTheDocument()
    expect(within(card).getByText('$55,000.00 / yr')).toBeInTheDocument()
    expect(within(card).getByText('peak travel years')).toBeInTheDocument()
    expect(within(card).getByText('2045+')).toBeInTheDocument()
    expect(within(card).getByText('$38,000.00 / yr')).toBeInTheDocument()
    // Band amounts are absolute figures the forecast runs in real
    // terms — the card must say the unit or the plan is ambiguous.
    expect(card).toHaveTextContent(/today's dollars/)
  })

  it('says spending follows the flat target when unconfigured', async () => {
    stubApi({ ...routes(), '/api/spend-bands': [] })
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    expect(card).toHaveTextContent(/follows the plan's annual target/)
  })

  it('prefills the rows on Edit', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    expect(within(card).getByTestId('settings-band-start-0')).toHaveValue(2030)
    expect(within(card).getByTestId('settings-band-end-0')).toHaveValue(2044)
    expect(within(card).getByTestId('settings-band-amount-0')).toHaveValue('55000')
    expect(within(card).getByTestId('settings-band-note-0')).toHaveValue(
      'peak travel years',
    )
    // The open-ended band's end year renders empty.
    expect(within(card).getByTestId('settings-band-end-1')).toHaveValue(null)
  })

  it('saves the whole schedule as a new version dated today', async () => {
    const fetchMock = stubApi({
      ...routes(),
      'POST /api/spend-bands': SPEND_BANDS,
    })
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByTestId('settings-band-amount-0'), {
      target: { value: '60,000' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(postBody(fetchMock, '/api/spend-bands')).toEqual({
        effective_date: todayIso(),
        bands: [
          {
            start_year: 2030,
            end_year: 2044,
            annual_amount: 60_000,
            note: 'peak travel years',
          },
          {
            start_year: 2045,
            end_year: null,
            annual_amount: 38_000,
            note: 'slower years, mortgage gone',
          },
        ],
      })
    })
  })

  it('posts nothing when the schedule did not change', async () => {
    const fetchMock = stubApi(routes())
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(within(card).queryByTestId('settings-band-start-0')).toBeNull()
    })
    expect(postBody(fetchMock, '/api/spend-bands')).toBeUndefined()
  })

  it('disables Save and warns while the draft overlaps', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByTestId('settings-band-end-0'), {
      target: { value: '2046' },
    })

    expect(within(card).getByTestId('settings-band-problem')).toHaveTextContent(
      'bands 2030-2046 and 2045+ overlap',
    )
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('adds and removes rows in the editor', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(card).getByRole('button', { name: '+ Add band' }))
    expect(within(card).getByTestId('settings-band-start-2')).toBeInTheDocument()

    fireEvent.click(within(card).getAllByRole('button', { name: 'Remove band' })[2])
    expect(within(card).queryByTestId('settings-band-start-2')).toBeNull()
  })

  it('removing every row saves the persistent clear', async () => {
    const fetchMock = stubApi({
      ...routes(),
      'POST /api/spend-bands': [],
    })
    render(<Settings />)

    const card = await screen.findByTestId('spend-bands-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(card).getAllByRole('button', { name: 'Remove band' })[1])
    fireEvent.click(within(card).getAllByRole('button', { name: 'Remove band' })[0])
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(postBody(fetchMock, '/api/spend-bands')).toEqual({
        effective_date: todayIso(),
        bands: [],
      })
    })
  })
})
