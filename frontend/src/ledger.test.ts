// The app-wide money formatter: every dollar figure shows exact cents,
// two decimals always — "$2,400.00" and "$28.40" align in the same
// column, and a balance's displayed cents are the cents actually stored
// (whole-dollar rounding hid the #112 drift). Negative amounts keep the
// sign outside the dollar sign: "-$1,234.56".

import { describe, expect, it } from 'vitest'
import { formatUsd } from './ledger.ts'

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
