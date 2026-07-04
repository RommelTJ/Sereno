import { useEffect, useState } from 'react'
import type { BudgetMonth, Fund } from '../api.ts'
import { fetchBudgetMonth, fetchFunds } from '../api.ts'
import EnvelopesCard from '../components/EnvelopesCard.tsx'
import { formatUsd } from '../ledger.ts'

function Hero({ safeToSpend }: { safeToSpend: number }) {
  return (
    <div className="rounded-hero bg-sidebar p-[26px] text-center text-white">
      <p className="text-[11px] font-semibold tracking-[1.4px] text-sidebar-muted-2 uppercase">
        Safe-to-spend
      </p>
      <p className="num mt-1 text-[56px] leading-none font-extrabold tracking-[-1.5px] text-hero-green">
        {formatUsd(safeToSpend)}
      </p>
      <p className="mt-2.5 inline-block rounded-pill border border-sidebar-active px-3.5 py-[5px] text-[11.5px] text-sidebar-muted">
        total cash − bills due − money in funds
      </p>
    </div>
  )
}

function SafeToSpend() {
  const [budget, setBudget] = useState<BudgetMonth | null>(null)
  const [funds, setFunds] = useState<Fund[] | null>(null)

  useEffect(() => {
    void fetchBudgetMonth().then(setBudget)
    void fetchFunds().then(setFunds)
  }, [])

  return (
    <div
      data-testid="view-safe-to-spend"
      className="grid grid-cols-[1fr_1fr] items-start gap-5"
    >
      {budget && funds && (
        <>
          <div className="flex flex-col gap-5">
            <Hero safeToSpend={budget.safe_to_spend} />
            <EnvelopesCard month={budget.month} envelopes={budget.categories} />
          </div>
          <div className="flex flex-col gap-5">
            {/* The spending and funding forms land in the next commits. */}
          </div>
        </>
      )}
    </div>
  )
}

export default SafeToSpend
