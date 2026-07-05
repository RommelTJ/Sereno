import { useEffect, useState } from 'react'
import type {
  Account,
  Assumption,
  Fund,
  LedgerMonth,
  SocialSecurityEntry,
  SpendPlan,
  TaxParam,
} from '../api.ts'
import {
  fetchAccounts,
  fetchAssumptions,
  fetchFunds,
  fetchLedger,
  fetchSocialSecurity,
  fetchSpendPlan,
  fetchTaxParams,
} from '../api.ts'
import { formatUsd } from '../ledger.ts'
import type { BucketRow } from '../settings.ts'
import {
  accountRows,
  bracketLabel,
  formatPct,
  formatRate,
  fundRows,
} from '../settings.ts'

interface SettingsData {
  accounts: Account[]
  ledger: LedgerMonth[]
  funds: Fund[]
  assumption: Assumption | null
  spendPlan: SpendPlan | null
  socialSecurity: SocialSecurityEntry[]
  taxParams: TaxParam[]
}

function Card({
  title,
  hint,
  testId,
  children,
}: {
  title: string
  hint?: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-card border border-card-border bg-card p-[22px]"
    >
      <p className="text-[13px] font-bold">
        {title}
        {hint && (
          <span className="font-medium text-[11.5px] text-muted-2"> {hint}</span>
        )}
      </p>
      {children}
    </div>
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

function AssumptionsCard({
  assumption,
  spendPlan,
}: {
  assumption: Assumption | null
  spendPlan: SpendPlan | null
}) {
  return (
    <Card title="Assumptions" testId="assumptions-card">
      <div className="mt-3">
        <ConfigLine label="Return" value={formatPct(assumption?.return_pct)} />
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
          value={spendPlan ? `${formatUsd(spendPlan.annual_target)} / yr` : '—'}
        />
      </div>
    </Card>
  )
}

function SocialSecurityCard({
  socialSecurity,
}: {
  socialSecurity: SocialSecurityEntry[]
}) {
  return (
    <Card
      title="Social Security"
      hint="· editable, dated"
      testId="social-security-card"
    >
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
    </Card>
  )
}

function TaxCard({ taxParam }: { taxParam: TaxParam | null }) {
  return (
    <Card
      title="Tax parameters"
      hint={taxParam ? `${taxParam.tax_year} · ${taxParam.filing_status}` : undefined}
      testId="tax-card"
    >
      {!taxParam && (
        <p className="mt-3 text-[12.5px] leading-8 text-muted-2">
          no tax years loaded yet
        </p>
      )}
      {taxParam && (
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
      fetchAssumptions(),
      fetchSpendPlan(),
      fetchSocialSecurity(),
      fetchTaxParams(),
    ]).then(
      ([
        accounts,
        ledger,
        funds,
        assumption,
        spendPlan,
        socialSecurity,
        taxParams,
      ]) =>
        setData({
          accounts,
          ledger,
          funds,
          assumption,
          spendPlan,
          socialSecurity,
          taxParams,
        }),
    )
  }, [])

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
      <div className="grid grid-cols-2 gap-5">
        <AssumptionsCard
          assumption={data.assumption}
          spendPlan={data.spendPlan}
        />
        <SocialSecurityCard socialSecurity={data.socialSecurity} />
      </div>
      <TaxCard taxParam={data.taxParams.at(-1) ?? null} />
      <DataNote />
    </div>
  )
}

export default Settings
