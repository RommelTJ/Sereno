// Pure derivations for the Settings & data view.

import type {
  Account,
  Assumption,
  AssumptionInput,
  CategoryInput,
  CategoryPlanInput,
  Fund,
  LedgerMonth,
  SocialSecurityEntry,
  SocialSecurityInput,
  SpendPlan,
  SpendPlanInput,
  TaxBracket,
  TaxParam,
  TaxParamBody,
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

// The curated emoji choices for the add-envelope select — the handoff
// spreadsheet's envelopes first, then common extras. The backend keeps
// emoji as free TEXT; this list constrains only the UI.
export const EMOJI_OPTIONS = [
  { emoji: '🛒', label: 'Groceries' },
  { emoji: '🛢️', label: 'Gas' },
  { emoji: '🤪', label: 'Entertainment' },
  { emoji: '🍻', label: 'Vices' },
  { emoji: '💵', label: 'Consumerism' },
  { emoji: '✈️', label: 'Travel' },
  { emoji: '🏠', label: 'Housing' },
  { emoji: '🏡', label: 'House maintenance' },
  { emoji: '🏥', label: 'Medical' },
  { emoji: '💊', label: 'Pharmacy' },
  { emoji: '🚗', label: 'Car' },
  { emoji: '🚙', label: 'Car insurance' },
  { emoji: '🔧', label: 'Car maintenance' },
  { emoji: '🚰', label: 'Water' },
  { emoji: '⚡', label: 'Electric' },
  { emoji: '🌐', label: 'Internet' },
  { emoji: '📱', label: 'Phone' },
  { emoji: '🗞️', label: 'Subscriptions' },
  { emoji: '👵', label: 'Family' },
  { emoji: '🙏', label: 'Donations' },
  { emoji: '🍽️', label: 'Dining out' },
  { emoji: '☕', label: 'Coffee' },
  { emoji: '🐕', label: 'Pets' },
  { emoji: '🎁', label: 'Gifts' },
  { emoji: '📚', label: 'Education' },
  { emoji: '💇', label: 'Personal care' },
  { emoji: '🏋️', label: 'Fitness' },
  { emoji: '👕', label: 'Clothing' },
  { emoji: '🎮', label: 'Games' },
  { emoji: '🎬', label: 'Movies' },
  { emoji: '🧾', label: 'Taxes & fees' },
  { emoji: '🛡️', label: 'Insurance' },
  { emoji: '👶', label: 'Kids' },
  { emoji: '💰', label: 'Savings' },
]

// A planned amount must be a plain non-negative number — parseNumber is
// too forgiving here (it strips the minus sign).
function parsePlanned(raw: string): number | undefined {
  if (raw.trim() === '') {
    return undefined
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

// Build the POST /api/categories body, or null while the form is invalid
// (blank name, or a planned amount that isn't a non-negative number).
export function envelopeInput(values: {
  name: string
  emoji: string
  planned: string
}): CategoryInput | null {
  const name = values.name.trim()
  const planned = parsePlanned(values.planned)
  if (name === '' || planned == null) {
    return null
  }
  const input: CategoryInput = { name, planned }
  if (values.emoji !== '') {
    input.emoji = values.emoji
  }
  return input
}

// Build the POST /api/categories/{id}/plan body, or null while invalid.
export function envelopePlanInput(planned: string): CategoryPlanInput | null {
  const value = parsePlanned(planned)
  return value == null ? null : { planned: value }
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

// Percent string ("3.8") → stored fraction (0.038), rounded so the
// round-trip through the form never drifts a float.
function toFraction(raw: string): number | undefined {
  const pct = parseNumber(raw)
  return pct == null ? undefined : Number((pct / 100).toFixed(6))
}

export interface TaxBracketValues {
  rate: string
  upto: string
}

export interface TaxFormValues {
  filingStatus: string
  ltcg0: string
  ltcg15: string
  niitRate: string
  niitThreshold: string
  stateTreatment: string
  stdDeduction: string
  brackets: TaxBracketValues[]
}

// Prefill from the displayed year (revising it, or seeding the next
// year's form); a fresh database starts from the schema defaults.
export function taxFormValues(param: TaxParam | null): TaxFormValues {
  if (!param) {
    return {
      filingStatus: 'MFJ',
      ltcg0: '',
      ltcg15: '',
      niitRate: '3.8',
      niitThreshold: '',
      stateTreatment: 'CA_ordinary',
      stdDeduction: '',
      brackets: [],
    }
  }
  return {
    filingStatus: param.filing_status,
    ltcg0: String(param.ltcg_0_ceiling),
    ltcg15: param.ltcg_15_ceiling != null ? String(param.ltcg_15_ceiling) : '',
    niitRate: String(+(param.niit_rate * 100).toFixed(2)),
    niitThreshold:
      param.niit_threshold != null ? String(param.niit_threshold) : '',
    stateTreatment: param.state_treatment,
    stdDeduction: param.std_deduction != null ? String(param.std_deduction) : '',
    brackets: (param.ordinary_brackets ?? []).map((bracket) => ({
      rate: String(+(bracket.rate * 100).toFixed(2)),
      upto: bracket.upto != null ? String(bracket.upto) : '',
    })),
  }
}

// The shared POST/PUT body; null while the required fields are blank.
// Blank optionals are omitted, a blank bracket "up to" is the top
// bracket (upto null), and bracket rows without a rate are dropped.
export function taxParamBody(values: TaxFormValues): TaxParamBody | null {
  const ltcg0 = parseNumber(values.ltcg0)
  const niitRate = toFraction(values.niitRate)
  const filingStatus = values.filingStatus.trim()
  const stateTreatment = values.stateTreatment.trim()
  if (ltcg0 == null || niitRate == null || !filingStatus || !stateTreatment) {
    return null
  }
  const ltcg15 = parseNumber(values.ltcg15)
  const niitThreshold = parseNumber(values.niitThreshold)
  const stdDeduction = parseNumber(values.stdDeduction)
  const brackets: TaxBracket[] = []
  for (const row of values.brackets) {
    const rate = toFraction(row.rate)
    if (rate != null) {
      brackets.push({ rate, upto: parseNumber(row.upto) ?? null })
    }
  }
  return {
    filing_status: filingStatus,
    ltcg_0_ceiling: ltcg0,
    ...(ltcg15 != null && { ltcg_15_ceiling: ltcg15 }),
    niit_rate: niitRate,
    ...(niitThreshold != null && { niit_threshold: niitThreshold }),
    state_treatment: stateTreatment,
    ...(stdDeduction != null && { std_deduction: stdDeduction }),
    ...(brackets.length > 0 && { ordinary_brackets: brackets }),
  }
}
