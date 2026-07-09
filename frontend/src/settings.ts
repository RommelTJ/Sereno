// Pure derivations for the Settings & data view.

import type {
  Account,
  AccountClassificationInput,
  AccountInput,
  Assumption,
  AssumptionInput,
  Category,
  CategoryInput,
  CategoryPlanInput,
  CategoryUpdate,
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

export interface AccountRow {
  id: number
  name: string
  emoji: string
  value: string
  negative: boolean
  account: Account
}

// One Assets or Liabilities section: the active accounts on that side.
// The ledger is newest-first; an account's current value is the first
// balance found walking back through the months. Liabilities are stored
// positive and shown negative.
export function accountRows(
  accounts: Account[],
  ledger: LedgerMonth[],
  isLiability: boolean,
): AccountRow[] {
  const latest = new Map<number, number>()
  for (const month of ledger) {
    for (const entry of month.balances) {
      if (!latest.has(entry.account_id)) {
        latest.set(entry.account_id, entry.balance_usd)
      }
    }
  }
  return accounts
    .filter(
      (account) => account.active && account.is_liability === isLiability,
    )
    .map((account) => {
      const balance = latest.get(account.id) ?? 0
      return {
        id: account.id,
        name: account.name,
        emoji: account.emoji ?? '💰',
        value: formatUsd(isLiability ? -balance : balance),
        negative: isLiability,
        account,
      }
    })
}

// The classification selects mirror the backend's account enums —
// schema.sql's kind and tax_treatment comments and the sourcing engine's
// withdrawal buckets. Mortgage is absent: liabilities are never classified.
export const KIND_OPTIONS = [
  { value: 'other', label: 'Other' },
  { value: 'eth', label: 'Ethereum' },
  { value: 'brokerage_fund', label: 'Brokerage fund' },
  { value: '401k', label: '401(k)' },
  { value: 'roth', label: 'Roth' },
  { value: 'hsa', label: 'HSA' },
  { value: 'cash', label: 'Cash' },
  { value: 'cash_plus', label: 'Cash Plus' },
  { value: 'home', label: 'Home' },
  { value: 'car', label: 'Car' },
]

export const TAX_TREATMENT_OPTIONS = [
  { value: 'NONE', label: 'None' },
  { value: 'LTCG', label: 'Long-term gains' },
  { value: 'ORDINARY', label: 'Ordinary income' },
  { value: 'TAX_FREE', label: 'Tax-free' },
]

export const PRIORITY_OPTIONS = [
  { value: '', label: '—' },
  { value: '1', label: '1 — ETH' },
  { value: '2', label: '2 — Brokerage' },
  { value: '3', label: '3 — Tax-advantaged' },
]

export interface AccountClassificationValues {
  kind: string
  taxTreatment: string
  investable: boolean
  priority: string
  accessAge: string
}

export function classificationValues(
  account: Account,
): AccountClassificationValues {
  return {
    kind: account.kind,
    taxTreatment: account.tax_treatment,
    investable: account.is_investable,
    priority:
      account.withdrawal_priority != null
        ? String(account.withdrawal_priority)
        : '',
    accessAge: account.access_age != null ? String(account.access_age) : '',
  }
}

// Build the PUT /api/accounts/{id} body, or null while the form is invalid
// (an access age that isn't a non-negative number). Blank means
// unrestricted access / no withdrawal priority.
export function classificationInput(
  values: AccountClassificationValues,
): AccountClassificationInput | null {
  const accessAge =
    values.accessAge.trim() === '' ? null : parsePlanned(values.accessAge)
  if (accessAge === undefined) {
    return null
  }
  return {
    kind: values.kind,
    tax_treatment: values.taxTreatment,
    is_investable: values.investable,
    withdrawal_priority:
      values.priority === '' ? null : Number(values.priority),
    access_age: accessAge,
  }
}

// A planned amount must be a plain non-negative number — parseNumber is
// too forgiving here (it strips the minus sign). Commas are formatting,
// not sign, so "2,500" parses.
function parsePlanned(raw: string): number | undefined {
  if (raw.trim() === '') {
    return undefined
  }
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

// Build the POST /api/accounts body, or null while the form is invalid
// (blank name, or an initial value that isn't a non-negative number —
// liabilities are stored positive).
export function accountInput(
  values: { name: string; emoji: string; initialValue: string },
  isLiability: boolean,
): AccountInput | null {
  const name = values.name.trim()
  const initialValue = parsePlanned(values.initialValue)
  if (name === '' || initialValue == null) {
    return null
  }
  const input: AccountInput = {
    name,
    is_liability: isLiability,
    initial_value: initialValue,
  }
  if (values.emoji !== '') {
    input.emoji = values.emoji
  }
  return input
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

export interface EnvelopeEdit {
  update?: CategoryUpdate
  plan?: CategoryPlanInput
}

// Build the row-edit saves — one request per thing that actually changed,
// like assumptionsEdits: a name or emoji change PUTs the category, a
// planned change appends a plan revision. Null while the form is invalid
// (blank name, or a planned amount that isn't a non-negative number).
export function envelopeEdits(
  values: { name: string; emoji: string; planned: string },
  category: Category,
): EnvelopeEdit | null {
  const name = values.name.trim()
  const planned = parsePlanned(values.planned)
  if (name === '' || planned == null) {
    return null
  }
  const edit: EnvelopeEdit = {}
  const emoji = values.emoji === '' ? null : values.emoji
  if (name !== category.name || emoji !== (category.emoji ?? null)) {
    edit.update = { name, emoji }
  }
  if (planned !== category.planned) {
    edit.plan = { planned }
  }
  return edit
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
  initialRatePct: string
  bandPct: string
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
    initialRatePct:
      spendPlan?.initial_rate != null
        ? toPercent(spendPlan.initial_rate)
        : '',
    bandPct: spendPlan ? toPercent(spendPlan.guardrail_band) : '',
  }
}

export interface AssumptionsEdit {
  assumption?: AssumptionInput
  spendPlan?: SpendPlanInput
}

// Build the POST bodies for the assumptions-card Save: one append per
// config whose values actually changed, so the history stays meaningful.
// The rate and band fields hold percent ("2.94") for the stored fractions
// (0.0294). A blank rate clears the anchor — Guardrails returns to its
// empty state — and a blank band falls to the schema's ±20% default.
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
  const initialRate = toFraction(values.initialRatePct) ?? null
  const band = toFraction(values.bandPct)
  const planChanged =
    !spendPlan ||
    spend !== spendPlan.annual_target ||
    initialRate !== spendPlan.initial_rate ||
    (band ?? 0.2) !== spendPlan.guardrail_band
  if (spend != null && planChanged) {
    edit.spendPlan = {
      effective_date: today,
      annual_target: spend,
      ...(initialRate != null && { initial_rate: initialRate }),
      ...(band != null && { guardrail_band: band }),
    }
  }
  return edit
}

// The guardrails a save would derive — initial_rate × (1 ± band) — so
// setup gets immediate feedback without a second write path. Null while
// the rate is blank/invalid; a blank band previews at the schema's ±20%
// default, matching what the save would store.
export function guardrailPreview(values: AssumptionsFormValues): string | null {
  const rate = toFraction(values.initialRatePct)
  if (rate == null) {
    return null
  }
  const band = toFraction(values.bandPct) ?? 0.2
  return `Guardrails: ${formatRate(rate * (1 - band))} – ${formatRate(rate * (1 + band))}`
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

// Stored fraction (0.0294) → percent string ("2.94") — toFraction's
// inverse, for prefilling the percent fields.
function toPercent(fraction: number): string {
  return String(+(fraction * 100).toFixed(4))
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
