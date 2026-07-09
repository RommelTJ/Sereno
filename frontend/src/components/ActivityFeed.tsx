import { useState } from 'react'
import type { BudgetMonth, Fund } from '../api.ts'
import { fetchBudgetMonth } from '../api.ts'
import { monthYearLabel, previousMonth } from '../budget.ts'
import type { ActivityTone } from '../dashboard.ts'
import { activityRow } from '../dashboard.ts'

const ACTIVITY_TONES: Record<ActivityTone, { tile: string; amount: string }> =
  {
    credit: { tile: 'bg-green-soft', amount: 'text-accent' },
    debit: { tile: 'bg-tile', amount: 'text-ink' },
    treat: { tile: 'bg-red-soft-3', amount: 'text-red' },
    fund: { tile: 'bg-amber-soft', amount: 'text-muted' },
  }

// The uncapped, month-paged activity feed shared by the Dashboard and
// Safe-to-spend. The current month arrives as a prop — refetching it after
// a form submit replaces the newest section without touching the loaded
// history — and earlier months accumulate as the button at the bottom
// pages back through the existing GET /api/budget-month?month= param.
// Each section keeps its own BudgetMonth, because a row's envelope emoji
// resolves from that month's categories.
function ActivityFeed({
  current,
  funds,
}: {
  current: BudgetMonth
  funds: Fund[]
}) {
  const [earlier, setEarlier] = useState<BudgetMonth[]>([])
  const [loading, setLoading] = useState(false)
  const months = [current, ...earlier]
  const target = previousMonth(months[months.length - 1].month)

  const loadEarlier = async () => {
    setLoading(true)
    try {
      const month = await fetchBudgetMonth(target)
      setEarlier((loaded) => [...loaded, month])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {months.map((budget) => (
        <section key={budget.month}>
          <p className="pt-3.5 text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
            {monthYearLabel(budget.month)}
          </p>
          {budget.activity.length === 0 && (
            <p className="py-4 text-[12.5px] text-muted">
              No activity yet — spending and funding items land here.
            </p>
          )}
          {budget.activity.map((item) => {
            const row = activityRow(item, budget, funds)
            return (
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
                <p
                  className={`num text-sm font-bold ${ACTIVITY_TONES[row.tone].amount}`}
                >
                  {row.amount}
                </p>
              </div>
            )
          })}
        </section>
      ))}
      <button
        type="button"
        disabled={loading}
        onClick={() => void loadEarlier()}
        className="my-3.5 w-full cursor-pointer rounded-[8px] border border-input-border bg-card py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60"
      >
        ← {monthYearLabel(target)}
      </button>
    </>
  )
}

export default ActivityFeed
