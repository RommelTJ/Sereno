// Display derivations for the Longevity forecast screen and the
// Dashboard card. All financial math comes from GET /api/forecast —
// these helpers only turn the simulation's series into verdict copy,
// chart column heights, bridge copy, and sensitivity rows.

import { describe, expect, it } from 'vitest'
import {
  bindingConstraintCopy,
  bridgeCopy,
  chartColumns,
  ethGrowthSliderBounds,
  formatMillions,
  purchaseAmountSliderBounds,
  purchaseCostRows,
  sensitivityRows,
  spendSliderBounds,
  verdict,
  verdictDelta,
} from './forecast.ts'

function point(
  age: number,
  balances: Partial<{
    eth: number
    brokerage: number
    retirement: number
    ss_income: number
  }> = {},
) {
  return {
    age,
    eth: 0,
    brokerage: 0,
    retirement: 0,
    ss_income: 0,
    ...balances,
  }
}

// A full 38→100 series with per-age overrides, mirroring the API shape.
function series(
  overrides: Record<
    number,
    Partial<{ eth: number; brokerage: number; retirement: number; ss_income: number }>
  > = {},
) {
  return Array.from({ length: 100 - 38 + 1 }, (_, i) => point(38 + i, overrides[38 + i]))
}

describe('verdict', () => {
  it('celebrates a portfolio that survives', () => {
    expect(verdict(null)).toEqual({ headline: "You don't run out.", ok: true })
  })

  it('names the last funded age when the money runs out', () => {
    expect(verdict(72)).toEqual({ headline: 'Lasts to age 71', ok: false })
  })

  it('treats reaching 90 as ok even when 95 is not', () => {
    expect(verdict(91)).toEqual({ headline: 'Lasts to age 90', ok: true })
  })
})

describe('formatMillions', () => {
  it('shows two decimals under ten million', () => {
    expect(formatMillions(5_512_345)).toBe('$5.51M')
  })

  it('shows one decimal from ten million up', () => {
    expect(formatMillions(12_345_678)).toBe('$12.3M')
  })
})

describe('chartColumns', () => {
  it('draws one column per simulated year', () => {
    expect(chartColumns(series()).map((column) => column.age)).toEqual(
      Array.from({ length: 100 - 38 + 1 }, (_, i) => 38 + i),
    )
  })

  it('scales segment heights against the tallest column and keeps the raw dollars', () => {
    const columns = chartColumns(
      series({ 38: { eth: 100_000, brokerage: 50_000, retirement: 50_000 } }),
    )
    expect(columns[0]).toEqual({
      age: 38,
      label: '',
      eth: 95,
      brokerage: 47.5,
      retirement: 47.5,
      ss: 0,
      ethUsd: 100_000,
      brokerageUsd: 50_000,
      retirementUsd: 50_000,
      ssUsd: 0,
      cap: 0,
      marker: '',
      purchaseUsd: null,
      shortUsd: null,
    })
  })

  it('labels only the ages divisible by five', () => {
    const labels = chartColumns(series()).map((column) => column.label)
    expect(labels.filter(Boolean)).toEqual([
      '40',
      '45',
      '50',
      '55',
      '60',
      '65',
      '70',
      '75',
      '80',
      '85',
      '90',
      '95',
      '100',
    ])
    expect(labels[0]).toBe('')
  })

  it('keeps the Social Security sliver at least 7px tall', () => {
    // 1,000 of SS against a 200,000 max would be under a pixel — the
    // income sliver is enlarged to stay visible.
    const columns = chartColumns(
      series({
        38: { eth: 200_000 },
        93: { ss_income: 1_000 },
      }),
    )
    expect(columns[93 - 38].ss).toBe(7)
  })

  it('lets a large sliver keep its true height', () => {
    const columns = chartColumns(
      series({
        38: { eth: 200_000 },
        93: { ss_income: 20_000 },
      }),
    )
    expect(columns[93 - 38].ss).toBe(19)
  })

  it('hides the sliver before Social Security starts', () => {
    const columns = chartColumns(series({ 38: { eth: 200_000 } }))
    expect(columns.every((column) => column.ss === 0)).toBe(true)
  })

  it('survives an all-zero series without NaN heights', () => {
    expect(chartColumns(series())[0]).toEqual({
      age: 38,
      label: '',
      eth: 0,
      brokerage: 0,
      retirement: 0,
      ss: 0,
      ethUsd: 0,
      brokerageUsd: 0,
      retirementUsd: 0,
      ssUsd: 0,
      cap: 0,
      marker: '',
      purchaseUsd: null,
      shortUsd: null,
    })
  })
})

