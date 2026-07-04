// Shared API fixtures. Accounts mirror the seed dimension rows: table
// columns map by kind, except the three brokerage funds, which map by name.

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

export const balance = (
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
