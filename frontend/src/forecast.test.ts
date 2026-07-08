// Display derivations for the Longevity forecast screen and the
// Dashboard card. All financial math comes from GET /api/forecast —
// these helpers only turn the simulation's series into verdict copy,
// chart column heights, bridge copy, and sensitivity rows.

import { describe, expect, it } from 'vitest'
import {
  bridgeCopy,
  chartColumns,
  formatMillions,
  sensitivityRows,
  spendSliderBounds,
  verdict,
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

// A full 38→95 series with per-age overrides, mirroring the API shape.
function series(
  overrides: Record<
    number,
    Partial<{ eth: number; brokerage: number; retirement: number; ss_income: number }>
  > = {},
) {
  return Array.from({ length: 95 - 38 + 1 }, (_, i) => point(38 + i, overrides[38 + i]))
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
  it('samples every fifth age from 38 to 93', () => {
    expect(chartColumns(series()).map((column) => column.age)).toEqual([
      38, 43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93,
    ])
  })

  it('scales segment heights against the tallest sampled column', () => {
    const columns = chartColumns(
      series({ 38: { eth: 100_000, brokerage: 50_000, retirement: 50_000 } }),
    )
    expect(columns[0]).toEqual({
      age: 38,
      eth: 95,
      brokerage: 47.5,
      retirement: 47.5,
      ss: 0,
    })
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
    expect(columns[11].ss).toBe(7)
  })

  it('lets a large sliver keep its true height', () => {
    const columns = chartColumns(
      series({
        38: { eth: 200_000 },
        93: { ss_income: 20_000 },
      }),
    )
    expect(columns[11].ss).toBe(19)
  })

  it('hides the sliver before Social Security starts', () => {
    const columns = chartColumns(series({ 38: { eth: 200_000 } }))
    expect(columns.every((column) => column.ss === 0)).toBe(true)
  })

  it('survives an all-zero series without NaN heights', () => {
    expect(chartColumns(series())[0]).toEqual({
      age: 38,
      eth: 0,
      brokerage: 0,
      retirement: 0,
      ss: 0,
    })
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
