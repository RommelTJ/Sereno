// Display derivations for the Guardrails screen and the Dashboard card.
// All financial math comes from GET /api/guardrails — these helpers only
// turn the engine's numbers into marker positions, slider bounds, and
// copy. The Zone type lives here so the api layer and both views share
// one definition.

import type { Account } from './api.ts'
import { formatUsd } from './ledger.ts'

export type Zone = 'cut' | 'hold' | 'raise'

// The engine's null can mean missing config/balances or an empty
// portfolio; the accounts tell those apart. With no active investable
// account, no amount of config or balances lights Guardrails up.
export function hasInvestableAccount(accounts: Account[]): boolean {
  return accounts.some((account) => account.active && account.is_investable)
}

// "0.0294" → "2.94%" — two decimals, so a rate near a rail never displays
// as equal to it while the zone says otherwise.
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

// The band renders as fixed Cut | Hold | Raise zones (1:2:1). A scale
// spanning half a band-width past each rail makes those proportions
// exact, and it runs high-to-low so high rates land left, in Cut.
export function markerLeftPct(rate: number, lower: number, upper: number): number {
  const halfBand = (upper - lower) / 2
  const scaleLow = lower - halfBand
  const scaleHigh = upper + halfBand
  const pct = ((scaleHigh - rate) / (scaleHigh - scaleLow)) * 100
  return Math.max(2, Math.min(98, pct))
}

export interface SliderBounds {
  min: number
  max: number
  step: number
}

// Bounds derive from the band edges — half the raise-edge spend up to
// 1.5× the cut-edge spend — so the slider can always reach both rails,
// whatever the portfolio and plan sizes are. Widened to the annual
// target when it falls outside, and never below one step.
export function sliderBounds(guardrails: {
  lower: number
  upper: number
  investable: number
  annual_target: number
}): SliderBounds {
  const step = 1_000
  const { lower, upper, investable, annual_target } = guardrails
  const min = Math.floor((0.5 * lower * investable) / step) * step
  const max = Math.ceil((1.5 * upper * investable) / step) * step
  return {
    min: Math.max(step, Math.min(min, Math.floor(annual_target / step) * step)),
    max: Math.max(max, Math.ceil(annual_target / step) * step),
    step,
  }
}

export interface ZoneCopy {
  status: string
  message: string
  sub: string
}

// The recommendation banner and card-status copy per zone, from the
// design handoff: the ±band is the trigger, the ~10% change is the
// response — never a reset back to the band.
export function zoneCopy(zone: Zone, spend: number): ZoneCopy {
  if (zone === 'cut') {
    return {
      status: 'Cut ~10%',
      message: 'Trim spending ~10%',
      sub: 'Your rate is above the upper guardrail — the capital-preservation rule kicks in.',
    }
  }
  if (zone === 'raise') {
    return {
      status: 'Room to raise',
      message: 'You can raise spending ~10%',
      sub: 'Your rate is below the lower guardrail — the prosperity rule says you have room.',
    }
  }
  return {
    status: 'Hold steady',
    message: `Hold steady — keep spending ${formatUsd(spend)}`,
    sub: "You're inside both guardrails. No change recommended.",
  }
}
