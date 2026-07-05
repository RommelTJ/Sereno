// Shared API fixtures. Accounts mirror the seed dimension rows: table
// columns map by kind, except the three brokerage funds, which map by name.

import type { Forecast, Sourcing } from '../api.ts'

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

// Exactly as GET /api/net-worth returns it: last-12-months series (oldest
// first), current = newest month, yoy vs. the same month a year earlier.
export const NET_WORTH = {
  current: 1_744_000,
  yoy: 0.057,
  series: [
    { month: '2025-07', net_worth: 1_480_000 },
    { month: '2025-08', net_worth: 1_505_000 },
    { month: '2025-09', net_worth: 1_530_000 },
    { month: '2025-10', net_worth: 1_552_000 },
    { month: '2025-11', net_worth: 1_575_000 },
    { month: '2025-12', net_worth: 1_600_000 },
    { month: '2026-01', net_worth: 1_622_000 },
    { month: '2026-02', net_worth: 1_648_000 },
    { month: '2026-03', net_worth: 1_672_000 },
    { month: '2026-04', net_worth: 1_695_000 },
    { month: '2026-05', net_worth: 1_717_300 },
    { month: '2026-06', net_worth: 1_744_000 },
  ],
}

// Exactly as GET /api/budget-month returns June 2026: baseline = the month's
// stored funding, safe_to_spend = baseline − total_spent. Entertainment is
// over budget; Travel has no plan yet (planned 0).
export const BUDGET_MONTH = {
  month: '2026-06',
  baseline: 5_200,
  total_spent: 1_530,
  safe_to_spend: 3_670,
  categories: [
    {
      id: 1,
      name: 'Groceries',
      emoji: '🛒',
      planned: 500,
      spent: 387,
      remaining: 113,
    },
    { id: 2, name: 'Gas', emoji: '🛢️', planned: 100, spent: 64, remaining: 36 },
    {
      id: 3,
      name: 'Entertainment',
      emoji: '🤪',
      planned: 500,
      spent: 546,
      remaining: -46,
    },
    { id: 4, name: 'Travel', emoji: '✈️', planned: 0, spent: 0, remaining: 0 },
  ],
  activity: [
    {
      type: 'expense',
      id: 5,
      txn_date: '2026-06-26',
      amount: 28.4,
      category: 'Entertainment',
      source: null,
      note: 'Poke — treat yourself',
    },
    {
      type: 'expense',
      id: 3,
      txn_date: '2026-06-10',
      amount: 387,
      category: 'Groceries',
      source: null,
      note: null,
    },
    {
      type: 'income',
      id: 2,
      txn_date: '2026-05-27',
      amount: 2_400,
      category: null,
      source: 'paycheck',
      note: 'Spouse paycheck',
    },
  ],
}

