import { formatUsd } from '../ledger.ts'
import { useNetWorth } from '../netWorth.ts'
import type { NetWorthPoint } from '../api.ts'

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

function Dashboard() {
  return (
    <div data-testid="view-dashboard">
      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <NetWorthHero />
      </div>
    </div>
  )
}

export default Dashboard
