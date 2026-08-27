import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNTS,
  LEDGER,
  LEDGER_PAGE,
  QUICK_LINKS,
  UNCLASSIFIED_ACCOUNTS,
  balance,
  ledgerPage,
} from '../test/fixtures.ts'
import { stubApi, stubIntersectionObserver } from '../test/stubs.ts'
import Ledger from './Ledger.tsx'

describe('Ledger monthly balance table', () => {
  beforeEach(() => {
    stubApi({
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
    })
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
      'Brokerage',
      'Retirement',
      'Home',
      'Chase checking',
      'Vanguard Cash Plus',
      'Car',
      'Mortgage',
      'Net worth',
    ])
  })

  it('sums the three brokerage funds into the subtotal cell', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('$1,080,000.00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$1,064,000.00')).toBeInTheDocument()
  })

  it('gives a fresh install no subtotal column', async () => {
    stubApi({
      '/api/accounts': UNCLASSIFIED_ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
    })
    render(<Ledger />)

    await screen.findByRole('table')
    expect(
      screen.queryByRole('columnheader', { name: 'Brokerage' }),
    ).not.toBeInTheDocument()
  })

  it('gives an inactive account no column', async () => {
    stubApi({
      '/api/accounts': [
        ...ACCOUNTS,
        { ...ACCOUNTS[8], id: 11, name: 'Old boat', active: false },
      ],
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
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
    expect(rows[0]).toHaveTextContent('June 2026')
    expect(within(rows[0]).getByText('$70,000.00')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$700,000.00')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('May 2026')
    expect(within(rows[1]).getByText('$68,000.00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$690,000.00')).toBeInTheDocument()
  })

  it('renders the two cash accounts as separate columns', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('$9,000.00')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$20,000.00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$7,000.00')).toBeInTheDocument()
  })

  it('shows the mortgage as a negative red figure', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('-$150,000.00')).toHaveClass('text-red-text')
    expect(within(rows[1]).getByText('-$150,700.00')).toBeInTheDocument()
  })

  it("shows each month's net worth from the API", async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('$1,744,000.00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$1,717,300.00')).toBeInTheDocument()
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
    stubApi({
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
    })
  })

  it('offers the active accounts in a picker, assets then liabilities', async () => {
    render(<Ledger />)

    const select = await screen.findByLabelText('Account')
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual([
      '⚡ Ethereum',
      '📈 VFIAX',
      '🌍 VTIAX',
      '🏦 VGSH',
      '🏖️ Retirement',
      '🏠 Home',
      '💵 Chase checking',
      '💵 Vanguard Cash Plus',
      '🚗 Car',
      '🏡 Mortgage',
    ])
  })

  it('leaves inactive accounts out of the picker', async () => {
    stubApi({
      '/api/accounts': [
        ...ACCOUNTS,
        { ...ACCOUNTS[8], id: 11, name: 'Old boat', active: false },
      ],
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
    })
    render(<Ledger />)

    const select = await screen.findByLabelText('Account')
    expect(
      within(select).queryByRole('option', { name: '🚗 Old boat' }),
    ).not.toBeInTheDocument()
  })

  it('shows quantity and price inputs for the ETH account', async () => {
    render(<Ledger />)

    expect(await screen.findByLabelText('ETH held')).toHaveValue('20.00000')
    expect(screen.getByLabelText('$ / ETH')).toHaveValue('3,500.00')
    expect(screen.getByTestId('eth-value')).toHaveTextContent('$70,000.00')
    expect(screen.queryByLabelText('Value')).not.toBeInTheDocument()
  })

  it('swaps to a single value input prefilled from the newest month for USD accounts', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('Account'), {
      target: { value: '2' },
    })
    expect(screen.getByLabelText('Value')).toHaveValue('700,000.00')
    expect(screen.queryByLabelText('ETH held')).not.toBeInTheDocument()
  })

  it("prefills $ / ETH from another eth account's newer entry in the month", async () => {
    // The price is market-wide: Ethereum's own June entry says 3,500, but
    // ETH Wallet was saved later in the month at 3,600.
    stubApi({
      '/api/accounts': [
        ...ACCOUNTS,
        { ...ACCOUNTS[0], id: 11, name: 'ETH Wallet' },
      ],
      '/api/ledger': ledgerPage([
        {
          ...LEDGER[0],
          balances: [
            ...LEDGER[0].balances,
            balance(11, '2026-06-15', 18_000, 5, 3_600),
          ],
        },
        LEDGER[1],
      ]),
      '/api/quick-links': [],
    })
    render(<Ledger />)

    expect(await screen.findByLabelText('$ / ETH')).toHaveValue('3,600.00')
    expect(screen.getByLabelText('ETH held')).toHaveValue('20.00000')
  })

  it("prefills $ / ETH from another eth account's newer month", async () => {
    // ETH Wallet's own newest entry is May at 3,400; Ethereum's June entry
    // carries the newer price. Quantity still comes from the wallet's own.
    stubApi({
      '/api/accounts': [
        ...ACCOUNTS,
        { ...ACCOUNTS[0], id: 11, name: 'ETH Wallet' },
      ],
      '/api/ledger': ledgerPage([
        LEDGER[0],
        {
          ...LEDGER[1],
          balances: [
            ...LEDGER[1].balances,
            balance(11, '2026-05-01', 17_000, 5, 3_400),
          ],
        },
      ]),
      '/api/quick-links': [],
    })
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('Account'), {
      target: { value: '11' },
    })
    expect(screen.getByLabelText('$ / ETH')).toHaveValue('3,500.00')
    expect(screen.getByLabelText('ETH held')).toHaveValue('5.00000')
  })

  it('recomputes the ETH value readout as quantity and price change', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('ETH held'), {
      target: { value: '21' },
    })
    expect(screen.getByTestId('eth-value')).toHaveTextContent('$73,500.00')

    fireEvent.change(screen.getByLabelText('$ / ETH'), {
      target: { value: '4,000' },
    })
    expect(screen.getByTestId('eth-value')).toHaveTextContent('$84,000.00')
  })

  it('recomputes the live net worth as the draft value changes', async () => {
    render(<Ledger />)

    // Initial live figure matches the newest month: $1,744.00,000.
    expect(await screen.findByTestId('live-net-worth')).toHaveTextContent(
      '$1,744,000.00',
    )

    // +$10,000.00 of VFIAX.
    fireEvent.change(screen.getByLabelText('Account'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '710,000' },
    })
    expect(screen.getByTestId('live-net-worth')).toHaveTextContent(
      '$1,754,000.00',
    )
  })

  it('treats a liability draft as negative in the live net worth', async () => {
    render(<Ledger />)

    // Paying the mortgage down from $150,000.00 to $140,000.00 adds $10.00,000.
    fireEvent.change(await screen.findByLabelText('Account'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '140,000' },
    })
    expect(screen.getByTestId('live-net-worth')).toHaveTextContent(
      '$1,754,000.00',
    )
  })

  it('shows an as-of date input defaulting to today', async () => {
    render(<Ledger />)

    const today = new Date().toLocaleDateString('en-CA')
    expect(await screen.findByLabelText('As of')).toHaveValue(today)
  })

  it('keeps the chosen date across account switches', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('As of'), {
      target: { value: '2025-07-01' },
    })
    fireEvent.change(screen.getByLabelText('Account'), {
      target: { value: '2' },
    })
    expect(screen.getByLabelText('As of')).toHaveValue('2025-07-01')
  })
})

