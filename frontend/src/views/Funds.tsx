import { useEffect, useState } from 'react'
import type { Fund } from '../api.ts'
import { fetchFunds } from '../api.ts'
import { fundView, totalParked } from '../funds.ts'
import { formatUsd } from '../ledger.ts'

function FundRow({ fund }: { fund: Fund }) {
  const view = fundView(fund)
  return (
    <div data-testid="fund-row">
      <div className="flex items-baseline justify-between">
        <p className="text-[14.5px] font-bold">
          {view.name}{' '}
          <span className="text-[11.5px] font-medium text-muted-2">
            · {view.meta}
          </span>
        </p>
        <p className="num text-[13.5px] font-semibold">{view.amount}</p>
      </div>
      {view.barPct !== null && (
        <div className="mt-2 h-[9px] overflow-hidden rounded-[6px] bg-track">
          <div
            data-testid="fund-bar"
            className={`h-full rounded-[6px] ${view.done ? 'bg-accent' : 'bg-sidebar'}`}
            style={{ width: `${view.barPct}%` }}
          />
        </div>
      )}
      <p
        className={`mt-[5px] text-[11.5px] ${view.done ? 'text-accent' : 'text-muted-2'}`}
      >
        {view.note}
      </p>
    </div>
  )
}

function Funds() {
  const [funds, setFunds] = useState<Fund[] | null>(null)

  useEffect(() => {
    void fetchFunds().then(setFunds)
  }, [])

  return (
    <div data-testid="view-funds" className="max-w-[760px]">
      {funds && (
        <div className="rounded-card border border-card-border bg-card p-[22px]">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted-2">
              Total parked{' '}
              <span className="num text-xl font-extrabold text-ink">
                {formatUsd(totalParked(funds))}
              </span>
            </p>
            <p className="text-[12.5px] text-muted-2">
              notes auto-calculate from target, saved &amp; date
            </p>
          </div>
          <div className="mt-[18px] flex flex-col gap-5">
            {funds.map((fund) => (
              <FundRow key={fund.id} fund={fund} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Funds
