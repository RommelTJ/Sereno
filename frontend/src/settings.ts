// Pure derivations for the Settings & data view.

import type {
  Account,
  Assumption,
  AssumptionInput,
  Fund,
  LedgerMonth,
  SocialSecurityEntry,
  SocialSecurityInput,
  SpendPlan,
  SpendPlanInput,
  TaxBracket,
} from './api.ts'
import { formatUsd } from './ledger.ts'

export interface BucketRow {
  key: string
  name: string
  tag: string
  value: string
  negative: boolean
}

// The ledger is newest-first; an account's current value is the first
// balance found walking back through the months. Liabilities are stored
// positive and shown negative.
export function accountRows(
  accounts: Account[],
  ledger: LedgerMonth[],
): BucketRow[] {
  const latest = new Map<number, number>()
  for (const month of ledger) {
    for (const entry of month.balances) {
      if (!latest.has(entry.account_id)) {
        latest.set(entry.account_id, entry.balance_usd)
      }
    }
  }
  return accounts
    .filter((account) => account.active)
    .map((account) => {
      const balance = latest.get(account.id) ?? 0
      return {
        key: `account-${account.id}`,
        name: account.name,
        tag: account.kind,
        value: formatUsd(account.is_liability ? -balance : balance),
        negative: account.is_liability,
      }
    })
}

export function fundRows(funds: Fund[]): BucketRow[] {
  return funds.map((fund) => ({
    key: `fund-${fund.id}`,
    name: fund.name,
    tag: `fund · ${fund.kind}`,
    value: formatUsd(fund.balance),
    negative: false,
  }))
}

// 7 → "7.0%" — for values stored in percent units (return_pct, …).
export function formatPct(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

// 0.038 → "3.8%" — for values stored as fractions (niit_rate, brackets).
export function formatRate(rate: number): string {
  return `${+(rate * 100).toFixed(2)}%`
}

export function bracketLabel(bracket: TaxBracket): string {
  return bracket.upto == null
    ? `${formatRate(bracket.rate)} and up`
    : `${formatRate(bracket.rate)} to ${formatUsd(bracket.upto)}`
}

function parseNumber(raw: string): number | undefined {
  if (raw.trim() === '') {
    return undefined
  }
  const value = Number(raw.replace(/[^0-9.]/g, ''))
  return Number.isFinite(value) ? value : undefined
}

export interface AssumptionsFormValues {
  returnPct: string
  inflationPct: string
  ethGrowthPct: string
  spend: string
}

export function assumptionsFormValues(
  assumption: Assumption | null,
  spendPlan: SpendPlan | null,
): AssumptionsFormValues {
  return {
    returnPct: assumption ? String(assumption.return_pct) : '',
    inflationPct: assumption ? String(assumption.inflation_pct) : '',
    ethGrowthPct:
      assumption?.eth_growth_pct != null
        ? String(assumption.eth_growth_pct)
        : '',
    spend: spendPlan ? String(spendPlan.annual_target) : '',
  }
}

export interface AssumptionsEdit {
  assumption?: AssumptionInput
  spendPlan?: SpendPlanInput
}

// Build the POST bodies for the assumptions-card Save: one append per
// config whose values actually changed, so the history stays meaningful.
// A spend change carries the guardrail knobs forward — they are edited
// nowhere yet (the Guardrails slice reads them as stored).
export function assumptionsEdits(
  values: AssumptionsFormValues,
  assumption: Assumption | null,
  spendPlan: SpendPlan | null,
  today: string,
): AssumptionsEdit {
  const edit: AssumptionsEdit = {}
  const returnPct = parseNumber(values.returnPct)
  const inflationPct = parseNumber(values.inflationPct)
  const ethGrowthPct = parseNumber(values.ethGrowthPct)
  const assumptionChanged =
    !assumption ||
    returnPct !== assumption.return_pct ||
    inflationPct !== assumption.inflation_pct ||
    (ethGrowthPct ?? null) !== assumption.eth_growth_pct
  if (returnPct != null && inflationPct != null && assumptionChanged) {
    edit.assumption = {
      effective_date: today,
      return_pct: returnPct,
      inflation_pct: inflationPct,
      ...(ethGrowthPct != null && { eth_growth_pct: ethGrowthPct }),
    }
  }
  const spend = parseNumber(values.spend)
  if (spend != null && spend !== spendPlan?.annual_target) {
    edit.spendPlan = {
      effective_date: today,
      annual_target: spend,
      ...(spendPlan?.initial_rate != null && {
        initial_rate: spendPlan.initial_rate,
      }),
      ...(spendPlan != null && { guardrail_band: spendPlan.guardrail_band }),
    }
  }
  return edit
}

export interface SocialSecurityFormValues {
  you: string
  spouse: string
  startAge: string
}

export function socialSecurityFormValues(
  entries: SocialSecurityEntry[],
): SocialSecurityFormValues {
  const amount = (person: 'you' | 'spouse') => {
    const entry = entries.find((e) => e.person === person)
    return entry ? String(entry.monthly_amount) : ''
  }
  return {
    you: amount('you'),
    spouse: amount('spouse'),
    startAge: entries.length > 0 ? String(entries[0].start_age) : '',
  }
}

// One POST per person whose amount or start age actually changed.
export function socialSecurityEdits(
  values: SocialSecurityFormValues,
  entries: SocialSecurityEntry[],
  today: string,
): SocialSecurityInput[] {
  const startAge = parseNumber(values.startAge)
  if (startAge == null) {
    return []
  }
  const inputs: SocialSecurityInput[] = []
  for (const person of ['you', 'spouse'] as const) {
    const amount = parseNumber(person === 'you' ? values.you : values.spouse)
    if (amount == null) {
      continue
    }
    const entry = entries.find((e) => e.person === person)
    if (
      entry &&
      entry.monthly_amount === amount &&
      entry.start_age === startAge
    ) {
      continue
    }
    inputs.push({
      person,
      effective_date: today,
      start_age: startAge,
      monthly_amount: amount,
    })
  }
  return inputs
}
