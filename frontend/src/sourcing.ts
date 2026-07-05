// Display derivations for the Withdrawal sourcing screen. All financial
// math comes from GET /api/sourcing — these helpers only turn the
// engine's waterfall into row copy.

import type { SourcingStep } from './api.ts'
import { formatUsd } from './ledger.ts'

const MARKERS = ['①', '②', '③']

export function stepMarker(index: number): string {
  return MARKERS[index] ?? `${index + 1}`
}

// LTCG buckets are sold; ordinary buckets are withdrawn.
export function stepAction(step: SourcingStep): string {
  return step.treatment === 'ORDINARY' ? 'withdraw' : 'sell'
}

// The sub-line for a waterfall step: the engine's gate note wins, an
// untouched bucket is "$0 this yr", a taxed draw shows its cost, and a
// tax-free sale names the headroom that made it free.
export function stepDetail(step: SourcingStep, headroom: number): string {
  if (step.note) {
    return step.note
  }
  if (step.gross === 0) {
    return '$0 this yr'
  }
  if (step.tax > 0) {
    return `tax ${formatUsd(step.tax)} → nets ${formatUsd(step.net)}`
  }
  if (step.treatment === 'LTCG') {
    return `within ${formatUsd(headroom)} headroom · tax-free`
  }
  return 'tax-free'
}
