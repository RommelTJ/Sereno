// The modelling notes: what a null in the tax config leaves out of an
// answer, in words. Both screens that read the engines show them, so
// the copy lives in one place.

import { describe, expect, it } from 'vitest'
import { modellingNotes } from './modelling.ts'

describe('modellingNotes', () => {
  it('says the tax year leaves ordinary income untaxed', () => {
    expect(modellingNotes(['ordinary_income_untaxed'], 2026)).toEqual([
      'No ordinary brackets on the 2026 tax year: 401(k) draws and staking income are modelled untaxed.',
    ])
  })

  it('says the tax year models no state tax', () => {
    expect(modellingNotes(['state_tax_not_modelled'], 2026)).toEqual([
      'No state brackets on the 2026 tax year: state tax is modelled at zero.',
    ])
  })

  it('says the assumptions model no staking income', () => {
    expect(modellingNotes(['staking_income_not_modelled'], 2026)).toEqual([
      'No staking yield on the assumptions: the ETH stack earns no income here.',
    ])
  })

  it('keeps the server order', () => {
    const notes = modellingNotes(
      ['ordinary_income_untaxed', 'state_tax_not_modelled', 'staking_income_not_modelled'],
      2026,
    )
    expect(notes).toHaveLength(3)
    expect(notes[0]).toMatch(/^No ordinary brackets/)
    expect(notes[1]).toMatch(/^No state brackets/)
    expect(notes[2]).toMatch(/^No staking yield/)
  })

  it('is empty for a configured plan', () => {
    expect(modellingNotes([], 2026)).toEqual([])
  })
})
