// The modelling notes: what a null in the tax config leaves out of an
// engine's answer, in words. The engines treat a missing bracket table
// or staking yield as a legitimate default, and each default flatters
// the plan — untaxed 401(k) draws, or no staking income at all — so
// the screens that read them say which effect is off. One place for
// the copy, since Withdrawals and Forecast both show it.

import type { ModellingWarning } from './api.ts'

export function modellingNotes(warnings: ModellingWarning[], taxYear: number): string[] {
  return warnings.map((warning) => {
    switch (warning) {
      case 'ordinary_income_untaxed':
        return `No ordinary brackets on the ${taxYear} tax year: 401(k) draws and staking income are modelled untaxed.`
      case 'staking_income_not_modelled':
        return 'No staking yield on the assumptions: the ETH stack earns no income here.'
    }
  })
}
