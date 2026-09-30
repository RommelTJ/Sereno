import { Link } from 'react-router'
import type { Fund } from '../api.ts'
import { fundRows, totalParked } from '../funds.ts'
import { formatUsd } from '../ledger.ts'

// The hero formula's money-in-funds term, made visible where spending
// decisions happen: one row per active fund with its parked balance. Each
// row opens Funds & Goals with that fund's log selected — the quickest way
// to answer "did I already draw this month?".
function FundsCard({ funds }: { funds: Fund[] }) {
  return (
    <div className="rounded-card border border-card-border bg-card p-[22px]">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-sm font-bold">Money in funds</p>
        <p className="num text-sm font-bold">{formatUsd(totalParked(funds))}</p>
      </div>
      {fundRows(funds).map((row) => (
        <Link
          key={row.id}
          to={`/funds?fund=${row.id}`}
          data-testid="sts-fund-row"
          className="-mx-2 flex min-h-[44px] items-center justify-between rounded-[8px] border-b border-hairline-2 px-2 py-[11px] text-[13px] last:border-b-0 hover:bg-tile"
        >
          <span>{row.name}</span>
          <span className="flex items-baseline gap-2.5">
            {row.plan && (
              <span className="num text-[11.5px] text-muted-2">{row.plan}</span>
            )}
            <span className="num font-semibold text-muted">{row.amount}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

export default FundsCard
