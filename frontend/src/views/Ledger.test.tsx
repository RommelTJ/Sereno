import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNTS, LEDGER, balance } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Ledger from './Ledger.tsx'

describe('Ledger monthly balance table', () => {
  beforeEach(() => {
    stubApi({ '/api/accounts': ACCOUNTS, '/api/ledger': LEDGER })
  })

  it('renders one column per active account, assets then liabilities', async () => {
    render(<Ledger />)

    expect(await screen.findByRole('table')).toBeInTheDocument()
    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual([
      'Date',
      'Ethereum',
      'VFIAX',
      'VTIAX',
      'VGSH',
      'Retirement',
      'Home',
      'Chase checking',
      'Vanguard Cash Plus',
      'Car',
      'Mortgage',
      'Net worth',
    ])
  })

  it('gives an inactive account no column', async () => {
    stubApi({
      '/api/accounts': [
        ...ACCOUNTS,
        { ...ACCOUNTS[8], id: 11, name: 'Old boat', active: false },
      ],
      '/api/ledger': LEDGER,
    })
    render(<Ledger />)

    await screen.findByRole('table')
    expect(
      screen.queryByRole('columnheader', { name: 'Old boat' }),
    ).not.toBeInTheDocument()
  })

  it('renders one row per month, newest first, with the canonical balances', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Jun 1, 2026')
    expect(within(rows[0]).getByText('$70,000')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$700,000')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('May 1, 2026')
    expect(within(rows[1]).getByText('$68,000')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$690,000')).toBeInTheDocument()
  })

  it('renders the two cash accounts as separate columns', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('$9,000')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$20,000')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$7,000')).toBeInTheDocument()
  })

  it('shows the mortgage as a negative red figure', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('-$150,000')).toHaveClass('text-red-text')
    expect(within(rows[1]).getByText('-$150,700')).toBeInTheDocument()
  })

  it("shows each month's net worth from the API", async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('$1,744,000')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$1,717,300')).toBeInTheDocument()
  })

  it('highlights only the newest month row', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(rows[0]).toHaveClass('bg-[#f3f6f3]')
    expect(rows[1]).not.toHaveClass('bg-[#f3f6f3]')
  })
})

describe("Update this month's balances form", () => {
  beforeEach(() => {
    stubApi({ '/api/accounts': ACCOUNTS, '/api/ledger': LEDGER })
  })

  it("prefills the inputs from the newest month's canonical balances", async () => {
    render(<Ledger />)

    expect(await screen.findByLabelText('VFIAX')).toHaveValue('700,000')
    expect(screen.getByLabelText('VTIAX')).toHaveValue('250,000')
    expect(screen.getByLabelText('VGSH')).toHaveValue('130,000')
    expect(screen.getByLabelText('Retirement')).toHaveValue('350,000')
    expect(screen.getByLabelText('ETH held')).toHaveValue('20')
    expect(screen.getByLabelText('$ / ETH')).toHaveValue('3,500')
  })

  it('recomputes the ETH value readout as quantity and price change', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('ETH held'), {
      target: { value: '21' },
    })
    expect(screen.getByTestId('eth-value')).toHaveTextContent('$73,500')

    fireEvent.change(screen.getByLabelText('$ / ETH'), {
      target: { value: '4,000' },
    })
    expect(screen.getByTestId('eth-value')).toHaveTextContent('$84,000')
  })

  it('recomputes the live net worth as any field changes', async () => {
    render(<Ledger />)

    // Initial live figure matches the newest month: $1,744,000.
    expect(await screen.findByTestId('live-net-worth')).toHaveTextContent(
      '$1,744,000',
    )

    // +$10,000 of VFIAX.
    fireEvent.change(screen.getByLabelText('VFIAX'), {
      target: { value: '710,000' },
    })
    expect(screen.getByTestId('live-net-worth')).toHaveTextContent(
      '$1,754,000',
    )

    // +1 ETH at $3,500 on top of the VFIAX change.
    fireEvent.change(screen.getByLabelText('ETH held'), {
      target: { value: '21' },
    })
    expect(screen.getByTestId('live-net-worth')).toHaveTextContent(
      '$1,757,500',
    )
  })
})

describe('Responsive layout', () => {
  beforeEach(() => {
    stubApi({ '/api/accounts': ACCOUNTS, '/api/ledger': LEDGER })
  })

  it('stacks the table and form into one column on narrow screens', async () => {
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    expect(screen.getByTestId('view-ledger')).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-[1.6fr_1fr]',
    )
  })

  it('stacks the balance-form grids into one column on narrow screens', async () => {
    render(<Ledger />)

    const brokerage = (await screen.findByLabelText('VFIAX')).closest('.grid')
    expect(brokerage).toHaveClass('grid-cols-1', 'sm:grid-cols-3')
    const eth = screen.getByLabelText('ETH held').closest('.grid')
    expect(eth).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })
})

describe('Saving balances', () => {
  let routes: Record<string, unknown>
  let fetchMock: ReturnType<typeof stubApi>

  beforeEach(() => {
    routes = {
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER,
      '/api/balance-entries': { id: 999 },
    }
    fetchMock = stubApi(routes)
  })

  it('appends one entry per form account, dated today, on save', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('VFIAX'), {
      target: { value: '710,000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save balances' }))

    expect(
      await screen.findByRole('button', { name: 'Saved ✓' }),
    ).toBeInTheDocument()
    const today = new Date().toLocaleDateString('en-CA')
    const bodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown)
    expect(bodies).toHaveLength(5)
    expect(bodies).toContainEqual({
      account_id: 1,
      as_of_date: today,
      quantity: 20,
      unit_price: 3500,
    })
    expect(bodies).toContainEqual({
      account_id: 2,
      as_of_date: today,
      balance_usd: 710000,
    })
    expect(bodies).toContainEqual({
      account_id: 3,
      as_of_date: today,
      balance_usd: 250000,
    })
    expect(bodies).toContainEqual({
      account_id: 4,
      as_of_date: today,
      balance_usd: 130000,
    })
    expect(bodies).toContainEqual({
      account_id: 5,
      as_of_date: today,
      balance_usd: 350000,
    })
  })

  it('refreshes the table so the appended month row appears', async () => {
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    // The server now has a July entry; saving should refetch and show it.
    routes['/api/ledger'] = [
      {
        month: '2026-07',
        net_worth: 1_754_000,
        balances: [
          balance(1, '2026-07-04', 73_500, 21, 3_500),
          balance(2, '2026-07-04', 710_000),
        ],
      },
      ...LEDGER,
    ]
    fireEvent.click(screen.getByRole('button', { name: 'Save balances' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('ledger-row')).toHaveLength(3),
    )
    expect(screen.getAllByTestId('ledger-row')[0]).toHaveTextContent(
      'Jul 4, 2026',
    )
  })
})
