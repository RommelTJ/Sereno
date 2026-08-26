// The shared band logic both editors lean on: the Forecast view's
// transient rows and the Settings card gate saves and fetches on the
// same overlap rule the server enforces, and detect an unchanged
// schedule so a no-op save posts nothing.

import { describe, expect, it } from 'vitest'
import { bandLabel, bandProblem, overrideBands, scheduleChanged } from './spendBands.ts'
import { SPEND_BANDS } from './test/fixtures.ts'

describe('bandLabel', () => {
  it('renders a ranged band with both inclusive years', () => {
    expect(bandLabel({ start_year: 2031, end_year: 2040 })).toBe('2031-2040')
  })

  it('renders an open-ended band with a trailing plus', () => {
    expect(bandLabel({ start_year: 2045, end_year: null })).toBe('2045+')
  })
})

describe('bandProblem', () => {
  it('is null for an empty schedule', () => {
    expect(bandProblem([])).toBeNull()
  })

  it('is null for adjacent bands in any order — ends are inclusive', () => {
    const bands = [
      { start_year: 2035, end_year: 2040, annual_amount: 38_000 },
      { start_year: 2030, end_year: 2034, annual_amount: 55_000 },
    ]
    expect(bandProblem(bands)).toBeNull()
  })

  it('names both rows of an overlap in the server wording', () => {
    const bands = [
      { start_year: 2031, end_year: 2040, annual_amount: 55_000 },
      { start_year: 2035, end_year: null, annual_amount: 38_000 },
    ]
    expect(bandProblem(bands)).toBe('bands 2031-2040 and 2035+ overlap')
  })

  it('flags an open-ended band starting before a later band', () => {
    const bands = [
      { start_year: 2030, end_year: null, annual_amount: 55_000 },
      { start_year: 2045, end_year: 2050, annual_amount: 38_000 },
    ]
    expect(bandProblem(bands)).toBe('bands 2030+ and 2045-2050 overlap')
  })

  it('flags a band ending before it starts', () => {
    const bands = [{ start_year: 2040, end_year: 2030, annual_amount: 55_000 }]
    expect(bandProblem(bands)).toBe('band 2040-2030 ends before it starts')
  })
})

describe('overrideBands', () => {
  it('maps saved rows to override rows, notes kept and ids dropped', () => {
    expect(overrideBands(SPEND_BANDS)).toEqual([
      {
        start_year: 2030,
        end_year: 2044,
        annual_amount: 55_000,
        note: 'peak travel years',
      },
      {
        start_year: 2045,
        end_year: null,
        annual_amount: 38_000,
        note: 'slower years, mortgage gone',
      },
    ])
  })
})

describe('scheduleChanged', () => {
  it('is false for the saved schedule itself, in any row order', () => {
    const reversed = [...overrideBands(SPEND_BANDS)].reverse()
    expect(scheduleChanged(reversed, SPEND_BANDS)).toBe(false)
  })

  it('is false when a blank note stands in for a null one', () => {
    const bands = overrideBands(SPEND_BANDS).map((band, index) =>
      index === 1 ? { ...band, note: '' } : band,
    )
    const saved = SPEND_BANDS.map((band, index) =>
      index === 1 ? { ...band, note: null } : band,
    )
    expect(scheduleChanged(bands, saved)).toBe(false)
  })

  it('is true when an amount moves', () => {
    const bands = overrideBands(SPEND_BANDS).map((band, index) =>
      index === 0 ? { ...band, annual_amount: 60_000 } : band,
    )
    expect(scheduleChanged(bands, SPEND_BANDS)).toBe(true)
  })

  it('is true when a row is added or removed', () => {
    const bands = overrideBands(SPEND_BANDS)
    expect(scheduleChanged(bands.slice(0, 1), SPEND_BANDS)).toBe(true)
    expect(
      scheduleChanged(
        [...bands, { start_year: 2050, end_year: null, annual_amount: 30_000 }],
        SPEND_BANDS,
      ),
    ).toBe(true)
  })
})
