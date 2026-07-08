// Display derivations for the Longevity forecast screen and the
// Dashboard card. All financial math comes from GET /api/forecast —
// these helpers only turn the simulation's series into verdict copy,
// chart column heights, bridge copy, and sensitivity rows.

import type { ForecastPoint, SensitivityRow } from './api.ts'
import type { SliderBounds } from './guardrails.ts'
import { formatUsd } from './ledger.ts'

export interface Verdict {
  headline: string
  ok: boolean
}

// run_out_age is the first unmet year, so the money lasts to the age
// before it; making 90 still reads as ok, per the handoff.
export function verdict(runOutAge: number | null): Verdict {
  if (runOutAge == null) {
    return { headline: "You don't run out.", ok: true }
  }
  return { headline: `Lasts to age ${runOutAge - 1}`, ok: runOutAge >= 90 }
}

// The handoff's millions formatter: two decimals under ten million,
// one from there up.
export function formatMillions(value: number): string {
  const millions = value / 1_000_000
  return `$${millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)}M`
}

const CHART_AGES = [38, 43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93]
const CHART_HEIGHT = 190
// True Social Security dollars against a multi-million balance would
// be under a pixel — the income sliver is enlarged to stay visible.
const SS_MIN_HEIGHT = 7

export interface ChartColumn {
  age: number
  eth: number
  brokerage: number
  retirement: number
  ss: number
}

export function chartColumns(series: ForecastPoint[]): ChartColumn[] {
  const picks = CHART_AGES.map(
    (age) =>
      series.find((point) => point.age === age) ?? {
        age,
        eth: 0,
        brokerage: 0,
        retirement: 0,
        ss_income: 0,
      },
  )
  let maxTotal = Math.max(
    ...picks.map((point) => point.eth + point.brokerage + point.retirement),
  )
  if (maxTotal <= 0) {
    maxTotal = 1
  }
  const height = (value: number) => (value / maxTotal) * CHART_HEIGHT
  return picks.map((point) => ({
    age: point.age,
    eth: height(point.eth),
    brokerage: height(point.brokerage),
    retirement: height(point.retirement),
    ss: point.ss_income > 0 ? Math.max(SS_MIN_HEIGHT, height(point.ss_income)) : 0,
  }))
}

export interface BridgeCopy {
  years: string
  ok: boolean
}

// How long the taxable buckets (ETH + brokerage) last before the
// 401(k) unlocks: the first pre-60 year they sit empty broke the
// bridge that many years after 38.
export function bridgeCopy(series: ForecastPoint[]): BridgeCopy {
  const broke = series.find((point) => point.age < 60 && point.eth + point.brokerage <= 0)
  if (broke != null) {
    return { years: `${broke.age - 38} yrs`, ok: false }
  }
  return { years: '31+ yrs', ok: true }
}

export interface SensitivityRowCopy {
  spend: string
  lasts: string
  outcome: string
  tone: 'ok' | 'tight' | 'bad'
  current: boolean
}

// The levels come from the API (whole percentages of net worth), so
// the resolved spend rarely equals one exactly — the nearest row is
// highlighted instead, ties toward the lower level.
export function sensitivityRows(
  rows: SensitivityRow[],
  currentSpend: number,
): SensitivityRowCopy[] {
  let nearest = -1
  let nearestDistance = Infinity
  rows.forEach((row, index) => {
    const distance = Math.abs(row.spend - currentSpend)
    if (distance < nearestDistance) {
      nearest = index
      nearestDistance = distance
    }
  })
  return rows.map((row, index) => ({
    spend: formatUsd(row.spend),
    current: index === nearest,
    ...outcomeCopy(row),
  }))
}

function outcomeCopy(row: SensitivityRow): Pick<SensitivityRowCopy, 'lasts' | 'outcome' | 'tone'> {
  if (row.run_out_age == null) {
    return {
      lasts: 'never runs out',
      outcome: `✓ ${formatMillions(row.balance_at_100)} @ 100`,
      tone: 'ok',
    }
  }
  const lasts = `to age ${row.run_out_age - 1}`
  if (row.run_out_age >= 90) {
    return { lasts, outcome: 'tight', tone: 'tight' }
  }
  return { lasts, outcome: '⚠ runs out', tone: 'bad' }
}

// The prototype's 55k–160k range, widened outward to a step boundary
// so the resolved spend is always reachable.
export function spendSliderBounds(spend: number): SliderBounds {
  const step = 1_000
  return {
    min: Math.min(55_000, Math.floor(spend / step) * step),
    max: Math.max(160_000, Math.ceil(spend / step) * step),
    step,
  }
}
