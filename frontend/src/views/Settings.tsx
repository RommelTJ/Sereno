import { useEffect, useState } from 'react'
import type {
  Account,
  Assumption,
  Category,
  Fund,
  LedgerMonth,
  SocialSecurityEntry,
  SocialSecurityInput,
  SpendPlan,
  TaxParam,
  TaxParamBody,
  TaxParamInput,
} from '../api.ts'
import {
  createAssumption,
  createSocialSecurity,
  createSpendPlan,
  createTaxParam,
  fetchAccounts,
  fetchAssumptions,
  fetchCategories,
  fetchFunds,
  fetchLedger,
  fetchSocialSecurity,
  fetchSpendPlan,
  fetchTaxParams,
  updateTaxParam,
} from '../api.ts'
import { FieldLabel } from '../components/SpendingForm.tsx'
import { formatUsd, todayIso } from '../ledger.ts'
import type {
  AssumptionsEdit,
  BucketRow,
  TaxFormValues,
} from '../settings.ts'
import {
  accountRows,
  assumptionsEdits,
  assumptionsFormValues,
  bracketLabel,
  formatPct,
  formatRate,
  fundRows,
  socialSecurityEdits,
  socialSecurityFormValues,
  taxFormValues,
  taxParamBody,
} from '../settings.ts'

interface SettingsData {
  accounts: Account[]
  ledger: LedgerMonth[]
  funds: Fund[]
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

function Bucket({ row, testId }: { row: BucketRow; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between border-b border-hairline-2 py-[11px] text-[13px] last:border-b-0"
    >
      <p className="font-semibold">
        {row.name}{' '}
        <span className="font-normal text-[11.5px] text-muted-2">
          · {row.tag}
        </span>
      </p>
      <p className={`num font-bold ${row.negative ? 'text-red' : ''}`}>
        {row.value}
      </p>
    </div>
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

function EnvelopesCard({ categories }: { categories: Category[] }) {
  return (
    <Card
      title="Envelopes"
      hint="· planned $ / month"
      testId="envelopes-card"
    >
      <div className="mt-2">
        {categories.length === 0 && (
          <p className="text-[12.5px] leading-8 text-muted-2">
            no envelopes yet
          </p>
        )}
        {categories.map((category) => (
          <div
            key={category.id}
            data-testid="settings-envelope-row"
            className="flex items-center justify-between border-b border-hairline-2 py-[11px] text-[13px] last:border-b-0"
          >
            <p className="font-semibold">
              <span className="mr-2">{category.emoji ?? '🧾'}</span>
              <span>{category.name}</span>
            </p>
            <p className="num font-bold">{formatUsd(category.planned)} / mo</p>
          </div>
        ))}
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
        <div className="mt-3 grid grid-cols-2 gap-[11px]">
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
        <div className="mt-3 grid grid-cols-3 gap-[11px]">
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
          <div className="grid grid-cols-2 gap-[11px]">
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
              className="mt-[7px] grid grid-cols-2 gap-[11px]"
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
      fetchFunds(),
      fetchCategories(),
      fetchAssumptions(),
      fetchSpendPlan(),
      fetchSocialSecurity(),
      fetchTaxParams(),
    ]).then(
      ([
        accounts,
        ledger,
        funds,
        categories,
        assumption,
        spendPlan,
        socialSecurity,
        taxParams,
      ]) =>
        setData({
          accounts,
          ledger,
          funds,
          categories,
          assumption,
          spendPlan,
          socialSecurity,
          taxParams,
        }),
    )
  }, [])

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
      <Card title="Accounts & buckets">
        <div className="mt-2">
          {accountRows(data.accounts, data.ledger).map((row) => (
            <Bucket key={row.key} row={row} testId="settings-account-row" />
          ))}
          {fundRows(data.funds).map((row) => (
            <Bucket key={row.key} row={row} testId="settings-fund-row" />
          ))}
        </div>
      </Card>
      <EnvelopesCard categories={data.categories} />
      <div className="grid grid-cols-2 gap-5">
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
