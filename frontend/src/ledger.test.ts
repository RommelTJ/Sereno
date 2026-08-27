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
  const subtotal = columns.findIndex((column) => column.kind === 'subtotal')

  it('sums the brokerage funds into the subtotal column', () => {
    const rows = ledgerRows(LEDGER, columns)
    expect(rows[0].values[subtotal]).toBe(1_080_000)
    expect(rows[1].values[subtotal]).toBe(1_064_000)
  })
})
