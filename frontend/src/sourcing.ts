// Display derivations for the Withdrawal sourcing screen. All financial
// math comes from GET /api/sourcing — these helpers only turn the
// engine's waterfall into row copy.

import type { Account, SourcingStep } from './api.ts'
import { formatUsd } from './ledger.ts'

// Sourcing — and the forecast, which reuses its buckets — draws only
// from active assets with a withdrawal priority; without one, the
// engines stay null whatever the config and balances say.
export function hasWithdrawalBuckets(accounts: Account[]): boolean {
  return accounts.some(
    (account) =>
      account.active &&
      !account.is_liability &&
      account.withdrawal_priority != null,
  )
}

// Gate ages read the way people say them: 59.5 is "59½", 65 is "65".
// Only the half is spelled — no other fraction is a real access age.
export function formatGateAge(age: number): string {
  const whole = Math.floor(age)
  return age - whole === 0.5 ? `${whole}½` : String(age)
}

const MARKERS = ['①', '②', '③']

export function stepMarker(index: number): string {
  return MARKERS[index] ?? `${index + 1}`
}

// Capital-gains buckets hold positions to sell; a 401(k) or an HSA is
// withdrawn — there is nothing to realise, and "sell your HSA" reads as
// a mistake.
export function stepAction(step: SourcingStep): string {
  return step.treatment === 'LTCG' ? 'sell' : 'withdraw'
}

// Whether the waterfall holds a tier at all, and the gate that tier
// reports. A step is named for its tier plus any owner or treatment
// suffix, so "401(k) · you" belongs to the 401(k) tier; the first
// gated step wins, and the waterfall is already ordered by the money
// that unlocks soonest.
function tierSteps(steps: SourcingStep[], tier: string): SourcingStep[] {
  return steps.filter(
    (step) => step.name === tier || step.name.startsWith(`${tier} · `),
  )
}

export function hasTier(steps: SourcingStep[], tier: string): boolean {
  return tierSteps(steps, tier).length > 0
}

export function tierGateAge(steps: SourcingStep[], tier: string): number | null {
  return tierSteps(steps, tier).find((step) => step.access_age != null)?.access_age ?? null
}

// The sub-line for a waterfall step: the engine's gate note wins, an
// untouched bucket is "$0.00 this yr", a taxed draw shows its cost, and a
// tax-free sale names the headroom that made it free.
export function stepDetail(step: SourcingStep, headroom: number): string {
  if (step.note) {
    return step.note
  }
  if (step.gross === 0) {
    return '$0.00 this yr'
  }
  if (step.tax > 0) {
    return `tax ${formatUsd(step.tax)} → nets ${formatUsd(step.net)}`
  }
  if (step.treatment === 'LTCG') {
    return `within ${formatUsd(headroom)} headroom · tax-free`
  }
  return 'tax-free'
}
