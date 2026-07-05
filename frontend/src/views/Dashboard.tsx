import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { ActivityTone } from '../dashboard.ts'
import { fundsMini, recentActivity, stsBarPct } from '../dashboard.ts'
import { totalParked } from '../funds.ts'
import { formatRate, markerLeftPct, zoneCopy } from '../guardrails.ts'
import { formatUsd } from '../ledger.ts'
import { useNetWorth } from '../netWorth.ts'
import type { BudgetMonth, Fund, Guardrails, NetWorthPoint } from '../api.ts'
import { fetchBudgetMonth, fetchFunds, fetchGuardrails } from '../api.ts'

// "▲ 5.7%" / "▼ 2.3%" — the API's yoy is a fraction vs. the same month a
// year earlier (null until 12 months of history exist).
const yoyLabel = (yoy: number) =>
  `${yoy >= 0 ? '▲' : '▼'} ${Math.abs(yoy * 100).toFixed(1)}%`

// The YoY baseline month: a year before the newest series point,
// e.g. "2026-06" → "Jun 2025".
function baselineLabel(series: NetWorthPoint[]): string {
  const [year, month] = series[series.length - 1].month.split('-').map(Number)
  return new Date(year - 1, month - 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

function Sparkline({ series }: { series: NetWorthPoint[] }) {
  const max = Math.max(...series.map((point) => point.net_worth))
  return (
    <div className="mt-6 flex h-[70px] items-end gap-[7px]">
      {series.map((point) => (
        <div
          key={point.month}
          data-testid="spark-bar"
          className="flex-1 rounded-t-[3px] bg-accent/40"
          style={{ height: `${(point.net_worth / max) * 100}%` }}
        />
      ))}
    </div>
  )
}

function NetWorthHero() {
  const { netWorth } = useNetWorth()
  return (
    <div className="relative overflow-hidden rounded-hero bg-sidebar p-7 text-white">
      <p className="text-[11px] font-semibold tracking-[1.4px] text-sidebar-muted-2 uppercase">
        Net worth
      </p>
      <p className="num mt-1.5 text-[52px] leading-none font-extrabold tracking-[-1.5px] text-hero-green">
        {netWorth?.current != null ? formatUsd(netWorth.current) : '$—'}
      </p>
      {netWorth?.yoy != null && (
        <div className="mt-2 flex items-center gap-2.5">
          <span className="num rounded-pill bg-accent px-2.5 py-[3px] text-[13px] font-bold">
            {yoyLabel(netWorth.yoy)}
          </span>
          {netWorth.series.length > 0 && (
            <span className="text-[13px] text-sidebar-muted">
              vs. {baselineLabel(netWorth.series)}
            </span>
          )}
        </div>
      )}
      {netWorth != null && netWorth.series.length > 0 && (
        <Sparkline series={netWorth.series} />
      )}
    </div>
  )
}

// Deep-link card shell. The Longevity values are static, sanitized
// illustrations from the design handoff until the forecast slice lands.
function CardLink({
  to,
  label,
  className = 'rounded-card p-[22px]',
  children,
}: {
  to: string
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      className={`block border border-card-border bg-card ${className}`}
    >
      <p className="text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
        {label}
      </p>
      {children}
    </Link>
  )
}

function SafeToSpendCard({ budget }: { budget: BudgetMonth | null }) {
  return (
    <CardLink
      to="/safe-to-spend"
      label="Safe-to-spend"
      className="flex flex-col justify-between rounded-hero p-[26px]"
    >
      <div>
        <p className="num mt-1.5 text-[44px] leading-none font-extrabold tracking-[-1px] text-accent">
          {budget != null ? formatUsd(budget.safe_to_spend) : '$—'}
        </p>
        <p className="mt-2 text-[12.5px] text-muted">free after bills & funds</p>
      </div>
      <div className="mt-4.5 h-2 overflow-hidden rounded-[5px] bg-track">
        <div
          data-testid="sts-bar"
          className="h-full bg-accent"
          style={{ width: `${budget != null ? stsBarPct(budget) : 0}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-2">See the full breakdown →</p>
    </CardLink>
  )
}

function GuardrailCard({ guardrails }: { guardrails: Guardrails | null }) {
  const cut = guardrails?.zone === 'cut'
  return (
    <CardLink to="/guardrails" label="Spend guardrail">
      <p
        className={`num mt-1.5 text-[30px] font-extrabold ${
          guardrails != null ? (cut ? 'text-red' : 'text-accent') : 'text-muted-2'
        }`}
      >
        {guardrails != null ? formatRate(guardrails.rate) : '—'}
      </p>
      <p className="text-xs text-muted">withdrawal rate</p>
      <div className="relative mt-3.5 flex h-[9px] overflow-hidden rounded-[6px] border border-card-border">
        <div className="flex-1 bg-red-soft-2" />
        <div className="flex-2 bg-green-soft-2" />
        <div className="flex-1 bg-amber-soft" />
        {guardrails != null && (
          <div
            data-testid="guardrail-marker"
            className="absolute top-0 h-full w-0.5 bg-ink"
            style={{
              left: `${markerLeftPct(guardrails.rate, guardrails.lower, guardrails.upper)}%`,
            }}
          />
        )}
      </div>
      <p
        className={`mt-3 text-[13px] font-bold ${
          guardrails != null ? (cut ? 'text-red' : 'text-accent') : 'text-muted-2'
        }`}
      >
        {guardrails != null
          ? zoneCopy(guardrails.zone, guardrails.spend).status
          : 'no spend plan yet'}
      </p>
    </CardLink>
  )
}

function LongevityCard() {
  return (
    <CardLink to="/forecast" label="Longevity">
      <p className="mt-1.5 text-[22px] leading-tight font-extrabold text-accent">
        You don't run out.
      </p>
      <p className="mt-2 text-[12.5px] text-muted">at $45,000/yr</p>
      <p className="num mt-2.5 text-[13px]">
        ~$5.5M <span className="text-muted-2">projected at age 90</span>
      </p>
    </CardLink>
  )
}

function FundsCard({ funds }: { funds: Fund[] | null }) {
  return (
    <CardLink to="/funds" label="Funds & goals">
      <p className="num mt-1.5 text-[30px] font-extrabold">
        {funds != null ? formatUsd(totalParked(funds)) : '$—'}
      </p>
      {funds != null && (
        <p className="text-xs text-muted">
          parked across {funds.length} funds
        </p>
      )}
      <div className="mt-3.5 flex flex-col gap-[7px]">
        {fundsMini(funds ?? []).map((fund) => (
          <div key={fund.id} className="flex justify-between text-xs">
            <span className="text-muted">{fund.name}</span>
            <span className="num text-muted-2">{fund.right}</span>
          </div>
        ))}
      </div>
    </CardLink>
  )
}

const ACTIVITY_TONES: Record<ActivityTone, { tile: string; amount: string }> =
  {
    credit: { tile: 'bg-green-soft', amount: 'text-accent' },
    debit: { tile: 'bg-tile', amount: 'text-ink' },
    treat: { tile: 'bg-red-soft-3', amount: 'text-red' },
  }

function RecentActivity({ budget }: { budget: BudgetMonth | null }) {
  const rows = budget != null ? recentActivity(budget) : []
  return (
    <div className="mt-5 rounded-card border border-card-border bg-card px-6 py-2">
      <div className="flex items-center justify-between border-b border-hairline pt-4 pb-2.5">
        <p className="text-sm font-bold">Recent activity</p>
        <Link
          to="/safe-to-spend"
          className="text-[12.5px] font-semibold text-accent"
        >
          Add an item →
        </Link>
      </div>
      {rows.length === 0 && (
        <p className="py-4 text-[12.5px] text-muted">
          No activity yet — spending and funding items land here.
        </p>
      )}
      {rows.map((row) => (
        <div
          key={row.key}
          data-testid="activity-row"
          className="flex items-center justify-between border-b border-hairline-2 py-[13px]"
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[15px] ${ACTIVITY_TONES[row.tone].tile}`}
            >
              {row.icon}
            </div>
            <div>
              <p className="text-[13.5px] font-semibold">{row.title}</p>
              <p className="text-[11.5px] text-muted-2">{row.sub}</p>
            </div>
          </div>
          <p className={`num text-sm font-bold ${ACTIVITY_TONES[row.tone].amount}`}>
            {row.amount}
          </p>
        </div>
      ))}
    </div>
  )
}

function Dashboard() {
  const [budget, setBudget] = useState<BudgetMonth | null>(null)
  const [funds, setFunds] = useState<Fund[] | null>(null)
  const [guardrails, setGuardrails] = useState<Guardrails | null>(null)

  useEffect(() => {
    void fetchBudgetMonth().then(setBudget)
    void fetchFunds().then(setFunds)
    void fetchGuardrails().then(setGuardrails)
  }, [])

  return (
    <div data-testid="view-dashboard">
      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <NetWorthHero />
        <SafeToSpendCard budget={budget} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-5">
        <GuardrailCard guardrails={guardrails} />
        <LongevityCard />
        <FundsCard funds={funds} />
      </div>
      <RecentActivity budget={budget} />
    </div>
  )
}

export default Dashboard
