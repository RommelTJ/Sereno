// Display derivations for the Guardrails screen and the Dashboard card.
// The band renders as fixed Cut | Hold | Raise zones (1:2:1), so the
// marker scale spans half a band-width past each rail — high rates land
// left, in Cut. Slider bounds derive from the band edges so both zones
// are always reachable, whatever the portfolio and plan sizes are.

import { describe, expect, it } from 'vitest'
import {
  drawdownStatus,
  formatRate,
  isReadiness,
  markerLeftPct,
  sliderBounds,
  spendBasisCopy,
  zoneCopy,
} from './guardrails.ts'

const LOWER = 0.0294 * 0.8 // 2.352%
const UPPER = 0.0294 * 1.2 // 3.528%

describe('formatRate', () => {
  it('shows two decimals', () => {
    expect(formatRate(0.0294)).toBe('2.94%')
  })

  it('keeps trailing zeros so rates align', () => {
    expect(formatRate(0.04)).toBe('4.00%')
  })
})

describe('markerLeftPct', () => {
  it('centers the initial rate', () => {
    expect(markerLeftPct(0.0294, LOWER, UPPER)).toBeCloseTo(50)
  })

  it('puts the upper rail on the cut/hold boundary', () => {
    expect(markerLeftPct(UPPER, LOWER, UPPER)).toBeCloseTo(25)
  })

  it('puts the lower rail on the hold/raise boundary', () => {
    expect(markerLeftPct(LOWER, LOWER, UPPER)).toBeCloseTo(75)
  })

  it('clamps runaway high rates inside the left edge', () => {
    expect(markerLeftPct(0.2, LOWER, UPPER)).toBe(2)
  })

  it('clamps runaway low rates inside the right edge', () => {
    expect(markerLeftPct(0.001, LOWER, UPPER)).toBe(98)
  })
})

describe('sliderBounds', () => {
  const guardrails = {
    lower: LOWER,
    upper: UPPER,
    investable: 1_500_000,
    annual_target: 45_000,
    spend: 45_000,
  }

  it('spans half the raise-edge spend to 1.5x the cut-edge spend', () => {
    // 0.5 × 2.352% × 1.5M = 17,640 → $17k; 1.5 × 3.528% × 1.5M = 79,380 → $80k
    expect(sliderBounds(guardrails)).toEqual({ min: 17_000, max: 80_000, step: 1_000 })
  })

  it('widens to include a target above the derived max', () => {
    expect(sliderBounds({ ...guardrails, annual_target: 100_000 }).max).toBe(100_000)
  })

  it('widens to include a target below the derived min', () => {
    expect(sliderBounds({ ...guardrails, annual_target: 5_000 }).min).toBe(5_000)
  })

  it('never starts below one slider step', () => {
    expect(sliderBounds({ ...guardrails, investable: 10_000, annual_target: 1_000 }).min).toBe(
      1_000,
    )
  })

  it('widens to include a trailing spend above the derived max', () => {
    // The resolved spend is trailing actuals now, so it can land outside
    // the target-derived range — both must stay reachable.
    expect(sliderBounds({ ...guardrails, spend: 90_500 }).max).toBe(91_000)
  })

  it('widens to include a trailing spend below the derived min', () => {
    expect(sliderBounds({ ...guardrails, spend: 12_400 }).min).toBe(12_000)
  })
})

describe('spendBasisCopy', () => {
  it('labels a trailing-actual figure', () => {
    expect(spendBasisCopy({ spend_source: 'actual', spend_months: 12 })).toEqual({
      label: 'Trailing 12-mo spend',
      note: 'actual spending, last 12 months',
    })
  })

  it('labels the target fallback with the history that exists', () => {
    expect(spendBasisCopy({ spend_source: 'target', spend_months: 2 })).toEqual({
      label: 'Planned spend',
      note: '2 of 12 months of spending history',
    })
  })

  it('labels a what-if level with no note', () => {
    expect(spendBasisCopy({ spend_source: 'what_if', spend_months: 12 })).toEqual({
      label: 'What-if spend',
      note: null,
    })
  })
})

describe('isReadiness', () => {
  it('is readiness while no drawdown date is set', () => {
    expect(isReadiness(null, '2026-08-26')).toBe(true)
  })

  it('is readiness before the drawdown date', () => {
    expect(isReadiness('2028-01-01', '2026-08-26')).toBe(true)
  })

  it('goes live on the drawdown date', () => {
    expect(isReadiness('2026-08-26', '2026-08-26')).toBe(false)
  })
})

describe('drawdownStatus', () => {
  it('names the readiness state', () => {
    expect(drawdownStatus(null, '2026-08-26')).toBe("Readiness — drawdown hasn't started")
  })

  it('names the live state with its start date', () => {
    expect(drawdownStatus('2026-01-01', '2026-08-26')).toBe('Live — drawdown since 2026-01-01')
  })
})

describe('zoneCopy', () => {
  it('cut: the capital-preservation rule', () => {
    expect(zoneCopy('cut', 60_000)).toEqual({
      status: 'Cut ~10%',
      message: 'Trim spending ~10%',
      sub: 'Your rate is above the upper guardrail — the capital-preservation rule kicks in.',
    })
  })

  it('raise: the prosperity rule', () => {
    expect(zoneCopy('raise', 30_000)).toEqual({
      status: 'Room to raise',
      message: 'You can raise spending ~10%',
      sub: 'Your rate is below the lower guardrail — the prosperity rule says you have room.',
    })
  })

  it('hold names the spend being kept', () => {
    expect(zoneCopy('hold', 45_000)).toEqual({
      status: 'Hold steady',
      message: 'Hold steady — keep spending $45,000.00',
      sub: "You're inside both guardrails. No change recommended.",
    })
  })
})
