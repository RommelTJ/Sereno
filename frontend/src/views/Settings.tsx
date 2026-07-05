import { useEffect, useState } from 'react'
import type {
  Account,
  AccountInput,
  Assumption,
  Category,
  CategoryInput,
  CategoryPlanInput,
  LedgerMonth,
  SocialSecurityEntry,
  SocialSecurityInput,
  SpendPlan,
  TaxParam,
  TaxParamBody,
  TaxParamInput,
} from '../api.ts'
import {
  createAccount,
  createAssumption,
  createCategory,
  createSocialSecurity,
  createSpendPlan,
  createTaxParam,
  deactivateAccount,
  fetchAccounts,
  fetchAssumptions,
  fetchCategories,
  fetchLedger,
  fetchSocialSecurity,
  fetchSpendPlan,
  fetchTaxParams,
  updateCategoryPlan,
  updateTaxParam,
} from '../api.ts'
import { FieldLabel } from '../components/SpendingForm.tsx'
import { formatUsd, todayIso } from '../ledger.ts'
import type {
  AccountRow,
  AssumptionsEdit,
  TaxFormValues,
} from '../settings.ts'
import {
  accountInput,
  accountRows,
  ASSET_EMOJI_OPTIONS,
  assumptionsEdits,
  assumptionsFormValues,
  bracketLabel,
  EMOJI_OPTIONS,
  envelopeInput,
  envelopePlanInput,
  formatPct,
  formatRate,
  socialSecurityEdits,
  socialSecurityFormValues,
  taxFormValues,
  taxParamBody,
} from '../settings.ts'

interface SettingsData {
  accounts: Account[]
  ledger: LedgerMonth[]
  categories: Category[]
  assumption: Assumption | null
  spendPlan: SpendPlan | null
  socialSecurity: SocialSecurityEntry[]
  taxParams: TaxParam[]
}

function Card({
  title,
  hint,
  action,
  testId,
  children,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-card border border-card-border bg-card p-[22px]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold">
          {title}
          {hint && (
            <span className="font-medium text-[11.5px] text-muted-2">
              {' '}
              {hint}
            </span>
          )}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

function GhostButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[8px] border border-input-border bg-card px-3 py-1 text-[11.5px] font-semibold text-muted"
    >
      {label}
    </button>
  )
}

function EditButton({ onClick }: { onClick: () => void }) {
  return <GhostButton label="Edit" onClick={onClick} />
}

function SaveButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-[8px] bg-accent px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-60"
    >
      Save
    </button>
  )
}

function EditField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label htmlFor={id} className="block">
      <FieldLabel text={label} />
      <input
        id={id}
        className="num mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function AccountRowItem({
  row,
  testId,
  onDeactivate,
}: {
  row: AccountRow
  testId: string
  onDeactivate: (accountId: number) => Promise<void>
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between border-b border-hairline-2 py-[11px] text-[13px] last:border-b-0"
    >
      <p className="font-semibold">
        <span className="mr-2">{row.emoji}</span>
        <span>{row.name}</span>
      </p>
      <div className="flex items-center gap-3">
        <p className={`num font-bold ${row.negative ? 'text-red' : ''}`}>
          {row.value}
        </p>
        <GhostButton
          label="Deactivate"
          onClick={() => void onDeactivate(row.id)}
        />
      </div>
    </div>
  )
}

