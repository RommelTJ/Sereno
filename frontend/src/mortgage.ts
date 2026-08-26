// Display derivations for the Mortgage screen. The backend solves the
// schedule; these turn its numbers into the sentences the card reads as.
//
// Escrow is deliberately absent from the payment that ends. Property tax
// and insurance survive payoff, so quoting the full payment as the relief
// would overstate it by the escrow share — the one fact the old
// undifferentiated budget line lost. A line with nothing to say returns
// null, so the card renders one fewer row rather than an empty one.

import type { Mortgage, MortgageDerived } from './api.ts'
import { formatRate } from './guardrails.ts'
import { formatMonth, formatUsd } from './ledger.ts'

// Both mortgage surfaces — the Plan card and the Settings row — show
// the rate the same way: two decimals, trailing zeros kept, so 3.00%
// and 3.25% align. Same shape as a withdrawal rate, so same helper.
export const formatMortgageRate = formatRate

// The payment that stops at payoff: principal & interest plus whatever
// extra principal is riding along. Never escrow.
export function monthlyPayment(mortgage: Mortgage): number {
  return mortgage.monthly_pi + mortgage.monthly_extra
}

export function termsLine(mortgage: Mortgage): string {
  const pi = `${formatRate(mortgage.annual_rate)} · ${formatUsd(mortgage.monthly_pi)} P&I`
  return mortgage.monthly_extra > 0
    ? `${pi} + ${formatUsd(mortgage.monthly_extra)} extra`
    : pi
}

export function payoffLine(derived: MortgageDerived): string {
  // The day in payoff_date is an artifact of counting whole months, so
  // only its month is shown — the schedule is not precise to the day.
  const month = formatMonth(derived.payoff_date.slice(0, 7))
  return `${month} (age ${derived.payoff_age})`
}

export function remainingTerm(months: number): string {
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) {
    return `${rest} mo`
  }
  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`
}

export function savingsLine(derived: MortgageDerived): string | null {
  const { months_saved: months, interest_saved: interest } = derived
  if (months == null || interest == null || months === 0) {
    return null
  }
  return `Extra principal saves ${months} months and ${formatUsd(interest)} of interest`
}

export function paymentLine(
  mortgage: Mortgage,
  derived: MortgageDerived,
): string {
  const today = `${formatUsd(monthlyPayment(mortgage))}/mo today`
  const real = derived.payment_real_at_payoff
  return real == null
    ? today
    : `${today} · ${formatUsd(real)}/mo real at payoff`
}

export function escrowLine(mortgage: Mortgage): string | null {
  return mortgage.monthly_escrow > 0
    ? `Escrow (${formatUsd(mortgage.monthly_escrow)}/mo) continues after payoff`
    : null
}
