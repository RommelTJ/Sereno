// Display derivations for the Mortgage screen. The backend does the
// amortization; these turn its numbers into the sentences the card reads
// as. Escrow is deliberately kept out of the payment that ends — it
// survives payoff — and every line that has nothing to say returns null
// so the card renders one fewer row rather than an empty one.

import { describe, expect, it } from 'vitest'
import {
  escrowLine,
  payoffLine,
  paymentLine,
  remainingTerm,
  savingsLine,
  termsLine,
} from './mortgage.ts'

const TERMS = {
  id: 1,
  effective_date: '2026-01-01',
  account_id: 10,
  annual_rate: 0.03,
  monthly_pi: 1075,
  monthly_extra: 200,
  monthly_escrow: 450,
}

const DERIVED = {
  balance: 150_000,
  balance_as_of: '2026-06-30',
  payoff_date: '2038-02-01',
  payoff_age: 50,
  remaining_months: 140,
  remaining_interest: 27_858.77,
  months_saved: 32,
  interest_saved: 6840.04,
  payment_real_at_payoff: 903.11,
}

describe('termsLine', () => {
  it('reads the rate and the payment it is split into', () => {
    expect(termsLine(TERMS)).toBe('3.00% · $1,075.00 P&I + $200.00 extra')
  })

  it('drops the extra when none is being paid', () => {
    expect(termsLine({ ...TERMS, monthly_extra: 0 })).toBe(
      '3.00% · $1,075.00 P&I',
    )
  })
})

describe('payoffLine', () => {
  it('names the month of the last payment and the age then', () => {
    expect(payoffLine(DERIVED)).toBe('February 2038 (age 50)')
  })

  it('reads the payoff month, never the balance date it counted from', () => {
    // The day in payoff_date is an artifact of counting months; showing
    // it would imply a precision the schedule does not have.
    expect(payoffLine(DERIVED)).not.toContain('1')
  })
})

describe('remainingTerm', () => {
  it('splits months into years and months', () => {
    expect(remainingTerm(140)).toBe('11 yr 8 mo')
  })

  it('drops the years under a year', () => {
    expect(remainingTerm(8)).toBe('8 mo')
  })

  it('drops the months on a whole number of years', () => {
    expect(remainingTerm(36)).toBe('3 yr')
  })

  it('still says something at zero', () => {
    expect(remainingTerm(0)).toBe('0 mo')
  })
})

describe('savingsLine', () => {
  it('prices what the extra principal buys', () => {
    expect(savingsLine(DERIVED)).toBe(
      'Extra principal saves 32 months and $6,840.04 of interest',
    )
  })

  it('says nothing when no extra is being paid', () => {
    expect(savingsLine({ ...DERIVED, months_saved: 0, interest_saved: 0 })).toBe(
      null,
    )
  })

  it('says nothing when there is no baseline to measure against', () => {
    expect(
      savingsLine({ ...DERIVED, months_saved: null, interest_saved: null }),
    ).toBe(null)
  })
})

describe('paymentLine', () => {
  it('sets what the payment costs today against what it costs at payoff', () => {
    expect(paymentLine(TERMS, DERIVED)).toBe(
      '$1,275.00/mo today · $903.11/mo real at payoff',
    )
  })

  it('leaves escrow out of the payment that ends', () => {
    // $1,275 is P&I plus extra. Adding the $450 escrow would claim a
    // third more relief than payoff actually delivers.
    expect(paymentLine(TERMS, DERIVED)).toContain('$1,275.00/mo today')
    expect(paymentLine(TERMS, DERIVED)).not.toContain('$1,725.00')
  })

  it('drops the real half without an inflation assumption', () => {
    expect(paymentLine(TERMS, { ...DERIVED, payment_real_at_payoff: null })).toBe(
      '$1,275.00/mo today',
    )
  })
})

describe('escrowLine', () => {
  it('says the escrow outlives the payoff', () => {
    expect(escrowLine(TERMS)).toBe(
      'Escrow ($450.00/mo) continues after payoff',
    )
  })

  it('says nothing when the payment carries no escrow', () => {
    expect(escrowLine({ ...TERMS, monthly_escrow: 0 })).toBe(null)
  })
})
