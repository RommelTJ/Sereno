// The app-wide money formatter: every dollar figure shows exact cents,
// two decimals always — "$2,400.00" and "$28.40" align in the same
// column, and a balance's displayed cents are the cents actually stored
// (whole-dollar rounding hid the #112 drift). Negative amounts keep the
// sign outside the dollar sign: "-$1,234.56".

import { describe, expect, it } from 'vitest'
import { draftFor, formatAmount, formatUsd } from './ledger.ts'
import { ACCOUNTS, LEDGER, balance } from './test/fixtures.ts'

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