// Active funds, exactly as GET /api/funds returns them: dimension rows plus
// the latest fund_entry balance and the server-derived note. The Bike fund
// is fully funded; the Travel fund is open-ended (no target).
export const FUNDS = [
  {
    id: 1,
    name: 'Emergency fund',
    kind: 'sinking',
    target_amount: 30_000,
    target_date: null,
    monthly_plan: 500,
    balance: 10_000,
    note: '$500 / mo · ~3.3 yrs to target',
  },
  {
    id: 2,
    name: 'Bike fund',
    kind: 'goal',
    target_amount: 10_000,
    target_date: '2026-07-01',
    monthly_plan: null,
    balance: 10_000,
    note: '✓ fully funded — ready to spend',
  },
  {
    id: 3,
    name: 'Travel fund',
    kind: 'sinking',
    target_amount: null,
    target_date: null,
    monthly_plan: 300,
    balance: 4_200,
    note: '$300 / mo · open-ended',
  },
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

// Planning config, exactly as the config GETs resolve it: the effective
// row (latest effective_date on or before today). Values mirror the seed —
// sanitized handoff placeholders, never real finances.
export const ASSUMPTION = {
  id: 1,
  effective_date: '2026-01-01',
  return_pct: 7,
  inflation_pct: 3,
  eth_growth_pct: null,
}

export const SPEND_PLAN = {
  id: 1,
  effective_date: '2026-01-01',
  annual_target: 45_000,
  initial_rate: 0.0294,
  guardrail_band: 0.2,
}

// GET /api/guardrails evaluated at the plan's annual target: June's
// 1.5M investable at $45,000/yr is a 3.00% rate, inside the ±20% band
// around the 2.94% anchor.
export const GUARDRAILS = {
  investable: 1_500_000,
  spend: 45_000,
  annual_target: 45_000,
  rate: 0.03,
  initial_rate: 0.0294,
  band: 0.2,
  lower: 0.02352,
  upper: 0.03528,
  zone: 'hold',
  raise_trigger: 1_913_265.31,
  cut_trigger: 1_275_510.2,
  four_percent_spend: 60_000,
}

// GET /api/social-security resolves the latest row per person, 'you' first.
export const SOCIAL_SECURITY = [
  {
    id: 1,
    person: 'you',
    effective_date: '2026-01-01',
    start_age: 67,
    monthly_amount: 1_500,
  },
  {
    id: 2,
    person: 'spouse',
    effective_date: '2026-01-01',
    start_age: 67,
    monthly_amount: 1_400,
  },
]

// GET /api/tax-params returns every year ascending, brackets parsed.
export const TAX_PARAMS = [
  {
    tax_year: 2026,
    filing_status: 'MFJ',
    ltcg_0_ceiling: 96_700,
    ltcg_15_ceiling: 600_050,
    niit_rate: 0.038,
    niit_threshold: 250_000,
    state_treatment: 'CA_ordinary',
    std_deduction: 30_000,
    ordinary_brackets: [
      { rate: 0.1, upto: 24_800 },
      { rate: 0.12, upto: 100_800 },
      { rate: 0.22, upto: 211_400 },
      { rate: 0.24, upto: null },
    ],
  },
]

// GET /api/forecast with the seeded config: a flat 1.6M across the
// buckets at $45,000/yr that never runs out, Social Security joining
// at 67. Flat balances keep chart heights easy to reason about.
export const FORECAST: Forecast = {
  spend: 45_000,
  annual_target: 45_000,
  return_pct: 7,
  inflation_pct: 3,
  ss_you: 1_500,
  ss_spouse: 1_400,
  ss_start: 67,
  tax_year: 2026,
  series: Array.from({ length: 95 - 38 + 1 }, (_, i) => ({
    age: 38 + i,
    eth: 200_000,
    brokerage: 800_000,
    retirement: 600_000,
    ss_income: 38 + i >= 67 ? 34_800 : 0,
  })),
  run_out_age: null,
  balance_at_90: 5_512_345,
  sensitivity: [
    { spend: 30_000, run_out_age: null, balance_at_90: 7_200_000 },
    { spend: 45_000, run_out_age: null, balance_at_90: 5_512_345 },
    { spend: 60_000, run_out_age: null, balance_at_90: 3_100_000 },
    { spend: 75_000, run_out_age: 92, balance_at_90: 350_000 },
    { spend: 90_000, run_out_age: 71, balance_at_90: 0 },
  ],
}

// GET /api/sourcing at age 38: staking is the only income, the whole
// gap fits ETH's 0% headroom, and the 401(k) reports its gate.
export const SOURCING: Sourcing = {
  target_net: 45_000,
  annual_target: 45_000,
  age: 38,
  tax_year: 2026,
  ss_income: 0,
  staking_income: 3_000,
  income: 3_000,
  gap: 42_000,
  headroom: 96_700,
  steps: [
    {
      name: 'ETH',
      treatment: 'LTCG',
      gross: 42_000,
      tax: 0,
      net: 42_000,
      note: null,
    },
    {
      name: 'Brokerage',
      treatment: 'LTCG',
      gross: 0,
      tax: 0,
      net: 0,
      note: null,
    },
    {
      name: '401(k)',
      treatment: 'ORDINARY',
      gross: 0,
      tax: 0,
      net: 0,
      note: 'locked until age 59.5',
    },
  ],
  net_delivered: 45_000,
  shortfall: 0,
}
