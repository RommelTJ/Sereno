// Display derivations for the Longevity forecast screen and the
// Dashboard card. All financial math comes from GET /api/forecast —
// these helpers only turn the simulation's series into verdict copy,
// chart column heights, bridge copy, and sensitivity rows.

import type {
  BindingConstraint,
  ForecastBaseline,
  ForecastPoint,
  PlannedPurchaseInput,
  PurchaseCostRow,
  PurchaseOut,
  SensitivityRow,
  UnaffordableYear,
} from './api.ts'
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

const CHART_HEIGHT = 190
// True Social Security dollars against a multi-million balance would
// be under a pixel — the income sliver is enlarged to stay visible.
const SS_MIN_HEIGHT = 7
// One bar per simulated year is too dense to label each column — the
// axis marks only the ages divisible by five.
const LABEL_STEP = 5

// Pixel heights for the stacked bar plus the raw dollars behind them,
// so the hover tooltip can show the exact per-bucket balances. A
// purchase year carries a ◆ marker and its amount; an unaffordable
// year carries how far the lump missed; cap is the hatched
// forgone-growth band up to the baseline's total.
export interface ChartColumn {
  age: number
  label: string
  eth: number
  brokerage: number
  retirement: number
  ss: number
  ethUsd: number
  brokerageUsd: number
  retirementUsd: number
  ssUsd: number
  cap: number
  marker: '' | '◆'
  purchaseUsd: number | null
  shortUsd: number | null
}

export interface ChartExtras {
  baseline?: ForecastPoint[]
  purchases?: PurchaseOut[]
  unaffordable?: UnaffordableYear[]
}

export function chartColumns(
  series: ForecastPoint[],
  extras: ChartExtras = {},
): ChartColumn[] {
  const total = (point: ForecastPoint) => point.eth + point.brokerage + point.retirement
  const baseline = extras.baseline ?? []
  // The baseline is never below the with-purchases path for long, so
  // scaling to both keeps the hatched cap inside the chart.
  let maxTotal = Math.max(...series.map(total), ...baseline.map(total))
  if (maxTotal <= 0) {
    maxTotal = 1
  }
  const height = (value: number) => (value / maxTotal) * CHART_HEIGHT
  const baseTotals = new Map(baseline.map((point) => [point.age, total(point)]))
  const purchaseByAge = new Map<number, number>()
  for (const purchase of extras.purchases ?? []) {
    purchaseByAge.set(
      purchase.age,
      (purchaseByAge.get(purchase.age) ?? 0) + purchase.amount,
    )
  }
  const shortByAge = new Map(
    (extras.unaffordable ?? []).map((miss) => [miss.age, miss.short]),
  )
  return series.map((point) => {
    const baseTotal = baseTotals.get(point.age)
    const purchaseUsd = purchaseByAge.get(point.age) ?? null
    return {
      age: point.age,
      label: point.age % LABEL_STEP === 0 ? String(point.age) : '',
      eth: height(point.eth),
      brokerage: height(point.brokerage),
      retirement: height(point.retirement),
      ss: point.ss_income > 0 ? Math.max(SS_MIN_HEIGHT, height(point.ss_income)) : 0,
      ethUsd: point.eth,
      brokerageUsd: point.brokerage,
      retirementUsd: point.retirement,
      ssUsd: point.ss_income,
      cap:
        baseTotal == null ? 0 : Math.max(0, height(baseTotal) - height(total(point))),
      marker: purchaseUsd == null ? ('' as const) : ('◆' as const),
      purchaseUsd,
      shortUsd: shortByAge.get(point.age) ?? null,
    }
  })
}

// The verdict's marginal line: what the purchases change against the
// baseline — years first (a shorter plan outranks a smaller balance),
// dollars when the horizon holds either way. Null with nothing
// planned or nothing moved.
export function verdictDelta(forecast: {
  purchases: PurchaseOut[]
  run_out_age: number | null
  balance_at_100: number
  baseline: ForecastBaseline
}): string | null {
  if (forecast.purchases.length === 0) {
    return null
  }
  // A null run-out reads as "past 100" so the two paths compare.
  const HORIZON = 101
  const withAge = forecast.run_out_age ?? HORIZON
  const baseAge = forecast.baseline.run_out_age ?? HORIZON
  if (withAge !== baseAge) {
    const years = Math.abs(baseAge - withAge)
    const direction = withAge < baseAge ? 'earlier' : 'later'
    return `${years} yr${years === 1 ? '' : 's'} ${direction} than without the purchases`
  }
  const diff = forecast.baseline.balance_at_100 - forecast.balance_at_100
  // Sub-$500 residue is noise, not a story.
  if (Math.abs(diff) < 500) {
    return null
  }
  const direction = diff > 0 ? 'lower' : 'higher'
  return `${formatMillions(Math.abs(diff))} ${direction} at 100 than without the purchases`
}

export interface BridgeCopy {
  years: string
  ok: boolean
}

// How long the taxable buckets (ETH + brokerage) last before the
// 401(k) unlocks: the first pre-60 year they sit empty broke the
// bridge that many years after the start age.
export function bridgeCopy(series: ForecastPoint[], startAge: number): BridgeCopy {
  const broke = series.find((point) => point.age < 60 && point.eth + point.brokerage <= 0)
  if (broke != null) {
    return { years: `${broke.age - startAge} yrs`, ok: false }
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

function outcomeCopy(row: {
  run_out_age: number | null
  balance_at_100: number
}): Pick<SensitivityRowCopy, 'lasts' | 'outcome' | 'tone'> {
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

// The "what do the purchases cost?" card: one row per purchase,
// priced as the outcome if just that one were dropped. Names come
// from the screen's own list (the API never sees them), matched by
// position — the response echoes the request order.
export interface PurchaseCostRowCopy {
  name: string
  year: number
  amount: string
  lasts: string
  outcome: string
  tone: 'ok' | 'tight' | 'bad'
}

export function purchaseCostRows(
  costs: PurchaseCostRow[],
  purchases: PlannedPurchaseInput[],
): PurchaseCostRowCopy[] {
  return costs.map((cost, index) => ({
    name: purchases[index]?.name || `Purchase in ${cost.year}`,
    year: cost.year,
    amount: formatUsd(cost.amount),
    ...outcomeCopy(cost),
  }))
}

// The solver's answer, sentence-cased for the row under the amount.
export function bindingConstraintCopy(constraint: BindingConstraint): string {
  if (constraint === 'purchase_year_liquidity') {
    return 'capped by the buckets reachable that year — a later year can raise the ceiling'
  }
  return 'capped by long-run longevity, not the year itself'
}

// A purchase amount doubles as a slider: zero to a million by
// default, the ceiling widened outward to a step boundary so any
// solver-filled or hand-typed amount stays reachable.
export function purchaseAmountSliderBounds(amount: number): SliderBounds {
  const step = 1_000
  return { min: 0, max: Math.max(1_000_000, Math.ceil(amount / step) * step), step }
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

// ETH's slider spans its actual nine-year history (−82% to +469%
// yearly, rounded outward) — the volatility is the whole reason for a
// separate slider — widened further so any stored rate stays
// reachable.
export function ethGrowthSliderBounds(pct: number): SliderBounds {
  const step = 1
  return {
    min: Math.min(-85, Math.floor(pct / step) * step),
    max: Math.max(470, Math.ceil(pct / step) * step),
    step,
  }
}
