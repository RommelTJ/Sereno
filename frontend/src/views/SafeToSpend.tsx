import { useEffect, useState } from 'react'
import type { BudgetMonth, ExpenseInput, Fund, IncomeInput } from '../api.ts'
import {
  createExpense,
  createIncome,
  fetchBudgetMonth,
  fetchFunds,
} from '../api.ts'
import {
  envelopeView,
  monthYearLabel,
  nextMonth,
  previousMonth,
} from '../budget.ts'
import ActivityFeed from '../components/ActivityFeed.tsx'
import EnvelopesCard from '../components/EnvelopesCard.tsx'
import IncomeForm from '../components/IncomeForm.tsx'
import FundsCard from '../components/FundsCard.tsx'
import SpendingForm from '../components/SpendingForm.tsx'
import { formatUsd } from '../ledger.ts'

function Hero({ safeToSpend }: { safeToSpend: number }) {
  return (
    <div className="rounded-hero bg-sidebar p-[26px] text-center text-white">
      <p className="text-[11px] font-semibold tracking-[1.4px] text-sidebar-muted-2 uppercase">
        Safe-to-spend
      </p>
      <p className="num mt-1 text-4xl leading-none font-extrabold tracking-[-1.5px] text-hero-green sm:text-[56px]">
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
  // The viewed month — null is the current month (the initial view), so
  // the default view's requests stay exactly what they were before the
  // pager existed.
  const [viewMonth, setViewMonth] = useState<string | null>(null)
  const [paging, setPaging] = useState(false)
  // The Activity feed's envelope filter, set by tapping an envelope row.
  // Only the id is stored — the envelope itself derives from the viewed
  // month's categories, so a refetch never leaves stale figures behind.
  const [filterId, setFilterId] = useState<number | null>(null)
  const filterEnvelope =
    budget?.categories.find((category) => category.id === filterId) ?? null

  useEffect(() => {
    setPaging(true)
    void fetchBudgetMonth(viewMonth ?? undefined)
      .then(setBudget)
      .finally(() => setPaging(false))
  }, [viewMonth])

  useEffect(() => {
    void fetchFunds().then(setFunds)
  }, [])

  // Stepping the pager clears the envelope filter — an old month may not
  // carry the filtered envelope at all.
  const page = (month: string) => {
    setFilterId(null)
    setViewMonth(month)
  }

  const addExpense = async (input: ExpenseInput) => {
    await createExpense(input)
    // A fund-funded spend draws the fund down server-side, so the funds
    // card refreshes alongside the hero and envelopes.
    const [nextBudget, nextFunds] = await Promise.all([
      fetchBudgetMonth(viewMonth ?? undefined),
      fetchFunds(),
    ])
    setBudget(nextBudget)
    setFunds(nextFunds)
  }

  const addIncome = async (input: IncomeInput) => {
    await createIncome(input)
    setBudget(await fetchBudgetMonth(viewMonth ?? undefined))
  }

  // An item edit or delete can touch anything: the hero and envelopes, and
  // a fund's balance (fund-funded corrections) — so everything refetches.
  const refresh = async () => {
    const [nextBudget, nextFunds] = await Promise.all([
      fetchBudgetMonth(viewMonth ?? undefined),
      fetchFunds(),
    ])
    setBudget(nextBudget)
    setFunds(nextFunds)
  }

  return (
    <div
      data-testid="view-safe-to-spend"
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_1fr]"
    >
      {budget && funds && (
        <>
          <div
            data-testid="month-pager"
            className="flex items-center justify-between lg:col-span-2"
          >
            <button
              type="button"
              aria-label="Previous month"
              disabled={paging}
              onClick={() => page(previousMonth(budget.month))}
              className="min-h-[44px] min-w-[44px] cursor-pointer rounded-[8px] border border-input-border bg-card px-4 text-[13px] font-semibold text-muted disabled:opacity-60"
            >
              ←
            </button>
            <p data-testid="month-pager-label" className="text-sm font-bold">
              {monthYearLabel(budget.month)}
            </p>
            <button
              type="button"
              aria-label="Next month"
              disabled={paging}
              onClick={() => page(nextMonth(budget.month))}
              className="min-h-[44px] min-w-[44px] cursor-pointer rounded-[8px] border border-input-border bg-card px-4 text-[13px] font-semibold text-muted disabled:opacity-60"
            >
              →
            </button>
          </div>
          <div className="flex flex-col gap-5">
            <Hero safeToSpend={budget.safe_to_spend} />
            <EnvelopesCard
              month={budget.month}
              envelopes={budget.categories}
              selectedId={filterId}
              onSelect={(envelope) =>
                setFilterId((id) => (id === envelope.id ? null : envelope.id))
              }
            />
            <FundsCard funds={funds} />
          </div>
          <div className="flex flex-col gap-5">
            <SpendingForm
              categories={budget.categories}
              funds={funds}
              onAdd={addExpense}
            />
            <IncomeForm onAdd={addIncome} />
            <section
              data-testid="sts-activity"
              className="rounded-card border border-card-border bg-card px-6 py-2"
            >
              <div className="flex items-center justify-between border-b border-hairline pt-4 pb-2.5">
                <p className="text-sm font-bold">Activity</p>
                {filterEnvelope && (
                  <button
                    type="button"
                    data-testid="activity-filter-chip"
                    onClick={() => setFilterId(null)}
                    className="cursor-pointer rounded-pill border border-input-border bg-tile px-3 py-[5px] text-[11.5px] font-semibold text-muted"
                  >
                    Filtering: {envelopeView(filterEnvelope).label} ✕
                  </button>
                )}
              </div>
              <ActivityFeed
                current={budget}
                funds={funds}
                onChanged={refresh}
                filter={filterEnvelope}
                pager={false}
              />
            </section>
          </div>
        </>
      )}
    </div>
  )
}

export default SafeToSpend