function AccountsCard({
  title,
  hint,
  testId,
  rowTestId,
  idPrefix,
  liability,
  rows,
  onAdd,
  onDeactivate,
}: {
  title: string
  hint: string
  testId: string
  rowTestId: string
  idPrefix: string
  liability: boolean
  rows: AccountRow[]
  onAdd: (input: AccountInput) => Promise<void>
  onDeactivate: (accountId: number) => Promise<void>
}) {
  const [values, setValues] = useState({ name: '', emoji: '', initialValue: '' })
  const [adding, setAdding] = useState(false)

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  const add = async () => {
    const input = accountInput(values, liability)
    if (!input) {
      return
    }
    setAdding(true)
    try {
      await onAdd(input)
      setValues({ name: '', emoji: '', initialValue: '' })
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card title={title} hint={hint} testId={testId}>
      <div className="mt-2">
        {rows.length === 0 && (
          <p className="text-[12.5px] leading-8 text-muted-2">none yet</p>
        )}
        {rows.map((row) => (
          <AccountRowItem
            key={row.id}
            row={row}
            testId={rowTestId}
            onDeactivate={onDeactivate}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 items-end gap-[11px] border-t border-hairline-2 pt-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <EditField
          id={`${idPrefix}-name`}
          label="Name"
          value={values.name}
          onChange={set('name')}
        />
        <label htmlFor={`${idPrefix}-emoji`} className="block">
          <FieldLabel text="Emoji" />
          <select
            id={`${idPrefix}-emoji`}
            className="mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2 text-sm"
            value={values.emoji}
            onChange={(event) => set('emoji')(event.target.value)}
          >
            <option value="">—</option>
            {ASSET_EMOJI_OPTIONS.map((option) => (
              <option key={option.label} value={option.emoji}>
                {option.emoji} {option.label}
              </option>
            ))}
          </select>
        </label>
        <EditField
          id={`${idPrefix}-value`}
          label="Initial value"
          value={values.initialValue}
          onChange={set('initialValue')}
        />
        <button
          type="button"
          disabled={adding}
          onClick={() => void add()}
          className="cursor-pointer rounded-[8px] bg-accent px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          + Add
        </button>
      </div>
    </Card>
  )
}

function ConfigLine({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <p className="text-[12.5px] leading-8 text-muted">
      {label} <b className="num text-ink">{value}</b>
      {hint && <span className="text-muted-2"> {hint}</span>}
    </p>
  )
}

function EnvelopeRow({
  category,
  onRevise,
}: {
  category: Category
  onRevise: (categoryId: number, input: CategoryPlanInput) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [planned, setPlanned] = useState('')

  const startEditing = () => {
    setPlanned(String(category.planned))
    setEditing(true)
  }

  const save = async () => {
    const input = envelopePlanInput(planned)
    if (!input) {
      return
    }
    setSaving(true)
    try {
      await onRevise(category.id, input)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="settings-envelope-row"
      className="flex items-center justify-between border-b border-hairline-2 py-[11px] text-[13px] last:border-b-0"
    >
      <p className="font-semibold">
        <span className="mr-2">{category.emoji ?? '🧾'}</span>
        <span>{category.name}</span>
      </p>
      {editing ? (
        <div className="flex items-end gap-2">
          <EditField
            id={`envelope-planned-${category.id}`}
            label="$ / month"
            value={planned}
            onChange={setPlanned}
          />
          <SaveButton disabled={saving} onClick={() => void save()} />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="num font-bold">{formatUsd(category.planned)} / mo</p>
          <EditButton onClick={startEditing} />
        </div>
      )}
    </div>
  )
}

function EnvelopesCard({
  categories,
  onAdd,
  onRevise,
}: {
  categories: Category[]
  onAdd: (input: CategoryInput) => Promise<void>
  onRevise: (categoryId: number, input: CategoryPlanInput) => Promise<void>
}) {
  const [values, setValues] = useState({ name: '', emoji: '', planned: '' })
  const [adding, setAdding] = useState(false)

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  const add = async () => {
    const input = envelopeInput(values)
    if (!input) {
      return
    }
    setAdding(true)
    try {
      await onAdd(input)
      setValues({ name: '', emoji: '', planned: '' })
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card
      title="Envelopes"
      hint="· planned $ / month, effective-dated"
      testId="envelopes-card"
    >
      <div className="mt-2">
        {categories.length === 0 && (
          <p className="text-[12.5px] leading-8 text-muted-2">
            no envelopes yet
          </p>
        )}
        {categories.map((category) => (
          <EnvelopeRow
            key={category.id}
            category={category}
            onRevise={onRevise}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 items-end gap-[11px] border-t border-hairline-2 pt-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <EditField
          id="envelope-name"
          label="Name"
          value={values.name}
          onChange={set('name')}
        />
        <label htmlFor="envelope-emoji" className="block">
          <FieldLabel text="Emoji" />
          <select
            id="envelope-emoji"
            className="mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2 text-sm"
            value={values.emoji}
            onChange={(event) => set('emoji')(event.target.value)}
          >
            <option value="">—</option>
            {EMOJI_OPTIONS.map((option) => (
              <option key={option.label} value={option.emoji}>
                {option.emoji} {option.label}
              </option>
            ))}
          </select>
        </label>
        <EditField
          id="envelope-amount"
          label="$ / month"
          value={values.planned}
          onChange={set('planned')}
        />
        <button
          type="button"
          disabled={adding}
          onClick={() => void add()}
          className="cursor-pointer rounded-[8px] bg-accent px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          + Add
        </button>
      </div>
    </Card>
  )
}

function AssumptionsCard({
  assumption,
  spendPlan,
  onSave,
}: {
  assumption: Assumption | null
  spendPlan: SpendPlan | null
  onSave: (edit: AssumptionsEdit) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState(() =>
    assumptionsFormValues(assumption, spendPlan),
  )

  const startEditing = () => {
    setValues(assumptionsFormValues(assumption, spendPlan))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(assumptionsEdits(values, assumption, spendPlan, todayIso()))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  return (
    <Card
      title="Assumptions"
      testId="assumptions-card"
      action={
        editing ? (
          <SaveButton disabled={saving} onClick={() => void save()} />
        ) : (
          <EditButton onClick={startEditing} />
        )
      }
    >
      {editing ? (
        <div className="mt-3 grid grid-cols-1 gap-[11px] sm:grid-cols-2">
          <EditField
            id="assumption-return"
            label="Return %"
            value={values.returnPct}
            onChange={set('returnPct')}
          />
          <EditField
            id="assumption-inflation"
            label="Inflation %"
            value={values.inflationPct}
            onChange={set('inflationPct')}
          />
          <EditField
            id="assumption-eth"
            label="ETH growth %"
            value={values.ethGrowthPct}
            onChange={set('ethGrowthPct')}
          />
          <EditField
            id="assumption-spend"
            label="Spend $ / yr"
            value={values.spend}
            onChange={set('spend')}
          />
        </div>
      ) : (
        <div className="mt-3">
          <ConfigLine
            label="Return"
            value={formatPct(assumption?.return_pct)}
          />
          <ConfigLine
            label="Inflation"
            value={formatPct(assumption?.inflation_pct)}
          />
          <ConfigLine
            label="ETH growth"
            value={formatPct(assumption?.eth_growth_pct)}
            hint="· refined from tracking"
          />
          <ConfigLine
            label="Planned spend"
            value={
              spendPlan ? `${formatUsd(spendPlan.annual_target)} / yr` : '—'
            }
          />
        </div>
      )}
    </Card>
  )
}

function SocialSecurityCard({
  socialSecurity,
  onSave,
}: {
  socialSecurity: SocialSecurityEntry[]
  onSave: (inputs: SocialSecurityInput[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState(() =>
    socialSecurityFormValues(socialSecurity),
  )

  const startEditing = () => {
    setValues(socialSecurityFormValues(socialSecurity))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(socialSecurityEdits(values, socialSecurity, todayIso()))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  return (
    <Card
      title="Social Security"
      hint="· editable, dated"
      testId="social-security-card"
      action={
        editing ? (
          <SaveButton disabled={saving} onClick={() => void save()} />
        ) : (
          <EditButton onClick={startEditing} />
        )
      }
    >
      {editing ? (
        <div className="mt-3 grid grid-cols-1 gap-[11px] sm:grid-cols-3">
          <EditField
            id="ss-you"
            label="You $ / mo"
            value={values.you}
            onChange={set('you')}
          />
          <EditField
            id="ss-spouse"
            label="Spouse $ / mo"
            value={values.spouse}
            onChange={set('spouse')}
          />
          <EditField
            id="ss-start-age"
            label="Start age"
            value={values.startAge}
            onChange={set('startAge')}
          />
        </div>
      ) : (
        <div className="mt-3">
          {socialSecurity.length === 0 && (
            <p className="text-[12.5px] leading-8 text-muted-2">
              no estimates yet
            </p>
          )}
          {socialSecurity.map((entry) => (
            <ConfigLine
              key={entry.person}
              label={`${entry.person === 'you' ? 'You' : 'Spouse'} — from ${entry.start_age}`}
              value={`${formatUsd(entry.monthly_amount)}/mo`}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function TaxCard({
  taxParam,
  onRevise,
  onAdd,
}: {
  taxParam: TaxParam | null
  onRevise: (taxYear: number, body: TaxParamBody) => Promise<void>
  onAdd: (input: TaxParamInput) => Promise<void>
}) {
  const [mode, setMode] = useState<'view' | 'revise' | 'add'>('view')
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState(() => taxFormValues(taxParam))

  const addYear = taxParam ? taxParam.tax_year + 1 : new Date().getFullYear()

  const start = (nextMode: 'revise' | 'add') => {
    setValues(taxFormValues(taxParam))
    setMode(nextMode)
  }

  const save = async () => {
    const body = taxParamBody(values)
    if (!body) {
      return
    }
    setSaving(true)
    try {
      if (mode === 'revise' && taxParam) {
        await onRevise(taxParam.tax_year, body)
      } else {
        await onAdd({ tax_year: addYear, ...body })
      }
      setMode('view')
    } finally {
      setSaving(false)
    }
  }

  const set = (key: Exclude<keyof TaxFormValues, 'brackets'>) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  const setBracket = (index: number, key: 'rate' | 'upto', value: string) =>
    setValues((current) => ({
      ...current,
      brackets: current.brackets.map((row, i) =>
        i === index ? { ...row, [key]: value } : row,
      ),
    }))

  return (
    <Card
      title="Tax parameters"
      hint={taxParam ? `${taxParam.tax_year} · ${taxParam.filing_status}` : undefined}
      testId="tax-card"
      action={
        mode === 'view' ? (
          <div className="flex gap-2">
            {taxParam && <EditButton onClick={() => start('revise')} />}
            <GhostButton
              label={`+ Add ${addYear}`}
              onClick={() => start('add')}
            />
          </div>
        ) : (
          <SaveButton disabled={saving} onClick={() => void save()} />
        )
      }
    >
      {mode !== 'view' && (
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-[11px] sm:grid-cols-2">
            <EditField
              id="tax-filing"
              label="Filing status"
              value={values.filingStatus}
              onChange={set('filingStatus')}
            />
            <EditField
              id="tax-state"
              label="State treatment"
              value={values.stateTreatment}
              onChange={set('stateTreatment')}
            />
            <EditField
              id="tax-ltcg0"
              label="0% LTCG up to $"
              value={values.ltcg0}
              onChange={set('ltcg0')}
            />
            <EditField
              id="tax-ltcg15"
              label="15% → 20% at $"
              value={values.ltcg15}
              onChange={set('ltcg15')}
            />
            <EditField
              id="tax-niit-rate"
              label="NIIT rate %"
              value={values.niitRate}
              onChange={set('niitRate')}
            />
            <EditField
              id="tax-niit-threshold"
              label="NIIT over $"
              value={values.niitThreshold}
              onChange={set('niitThreshold')}
            />
            <EditField
              id="tax-std"
              label="Std deduction $"
              value={values.stdDeduction}
              onChange={set('stdDeduction')}
            />
          </div>
          {values.brackets.length > 0 && (
            <p className="mt-3 text-[11.5px] text-muted-2">
              Ordinary brackets · blank up-to = top bracket
            </p>
          )}
          {values.brackets.map((row, index) => (
            <div
              // Rows are positional form state; there is no stable id.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className="mt-[7px] grid grid-cols-1 gap-[11px] sm:grid-cols-2"
            >
              <EditField
                id={`tax-bracket-rate-${index}`}
                label={`Bracket ${index + 1} rate %`}
                value={row.rate}
                onChange={(value) => setBracket(index, 'rate', value)}
              />
              <EditField
                id={`tax-bracket-upto-${index}`}
                label={`Bracket ${index + 1} up to $`}
                value={row.upto}
                onChange={(value) => setBracket(index, 'upto', value)}
              />
            </div>
          ))}
        </div>
      )}
      {mode === 'view' && !taxParam && (
        <p className="mt-3 text-[12.5px] leading-8 text-muted-2">
          no tax years loaded yet
        </p>
      )}
      {mode === 'view' && taxParam && (
        <div className="mt-3">
          <ConfigLine
            label="0% LTCG up to"
            value={formatUsd(taxParam.ltcg_0_ceiling)}
          />
          <ConfigLine
            label="15% → 20% at"
            value={
              taxParam.ltcg_15_ceiling != null
                ? formatUsd(taxParam.ltcg_15_ceiling)
                : '—'
            }
          />
          <ConfigLine
            label="NIIT"
            value={
              taxParam.niit_threshold != null
                ? `${formatRate(taxParam.niit_rate)} over ${formatUsd(taxParam.niit_threshold)}`
                : formatRate(taxParam.niit_rate)
            }
          />
          <ConfigLine
            label="Std deduction"
            value={
              taxParam.std_deduction != null
                ? formatUsd(taxParam.std_deduction)
                : '—'
            }
          />
          <ConfigLine label="State" value={taxParam.state_treatment} />
          {taxParam.ordinary_brackets && (
            <div className="mt-2">
              <p className="text-[11.5px] text-muted-2">Ordinary brackets</p>
              {taxParam.ordinary_brackets.map((bracket) => (
                <p
                  key={bracket.rate}
                  className="num text-[12.5px] leading-7 text-muted"
                >
                  {bracketLabel(bracket)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function DataNote() {
  return (
    <div
      data-testid="data-note"
      className="rounded-card bg-sidebar p-[22px] text-sidebar-text"
    >
      <p className="text-[13px] font-bold text-white">
        Data model · append-only
      </p>
      <p className="mt-2 text-xs leading-relaxed text-sidebar-muted">
        Never UPDATE a balance — INSERT a dated row. Every fact is
        effective-dated; reports use the latest row per month. The full{' '}
        <b className="text-sidebar-text">schema.sql</b> lives in docs/design
        for the LAN database &amp; AI agent.
      </p>
    </div>
  )
}

function Settings() {
  const [data, setData] = useState<SettingsData | null>(null)

  useEffect(() => {
    void Promise.all([
      fetchAccounts(),
      fetchLedger(),
      fetchCategories(),
      fetchAssumptions(),
      fetchSpendPlan(),
      fetchSocialSecurity(),
      fetchTaxParams(),
    ]).then(
      ([
        accounts,
        ledger,
        categories,
        assumption,
        spendPlan,
        socialSecurity,
        taxParams,
      ]) =>
        setData({
          accounts,
          ledger,
          categories,
          assumption,
          spendPlan,
          socialSecurity,
          taxParams,
        }),
    )
  }, [])

  const refetchAccounts = async () => {
    const [accounts, ledger] = await Promise.all([
      fetchAccounts(),
      fetchLedger(),
    ])
    setData((current) => (current ? { ...current, accounts, ledger } : current))
  }

  const addAccount = async (input: AccountInput) => {
    await createAccount(input)
    await refetchAccounts()
  }

  const removeAccount = async (accountId: number) => {
    await deactivateAccount(accountId)
    await refetchAccounts()
  }

  const refetchCategories = async () => {
    const categories = await fetchCategories()
    setData((current) => (current ? { ...current, categories } : current))
  }

  const addEnvelope = async (input: CategoryInput) => {
    await createCategory(input)
    await refetchCategories()
  }

  const reviseEnvelope = async (categoryId: number, input: CategoryPlanInput) => {
    await updateCategoryPlan(categoryId, input)
    await refetchCategories()
  }

  const saveAssumptions = async (edit: AssumptionsEdit) => {
    if (edit.assumption) {
      await createAssumption(edit.assumption)
    }
    if (edit.spendPlan) {
      await createSpendPlan(edit.spendPlan)
    }
    const [assumption, spendPlan] = await Promise.all([
      fetchAssumptions(),
      fetchSpendPlan(),
    ])
    setData((current) => (current ? { ...current, assumption, spendPlan } : current))
  }

  const saveSocialSecurity = async (inputs: SocialSecurityInput[]) => {
    for (const input of inputs) {
      await createSocialSecurity(input)
    }
    const socialSecurity = await fetchSocialSecurity()
    setData((current) => (current ? { ...current, socialSecurity } : current))
  }

  const refetchTaxParams = async () => {
    const taxParams = await fetchTaxParams()
    setData((current) => (current ? { ...current, taxParams } : current))
  }

  const reviseTaxParam = async (taxYear: number, body: TaxParamBody) => {
    await updateTaxParam(taxYear, body)
    await refetchTaxParams()
  }

  const addTaxParam = async (input: TaxParamInput) => {
    await createTaxParam(input)
    await refetchTaxParams()
  }

  if (!data) {
    return <div data-testid="view-settings" />
  }

  return (
    <div data-testid="view-settings" className="flex max-w-[880px] flex-col gap-5">
      <AccountsCard
        title="Assets"
        hint="· latest ledger value; later values go through the Ledger"
        testId="assets-card"
        rowTestId="settings-asset-row"
        idPrefix="asset"
        liability={false}
        rows={accountRows(data.accounts, data.ledger, false)}
        onAdd={addAccount}
        onDeactivate={removeAccount}
      />
      <AccountsCard
        title="Liabilities"
        hint="· stored positive, shown negative"
        testId="liabilities-card"
        rowTestId="settings-liability-row"
        idPrefix="liability"
        liability
        rows={accountRows(data.accounts, data.ledger, true)}
        onAdd={addAccount}
        onDeactivate={removeAccount}
      />
      <EnvelopesCard
        categories={data.categories}
        onAdd={addEnvelope}
        onRevise={reviseEnvelope}
      />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <AssumptionsCard
          assumption={data.assumption}
          spendPlan={data.spendPlan}
          onSave={saveAssumptions}
        />
        <SocialSecurityCard
          socialSecurity={data.socialSecurity}
          onSave={saveSocialSecurity}
        />
      </div>
      <TaxCard
        taxParam={data.taxParams.at(-1) ?? null}
        onRevise={reviseTaxParam}
        onAdd={addTaxParam}
      />
      <DataNote />
    </div>
  )
}

export default Settings
