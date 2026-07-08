import { useEffect, useState } from 'react'
import type { Fund } from '../api.ts'
import { archiveFund, createFund, createFundEntry, fetchFunds } from '../api.ts'
import GhostButton from '../components/GhostButton.tsx'
import NewFundForm from '../components/NewFundForm.tsx'
import type { NewFund } from '../funds.ts'
import { fundView, totalParked } from '../funds.ts'
import { formatUsd, todayIso } from '../ledger.ts'

function FundRow({
  fund,
  onArchive,
}: {
  fund: Fund
  onArchive: (fundId: number) => Promise<void>
}) {
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
        <div className="flex items-baseline gap-3">
          <p className="num text-[13.5px] font-semibold">{view.amount}</p>
          <GhostButton
            label="Archive"
            onClick={() => void onArchive(fund.id)}
          />
        </div>
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

  const addFund = async ({ fund, saved }: NewFund) => {
    const created = await createFund(fund)
    if (saved > 0) {
      await createFundEntry({
        fund_id: created.id,
        as_of_date: todayIso(),
        balance: saved,
      })
    }
    setFunds(await fetchFunds())
  }

  const archive = async (fundId: number) => {
    await archiveFund(fundId)
    setFunds(await fetchFunds())
  }

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
          <NewFundForm onAdd={addFund} />
          <div className="mt-[18px] flex flex-col gap-5">
            {funds.map((fund) => (
              <FundRow key={fund.id} fund={fund} onArchive={archive} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Funds