describe('chartColumns with purchases', () => {
  const purchase = { year: 2033, age: 45, amount: 800_000, ongoing_delta: 0 }

  it('marks purchase years with a diamond and carries the amount', () => {
    const columns = chartColumns(series({ 38: { eth: 200_000 } }), {
      purchases: [purchase],
    })
    expect(columns[45 - 38].marker).toBe('◆')
    expect(columns[45 - 38].purchaseUsd).toBe(800_000)
    expect(columns[44 - 38].marker).toBe('')
    expect(columns[44 - 38].purchaseUsd).toBeNull()
  })

  it('sums purchases due the same year under one marker', () => {
    const columns = chartColumns(series({ 38: { eth: 200_000 } }), {
      purchases: [purchase, { year: 2033, age: 45, amount: 70_000, ongoing_delta: 0 }],
    })
    expect(columns[45 - 38].purchaseUsd).toBe(870_000)
  })

  it('carries the short on an unaffordable year', () => {
    const columns = chartColumns(series({ 38: { eth: 200_000 } }), {
      purchases: [purchase],
      unaffordable: [{ year: 2033, age: 45, short: 278_149 }],
    })
    expect(columns[45 - 38].shortUsd).toBe(278_149)
    expect(columns[44 - 38].shortUsd).toBeNull()
  })

  it('caps each column with the forgone growth against the baseline', () => {
    // Baseline 200,000 vs 150,000 with the purchases: the chart
    // scales to the taller baseline (190px), the column reaches
    // 142.5px, and the hatched cap fills the 47.5px the purchases
    // forwent.
    const flat = (value: number) =>
      series(
        Object.fromEntries(
          Array.from({ length: 63 }, (_, i) => [38 + i, { eth: value }]),
        ),
      )
    const columns = chartColumns(flat(150_000), { baseline: flat(200_000) })
    expect(columns[0].eth).toBe(142.5)
    expect(columns[0].cap).toBe(47.5)
  })

  it('keeps a zero cap without a baseline', () => {
    const columns = chartColumns(series({ 38: { eth: 200_000 } }))
    expect(columns.every((column) => column.cap === 0)).toBe(true)
  })
})

describe('verdictDelta', () => {
  const baseline = { run_out_age: null, balance_at_100: 5_512_345, series: [] }
  const purchase = { year: 2036, age: 48, amount: 800_000, ongoing_delta: 0 }

  it('is null with no purchases', () => {
    expect(
      verdictDelta({
        purchases: [],
        run_out_age: null,
        balance_at_100: 5_512_345,
        baseline,
      }),
    ).toBeNull()
  })

  it('prices the purchases against the baseline when both last', () => {
    expect(
      verdictDelta({
        purchases: [purchase],
        run_out_age: null,
        balance_at_100: 4_112_345,
        baseline,
      }),
    ).toBe('$1.40M lower at 100 than without the purchases')
  })

  it('notes a higher terminal when a sale funds the plan', () => {
    expect(
      verdictDelta({
        purchases: [{ ...purchase, amount: -400_000 }],
        run_out_age: null,
        balance_at_100: 6_112_345,
        baseline,
      }),
    ).toBe('$0.60M higher at 100 than without the purchases')
  })

  it('counts the years lost when the purchases shorten the plan', () => {
    expect(
      verdictDelta({
        purchases: [purchase],
        run_out_age: 87,
        balance_at_100: 0,
        baseline,
      }),
    ).toBe('14 yrs earlier than without the purchases')
  })

  it('measures against a baseline that itself runs out', () => {
    expect(
      verdictDelta({
        purchases: [purchase],
        run_out_age: 87,
        balance_at_100: 0,
        baseline: { ...baseline, run_out_age: 92, balance_at_100: 0 },
      }),
    ).toBe('5 yrs earlier than without the purchases')
  })
})

describe('purchaseCostRows', () => {
  it('labels each row with its purchase and prices the outcome without it', () => {
    const rows = purchaseCostRows(
      [{ year: 2036, amount: 800_000, run_out_age: null, balance_at_100: 6_912_345 }],
      [{ name: 'House', year: 2036, amount: 800_000 }],
    )
    expect(rows[0]).toEqual({
      name: 'House',
      year: 2036,
      amount: '$800,000',
      lasts: 'never runs out',
      outcome: '✓ $6.91M @ 100',
      tone: 'ok',
    })
  })

  it('keeps the sensitivity tones for tight and failing outcomes', () => {
    const rows = purchaseCostRows(
      [
        { year: 2036, amount: 800_000, run_out_age: 92, balance_at_100: 0 },
        { year: 2041, amount: 70_000, run_out_age: 72, balance_at_100: 0 },
      ],
      [
        { name: 'House', year: 2036, amount: 800_000 },
        { name: 'Car', year: 2041, amount: 70_000 },
      ],
    )
    expect(rows[0]).toMatchObject({ lasts: 'to age 91', tone: 'tight' })
    expect(rows[1]).toMatchObject({ name: 'Car', lasts: 'to age 71', tone: 'bad' })
  })

  it('falls back to the year when the purchase is unnamed', () => {
    const rows = purchaseCostRows(
      [{ year: 2036, amount: 800_000, run_out_age: null, balance_at_100: 6_912_345 }],
      [{ name: '', year: 2036, amount: 800_000 }],
    )
    expect(rows[0].name).toBe('Purchase in 2036')
  })
})

describe('purchaseAmountSliderBounds', () => {
  it('spans zero to a million by default', () => {
    expect(purchaseAmountSliderBounds(250_000)).toEqual({
      min: 0,
      max: 1_000_000,
      step: 1_000,
    })
  })

  it('widens the ceiling so a bigger purchase stays reachable', () => {
    expect(purchaseAmountSliderBounds(2_400_500)).toEqual({
      min: 0,
      max: 2_401_000,
      step: 1_000,
    })
  })
})

