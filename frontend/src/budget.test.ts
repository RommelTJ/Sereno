// Month arithmetic for the activity feed's paging buttons: nextMonth is
// the forward mirror of previousMonth, pure string math either way.

import { describe, expect, it } from 'vitest'
import { nextMonth } from './budget.ts'

describe('nextMonth', () => {
  it('advances within a year', () => {
    expect(nextMonth('2026-06')).toBe('2026-07')
  })

  it('pads the two-digit months', () => {
    expect(nextMonth('2026-09')).toBe('2026-10')
  })

  it('rolls December into January', () => {
    expect(nextMonth('2025-12')).toBe('2026-01')
  })
})
