import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { stubApi } from '../test/stubs.ts'
import Ledger from './Ledger.tsx'

// Accounts mirror the seed dimension rows: columns map by kind, except the
// three brokerage funds, which map by name.
const account = (
  id: number,
  name: string,
  kind: string,
  overrides: Partial<{ is_liability: boolean; is_investable: boolean }> = {},
) => ({
  id,
  name,
  kind,
  tax_treatment: 'NONE',
  owner: null,
  is_liability: false,
  is_investable: false,
  active: true,
  ...overrides,
})

export const ACCOUNTS = [
  account(1, 'Ethereum', 'eth', { is_investable: true }),
  account(2, 'VFIAX', 'brokerage_fund', { is_investable: true }),
  account(3, 'VTIAX', 'brokerage_fund', { is_investable: true }),
  account(4, 'VGSH', 'brokerage_fund', { is_investable: true }),
  account(5, 'Retirement', '401k', { is_investable: true }),
  account(6, 'Home', 'home'),
  account(7, 'Chase checking', 'cash'),
  account(8, 'Vanguard Cash Plus', 'cash_plus'),
  account(9, 'Car', 'car'),
  account(10, 'Mortgage', 'mortgage', { is_liability: true }),
]

const balance = (
  account_id: number,
  as_of_date: string,
  balance_usd: number,
  quantity: number | null = null,
  unit_price: number | null = null,
) => ({ account_id, as_of_date, balance_usd, quantity, unit_price })

// Two months, newest first, exactly as GET /api/ledger returns them.
// Liability balances (Mortgage) are positive, as stored.
// June net worth = 70k+700k+250k+130k+350k+350k+9k+20k+15k − 150k = 1,744,000.
export const LEDGER = [
  {
    month: '2026-06',
    net_worth: 1_744_000,
    balances: [
      balance(1, '2026-06-01', 70_000, 20, 3_500),
      balance(2, '2026-06-01', 700_000),
      balance(3, '2026-06-01', 250_000),
      balance(4, '2026-06-01', 130_000),
      balance(5, '2026-06-01', 350_000),
      balance(6, '2026-06-01', 350_000),
      balance(7, '2026-06-01', 9_000),
      balance(8, '2026-06-01', 20_000),
      balance(9, '2026-06-01', 15_000),
      balance(10, '2026-06-01', 150_000),
    ],
  },
  {
    month: '2026-05',
    net_worth: 1_717_300,
    balances: [
      balance(1, '2026-05-01', 68_000, 20, 3_400),
      balance(2, '2026-05-01', 690_000),
      balance(3, '2026-05-01', 246_000),
      balance(4, '2026-05-01', 128_000),
      balance(5, '2026-05-01', 345_000),
      balance(6, '2026-05-01', 349_000),
      balance(7, '2026-05-01', 7_000),
      balance(8, '2026-05-01', 20_000),
      balance(9, '2026-05-01', 15_000),
      balance(10, '2026-05-01', 150_700),
    ],
  },
]

describe('Ledger monthly balance table', () => {
  beforeEach(() => {
    stubApi({ '/api/accounts': ACCOUNTS, '/api/ledger': LEDGER })
  })

  it('renders a column per handoff account plus Date and Net worth', async () => {
    render(<Ledger />)

    expect(await screen.findByRole('table')).toBeInTheDocument()
    for (const name of [
      'Date',
      'ETH',
      'VFIAX',
      'VTIAX',
      'VGSH',
      'Retire',
      'Home',
      'Cash',
      'Mortgage',
      'Net worth',
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
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

  it('sums the cash and cash-plus accounts into the single Cash column', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('$29,000')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$27,000')).toBeInTheDocument()
  })

  it('shows the mortgage as a negative figure', async () => {
    render(<Ledger />)

    const rows = await screen.findAllByTestId('ledger-row')
    expect(within(rows[0]).getByText('-$150,000')).toBeInTheDocument()
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