describe('bindingConstraintCopy', () => {
  it('names the purchase year itself as the cap', () => {
    expect(bindingConstraintCopy('purchase_year_liquidity')).toBe(
      'capped by the buckets reachable that year — a later year can raise the ceiling',
    )
  })

  it('names longevity as the cap', () => {
    expect(bindingConstraintCopy('longevity')).toBe(
      'capped by long-run longevity, not the year itself',
    )
  })
})

describe('bridgeCopy', () => {
  it('reports how long the taxable buckets last when they break early', () => {
    // ETH and brokerage are empty from age 52: 14 years after 38.
    const overrides: Record<number, { eth: number }> = {}
    for (let age = 38; age < 52; age += 1) {
      overrides[age] = { eth: 100_000 }
    }
    expect(bridgeCopy(series(overrides), 38)).toEqual({ years: '14 yrs', ok: false })
  })

  it('counts the bridge years from the caller-supplied start age', () => {
    // The same age-52 break is only 12 years past a start age of 40 —
    // the literal 38 came from the prototype handoff.
    const overrides: Record<number, { eth: number }> = {}
    for (let age = 38; age < 52; age += 1) {
      overrides[age] = { eth: 100_000 }
    }
    expect(bridgeCopy(series(overrides), 40)).toEqual({ years: '12 yrs', ok: false })
  })

  it('celebrates taxable buckets that outlast the bridge', () => {
    const overrides: Record<number, { brokerage: number }> = {}
    for (let age = 38; age <= 95; age += 1) {
      overrides[age] = { brokerage: 100_000 }
    }
    expect(bridgeCopy(series(overrides), 38)).toEqual({ years: '31+ yrs', ok: true })
  })

  it('ignores the locked retirement bucket', () => {
    const overrides: Record<number, { retirement: number }> = {}
    for (let age = 38; age <= 95; age += 1) {
      overrides[age] = { retirement: 500_000 }
    }
    expect(bridgeCopy(series(overrides), 38)).toEqual({ years: '0 yrs', ok: false })
  })
})

describe('sensitivityRows', () => {
  const rows = [
    { spend: 30_000, run_out_age: null, balance_at_100: 5_512_345 },
    { spend: 45_000, run_out_age: 92, balance_at_100: 400_000 },
    { spend: 60_000, run_out_age: 72, balance_at_100: 0 },
  ]

  it('celebrates a level that never runs out with its age-100 balance', () => {
    expect(sensitivityRows(rows, 45_000)[0]).toMatchObject({
      spend: '$30,000',
      lasts: 'never runs out',
      outcome: '✓ $5.51M @ 100',
      tone: 'ok',
    })
  })

  it('calls a run-out at 90 or later tight', () => {
    expect(sensitivityRows(rows, 45_000)[1]).toMatchObject({
      lasts: 'to age 91',
      outcome: 'tight',
      tone: 'tight',
    })
  })

  it('flags an early run-out', () => {
    expect(sensitivityRows(rows, 45_000)[2]).toMatchObject({
      lasts: 'to age 71',
      outcome: '⚠ runs out',
      tone: 'bad',
    })
  })

  it('marks only the row nearest the current spend as current', () => {
    expect(sensitivityRows(rows, 52_000).map((row) => row.current)).toEqual([
      false,
      true,
      false,
    ])
  })

  it('breaks a tie toward the lower level', () => {
    expect(sensitivityRows(rows, 52_500).map((row) => row.current)).toEqual([
      false,
      true,
      false,
    ])
  })
})

describe('spendSliderBounds', () => {
  it("uses the prototype's range when the spend sits inside it", () => {
    expect(spendSliderBounds(96_000)).toEqual({ min: 55_000, max: 160_000, step: 1_000 })
  })

  it('widens the floor so the resolved spend stays reachable', () => {
    expect(spendSliderBounds(45_000)).toEqual({ min: 45_000, max: 160_000, step: 1_000 })
  })

  it('widens the ceiling the same way', () => {
    expect(spendSliderBounds(200_000)).toEqual({ min: 55_000, max: 200_000, step: 1_000 })
  })

  it('rounds an off-step spend outward to a step boundary', () => {
    expect(spendSliderBounds(44_500)).toEqual({ min: 44_000, max: 160_000, step: 1_000 })
  })
})

describe('ethGrowthSliderBounds', () => {
  it("spans ETH's historical yearly range when the rate sits inside it", () => {
    expect(ethGrowthSliderBounds(15)).toEqual({ min: -85, max: 470, step: 1 })
  })

  it('widens the ceiling so an out-of-range stored rate stays reachable', () => {
    expect(ethGrowthSliderBounds(500.4)).toEqual({ min: -85, max: 501, step: 1 })
  })

  it('widens the floor the same way, outward to a step boundary', () => {
    expect(ethGrowthSliderBounds(-90.2)).toEqual({ min: -91, max: 470, step: 1 })
  })
})
