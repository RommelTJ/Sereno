import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { stsBarPct } from '../dashboard.ts'
import { formatUsd } from '../ledger.ts'
import { useNetWorth } from '../netWorth.ts'
import type { BudgetMonth, NetWorthPoint } from '../api.ts'
import { fetchBudgetMonth } from '../api.ts'

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

// Deep-link card shell. The Guardrail and Longevity values are static,
// sanitized illustrations from the design handoff until Phase 2 lands.
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

function GuardrailCard() {
  return (
    <CardLink to="/guardrails" label="Spend guardrail">
      <p className="num mt-1.5 text-[30px] font-extrabold">3.0%</p>
      <p className="text-xs text-muted">withdrawal rate</p>
      <div className="relative mt-3.5 flex h-[9px] overflow-hidden rounded-[6px] border border-card-border">
        <div className="flex-1 bg-red-soft-2" />
        <div className="flex-2 bg-green-soft-2" />
        <div className="flex-1 bg-amber-soft" />
        <div className="absolute top-[-3px] h-3.5 w-0.5 bg-ink" style={{ left: '55%' }} />
      </div>
      <p className="mt-3 text-[13px] font-bold text-accent">Hold steady</p>
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

const FUNDS_MINI = [
  { name: 'Emergency fund', pct: '33%' },
  { name: 'House maintenance', pct: '50%' },
  { name: '1st-year fund', pct: '100%' },
]

function FundsCard() {
  return (
    <CardLink to="/funds" label="Funds & goals">
      <p className="num mt-1.5 text-[30px] font-extrabold">$66,000</p>
      <p className="text-xs text-muted">parked across 5 funds</p>
      <div className="mt-3.5 flex flex-col gap-[7px]">
        {FUNDS_MINI.map((fund) => (
          <div key={fund.name} className="flex justify-between text-xs">
            <span className="text-muted">{fund.name}</span>
            <span className="num text-muted-2">{fund.pct}</span>
          </div>
        ))}
      </div>
    </CardLink>
  )
}

// Scaffolded empty — the Safe-to-spend slice populates it.
function RecentActivity() {
  return (
    <div className="mt-5 rounded-card border border-card-border bg-card px-6 py-2">
      <p className="border-b border-hairline pt-4 pb-2.5 text-sm font-bold">
        Recent activity
      </p>
      <p className="py-4 text-[12.5px] text-muted">
        No activity yet — spending and funding items land here.
      </p>
    </div>
  )
}

function Dashboard() {
  const [budget, setBudget] = useState<BudgetMonth | null>(null)

  useEffect(() => {
    void fetchBudgetMonth().then(setBudget)
  }, [])

  return (
    <div data-testid="view-dashboard">
      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <NetWorthHero />
        <SafeToSpendCard budget={budget} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-5">
        <GuardrailCard />
        <LongevityCard />
        <FundsCard />
      </div>
      <RecentActivity />
    </div>
  )
}

export default Dashboard