describe('Responsive layout', () => {
  beforeEach(() => {
    stubApi({
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
    })
  })

  it('stacks the table and form into one column on narrow screens', async () => {
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    expect(screen.getByTestId('view-ledger')).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-[1.6fr_1fr]',
    )
  })

  it('gives the table the extra width beside a fixed form column on wide screens', async () => {
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    expect(screen.getByTestId('view-ledger')).toHaveClass(
      '2xl:grid-cols-[1fr_440px]',
    )
  })

  it('stacks the ETH quantity and price grid on narrow screens', async () => {
    render(<Ledger />)

    const eth = (await screen.findByLabelText('ETH held')).closest('.grid')
    expect(eth).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })
})

describe('Saving balances', () => {
  let routes: Record<string, unknown>
  let fetchMock: ReturnType<typeof stubApi>

  beforeEach(() => {
    routes = {
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
      '/api/balance-entries': { id: 999 },
    }
    fetchMock = stubApi(routes)
  })

  it('appends one entry for the selected USD account, dated today, on save', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('Account'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '710,000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save balance' }))

    expect(
      await screen.findByRole('button', { name: 'Saved ✓' }),
    ).toBeInTheDocument()
    const today = new Date().toLocaleDateString('en-CA')
    const bodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown)
    expect(bodies).toEqual([
      { account_id: 2, as_of_date: today, balance_usd: 710000 },
    ])
  })

  it('posts the chosen as-of date when backdated', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('Account'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Value'), {
      target: { value: '650,000' },
    })
    fireEvent.change(screen.getByLabelText('As of'), {
      target: { value: '2025-07-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save balance' }))

    expect(
      await screen.findByRole('button', { name: 'Saved ✓' }),
    ).toBeInTheDocument()
    const bodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown)
    expect(bodies).toEqual([
      { account_id: 2, as_of_date: '2025-07-01', balance_usd: 650000 },
    ])
  })

  it('appends a quantity and price entry for the ETH account', async () => {
    render(<Ledger />)

    fireEvent.change(await screen.findByLabelText('ETH held'), {
      target: { value: '21' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save balance' }))

    expect(
      await screen.findByRole('button', { name: 'Saved ✓' }),
    ).toBeInTheDocument()
    const today = new Date().toLocaleDateString('en-CA')
    const bodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown)
    expect(bodies).toEqual([
      { account_id: 1, as_of_date: today, quantity: 21, unit_price: 3500 },
    ])
  })

  it('refreshes the table so the appended month row appears', async () => {
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    // The server now has a July entry; saving should refetch and show it.
    routes['/api/ledger'] = ledgerPage([
      {
        month: '2026-07',
        net_worth: 1_754_000,
        balances: [
          balance(1, '2026-07-04', 73_500, 21, 3_500),
          balance(2, '2026-07-04', 710_000),
        ],
      },
      ...LEDGER,
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Save balance' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('ledger-row')).toHaveLength(3),
    )
    expect(screen.getAllByTestId('ledger-row')[0]).toHaveTextContent(
      'July 2026',
    )
  })
})

describe('Quick links card', () => {
  it('renders each link below the balance form, opening in a new tab', async () => {
    stubApi({
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': QUICK_LINKS,
    })
    render(<Ledger />)

    const card = await screen.findByTestId('quick-links')
    const links = within(card).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Chase', 'Vanguard'])
    expect(links[0]).toHaveAttribute(
      'href',
      'https://bank.example.com/accounts',
    )
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('is hidden while no links exist', async () => {
    stubApi({
      '/api/accounts': ACCOUNTS,
      '/api/ledger': LEDGER_PAGE,
      '/api/quick-links': [],
    })
    render(<Ledger />)

    await screen.findByRole('table')
    expect(screen.queryByTestId('quick-links')).not.toBeInTheDocument()
  })
})

// The table holds the twelve newest months; older ones arrive a page at a
// time as the sentinel row below the table scrolls into view. The fixture
// page says has_more, so two more months sit behind the 2026-05 cursor.
describe('Older months', () => {
  const OLDER = [
    {
      month: '2026-04',
      net_worth: 1_690_000,
      balances: [balance(1, '2026-04-01', 66_000, 20, 3_300)],
    },
    {
      month: '2026-03',
      net_worth: 1_670_000,
      balances: [balance(1, '2026-03-01', 64_000, 20, 3_200)],
    },
  ]

  const routes = () => ({
    '/api/accounts': ACCOUNTS,
    '/api/ledger': ledgerPage(LEDGER, true),
    '/api/ledger?before=2026-05': ledgerPage(OLDER),
    '/api/quick-links': [],
  })

  it('appends the next page when the sentinel scrolls into view', async () => {
    const fetchMock = stubApi(routes())
    const observer = stubIntersectionObserver()
    render(<Ledger />)
    expect(await screen.findAllByTestId('ledger-row')).toHaveLength(2)

    act(() => observer.trigger())

    await waitFor(() =>
      expect(screen.getAllByTestId('ledger-row')).toHaveLength(4),
    )
    const rows = screen.getAllByTestId('ledger-row')
    expect(rows[2]).toHaveTextContent('April 2026')
    expect(rows[3]).toHaveTextContent('March 2026')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      '/api/ledger?before=2026-05',
    )
  })

  it('keeps the newest-month highlight on the first row', async () => {
    stubApi(routes())
    const observer = stubIntersectionObserver()
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    act(() => observer.trigger())

    await waitFor(() =>
      expect(screen.getAllByTestId('ledger-row')).toHaveLength(4),
    )
    const rows = screen.getAllByTestId('ledger-row')
    expect(rows[0]).toHaveClass('bg-[#f3f6f3]')
    expect(rows[2]).not.toHaveClass('bg-[#f3f6f3]')
  })

  it('stops once the oldest month has been reached', async () => {
    stubApi(routes())
    const observer = stubIntersectionObserver()
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')
    expect(screen.getByTestId('ledger-sentinel')).toBeInTheDocument()

    act(() => observer.trigger())

    await waitFor(() =>
      expect(screen.getAllByTestId('ledger-row')).toHaveLength(4),
    )
    expect(screen.queryByTestId('ledger-sentinel')).not.toBeInTheDocument()
  })

  it('renders no sentinel when the first page is the whole history', async () => {
    stubApi({ ...routes(), '/api/ledger': ledgerPage(LEDGER) })
    stubIntersectionObserver()
    render(<Ledger />)

    await screen.findAllByTestId('ledger-row')
    expect(screen.queryByTestId('ledger-sentinel')).not.toBeInTheDocument()
  })

  it('shows a loading row and asks for one page at a time', async () => {
    const inner = stubApi(routes())
    let release = () => {}
    const inFlight = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('before=')) await inFlight
      return inner(input, init)
    })
    const observer = stubIntersectionObserver()
    render(<Ledger />)
    await screen.findAllByTestId('ledger-row')

    act(() => observer.trigger())
    act(() => observer.trigger())

    expect(
      await screen.findByText('Loading older months…'),
    ).toBeInTheDocument()
    release()
    await waitFor(() =>
      expect(screen.getAllByTestId('ledger-row')).toHaveLength(4),
    )
    expect(screen.queryByText('Loading older months…')).not.toBeInTheDocument()
    expect(
      inner.mock.calls.filter(([url]) =>
        String(url).includes('before=2026-05'),
      ),
    ).toHaveLength(1)
  })
})
