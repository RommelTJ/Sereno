// The app-wide money formatter: every dollar figure shows exact cents,
// two decimals always — "$2,400.00" and "$28.40" align in the same
// column, and a balance's displayed cents are the cents actually stored
// (whole-dollar rounding hid the #112 drift). Negative amounts keep the
// sign outside the dollar sign: "-$1,234.56".

import { describe, expect, it } from 'vitest'
import type { LedgerColumn } from './ledger.ts'
import {
  draftFor,
  formatAmount,
  formatQty,
  formatUsd,
  ledgerRows,
  ledgerTableColumns,
} from './ledger.ts'
import {
  ACCOUNTS,
  LEDGER,
  UNCLASSIFIED_ACCOUNTS,
  balance,
} from './test/fixtures.ts'

describe('formatUsd', () => {
  it('shows exact cents', () => {
    expect(formatUsd(99.33)).toBe('$99.33')
  })

  it('gives whole dollars two decimals so columns align', () => {
    expect(formatUsd(2400)).toBe('$2,400.00')
  })

  it('keeps the sign outside the dollar sign', () => {
    expect(formatUsd(-1234.56)).toBe('-$1,234.56')
  })

  it('shows zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})

// The balance form's seeds: money round-trips exact cents ("99.30",
// never "99.3"), and the ETH quantity is not money — it seeds at five
// decimals, so a fractional holding survives a prefill-and-save intact.
describe('formatAmount', () => {
  it('seeds money with exact cents', () => {
    expect(formatAmount(99.3)).toBe('99.30')
  })

  it('gives whole dollars two decimals', () => {
    expect(formatAmount(2400)).toBe('2,400.00')
  })
})

describe('formatQty', () => {
  it('keeps five decimals as typed', () => {
    expect(formatQty(3.14159)).toBe('3.14159')
  })

  it('pads shorter quantities to five decimals', () => {
    expect(formatQty(12.3456)).toBe('12.34560')
    expect(formatQty(20)).toBe('20.00000')
  })
})

describe('draftFor', () => {
  const [eth, vfiax] = ACCOUNTS

  it('seeds a USD account value with two decimals', () => {
    expect(draftFor(vfiax, LEDGER, ACCOUNTS).value).toBe('700,000.00')
  })

  it('seeds the ETH price with two decimals', () => {
    expect(draftFor(eth, LEDGER, ACCOUNTS).price).toBe('3,500.00')
  })

  it('seeds a whole ETH quantity at five decimals', () => {
    expect(draftFor(eth, LEDGER, ACCOUNTS).qty).toBe('20.00000')
  })

  it('never money-rounds a fractional ETH quantity', () => {
    const months = [
      {
        month: '2026-06',
        net_worth: 43_218,
        balances: [balance(1, '2026-06-01', 43_218, 12.3456, 3_500.75)],
      },
    ]
    expect(draftFor(eth, months, ACCOUNTS).qty).toBe('12.34560')
  })
})

// The table's columns: one per active account, plus the brokerage
// subtotal derived from the three funds. Its members come from the
// kind, never the fund names, so a fourth fund joins on its own.
const label = (column: LedgerColumn) =>
  column.kind === 'account' ? column.account.name : column.label

describe('ledgerTableColumns', () => {
  it('adds a Brokerage subtotal directly after the last brokerage fund', () => {
    expect(ledgerTableColumns(ACCOUNTS).map(label)).toEqual([
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
    ])
  })

  it('takes its members from the kind, so a fourth fund joins it', () => {
    const vbtlx = { ...ACCOUNTS[1], id: 11, name: 'VBTLX' }
    const columns = ledgerTableColumns([
      ...ACCOUNTS.slice(0, 4),
      vbtlx,
      ...ACCOUNTS.slice(4),
    ])
    const subtotal = columns.find((column) => column.kind === 'subtotal')

    expect(columns.map(label).indexOf('Brokerage')).toBe(5)
    expect(subtotal?.kind === 'subtotal' && subtotal.accountIds).toEqual([
      2, 3, 4, 11,
    ])
  })

  it('subtotals a lone brokerage fund', () => {
    const columns = ledgerTableColumns([ACCOUNTS[1], ACCOUNTS[6]])
    expect(columns.map(label)).toEqual(['VFIAX', 'Brokerage', 'Chase checking'])
  })

  it('gives a fresh install no subtotal column', () => {
    expect(ledgerTableColumns(UNCLASSIFIED_ACCOUNTS).map(label)).not.toContain(
      'Brokerage',
    )
  })
})

describe('ledgerRows', () => {
  const columns = ledgerTableColumns(ACCOUNTS)
  const at = (name: string) => columns.map(label).indexOf(name)
  const subtotal = at('Brokerage')

  const month = (key: string, entries: [number, number][]) => ({
    month: key,
    net_worth: 0,
    balances: entries.map(([id, usd]) => balance(id, `${key}-01`, usd)),
  })

  it('sums the brokerage funds into the subtotal column', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[0].values[subtotal]).toBe(1_080_000)
    expect(rows[1].values[subtotal]).toBe(1_064_000)
  })

  // The delta is the number that answers "is this going the right way",
  // and it is taken on the displayed figure — after the liability sign
  // flip — so one rule covers an asset that grew and a debt that shrank.
  it('gives each cell the change from the previous month', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[0].deltas[at('Ethereum')]).toBe(2_000)
    expect(rows[0].deltas[at('VFIAX')]).toBe(10_000)
    expect(rows[0].deltas[at('Chase checking')]).toBe(2_000)
  })

  it('reads a paid-down mortgage as a favorable rise', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[0].values[at('Mortgage')]).toBe(-150_000)
    expect(rows[0].deltas[at('Mortgage')]).toBe(700)
  })

  it('leaves the oldest row without deltas', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[1].deltas.every((delta) => delta === null)).toBe(true)
  })

  it('shows a carried-forward balance as no change, not as no data', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[0].deltas[at('Vanguard Cash Plus')]).toBe(0)
  })

  it('suppresses the delta where the account had no entry last month', () => {
    const months = [
      month('2026-06', [
        [7, 9_000],
        [2, 700_000],
      ]),
      month('2026-05', [[7, 7_000]]),
    ]
    const rows = ledgerRows(months, columns)
    expect(rows[0].deltas[at('VFIAX')]).toBeNull()
    expect(rows[0].deltas[at('Chase checking')]).toBe(2_000)
  })

  it('rounds a sub-cent float residue to no change', () => {
    const months = [
      month('2026-06', [[7, 0.1 + 0.2]]),
      month('2026-05', [[7, 0.3]]),
    ]
    expect(ledgerRows(months, columns)[0].deltas[at('Chase checking')]).toBe(0)
  })

  it('sums the member deltas into the subtotal delta', () => {
    expect(ledgerRows(LEDGER, columns)[0].deltas[subtotal]).toBe(16_000)
  })

  it('carries the net worth column its own delta', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[0].netWorthDelta).toBe(26_700)
    expect(rows[1].netWorthDelta).toBeNull()
  })

  it('suppresses the subtotal delta when a member is new', () => {
    const months = [
      month('2026-06', [
        [2, 700_000],
        [3, 250_000],
        [4, 130_000],
      ]),
      month('2026-05', [
        [2, 690_000],
        [3, 246_000],
      ]),
    ]
    const rows = ledgerRows(months, columns)
    expect(rows[0].values[subtotal]).toBe(1_080_000)
    expect(rows[0].deltas[subtotal]).toBeNull()
  })
})
