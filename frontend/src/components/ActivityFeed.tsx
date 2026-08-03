import { useState } from 'react'
import type {
  ActivityItem,
  BudgetMonth,
  Envelope,
  ExpenseUpdateInput,
  Fund,
  IncomeUpdateInput,
} from '../api.ts'
import {
  deleteExpense,
  deleteIncome,
  fetchBudgetMonth,
  updateExpense,
  updateIncome,
} from '../api.ts'
import {
  envelopeView,
  monthYearLabel,
  nextMonth,
  previousMonth,
} from '../budget.ts'
import type { ActivityTone } from '../dashboard.ts'
import { activityRow } from '../dashboard.ts'
import ExpenseEditForm from './ExpenseEditForm.tsx'
import IncomeEditForm from './IncomeEditForm.tsx'

const ACTIVITY_TONES: Record<ActivityTone, { tile: string; amount: string }> =
  {
    credit: { tile: 'bg-green-soft', amount: 'text-accent' },
    debit: { tile: 'bg-tile', amount: 'text-ink' },
    treat: { tile: 'bg-red-soft-3', amount: 'text-red' },
    fund: { tile: 'bg-amber-soft', amount: 'text-muted' },
  }

// The uncapped activity feed shared by the Dashboard and Safe-to-spend.
// The current month arrives as a prop — refetching it after a form submit
// replaces the newest section without touching the loaded history. With
// pager set (the Dashboard), earlier months accumulate as the button at
// the bottom pages back through the existing GET /api/budget-month?month=
// param, and the mirrored button at the top prepends future months the
// same way — income can fund a future budget_month (June pay funds July),
// and an empty future month just renders the "No activity yet" state.
// Without it (Safe-to-spend), the view's own month pager owns navigation
// and the feed renders only the month it is handed.
// Each section keeps its own BudgetMonth, because a row's envelope emoji
// resolves from that month's categories.
// With onChanged set (Safe-to-spend; the Dashboard stays read-only),
// expense and income rows are tappable and expand an inline pre-filled
// edit form; fund rows belong to the funds machinery and never are.
// With filter set (a tapped envelope), every loaded section keeps only
// that envelope's own expenses — income, fund entries, and fund-funded
// lines belong to no envelope, so they drop out.
function ActivityFeed({
  current,
  funds,
  onChanged,
  filter,
  pager = true,
}: {
  current: BudgetMonth
  funds: Fund[]
  onChanged?: () => Promise<void>
  filter?: Envelope | null
  pager?: boolean
}) {
  const [later, setLater] = useState<BudgetMonth[]>([])
  const [earlier, setEarlier] = useState<BudgetMonth[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const months = pager ? [...later, current, ...earlier] : [current]
  const forwardTarget = nextMonth(months[0].month)
  const target = previousMonth(months[months.length - 1].month)

  const loadLater = async () => {
    setLoading(true)
    try {
      const month = await fetchBudgetMonth(forwardTarget)
      setLater((loaded) => [month, ...loaded])
    } finally {
      setLoading(false)
    }
  }

  const loadEarlier = async () => {
    setLoading(true)
    try {
      const month = await fetchBudgetMonth(target)
      setEarlier((loaded) => [...loaded, month])
    } finally {
      setLoading(false)
    }
  }

  // A section's visible rows under the active filter. Only expenses carry
  // a category_id, so income, fund entries, and fund-funded lines (their
  // category_id is null — the fund says what the spend was for) drop out.
  const visibleActivity = (budget: BudgetMonth) =>
    filter
      ? budget.activity.filter(
          (item) => item.type === 'expense' && item.category_id === filter.id,
        )
      : budget.activity

  // An edit can move an item into or out of any loaded month (the
  // budget-month reassignment), so every paged-in section refetches
  // alongside the parent's current-month refresh.
  const refreshLoaded = async () => {
    const [nextLater, nextEarlier] = await Promise.all([
      Promise.all(later.map((month) => fetchBudgetMonth(month.month))),
      Promise.all(earlier.map((month) => fetchBudgetMonth(month.month))),
    ])
    setLater(nextLater)
    setEarlier(nextEarlier)
  }

  const saveExpense = async (item: ActivityItem, input: ExpenseUpdateInput) => {
    await updateExpense(item.id, input)
    await refreshLoaded()
    await onChanged?.()
    setEditing(null)
  }

  const saveIncome = async (item: ActivityItem, input: IncomeUpdateInput) => {
    await updateIncome(item.id, input)
    await refreshLoaded()
    await onChanged?.()
    setEditing(null)
  }

  const removeItem = async (item: ActivityItem) => {
    await (item.type === 'expense'
      ? deleteExpense(item.id)
      : deleteIncome(item.id))
    await refreshLoaded()
    await onChanged?.()
    setEditing(null)
  }

  return (
    <>
      {pager && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadLater()}
          className="my-3.5 w-full cursor-pointer rounded-[8px] border border-input-border bg-card py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60"
        >
          {monthYearLabel(forwardTarget)} →
        </button>
      )}
      {months.map((budget) => (
        <section key={budget.month}>
          <p className="pt-3.5 text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
            {monthYearLabel(budget.month)}
          </p>
          {visibleActivity(budget).length === 0 && (
            <p className="py-4 text-[12.5px] text-muted">
              {filter
                ? `No ${envelopeView(filter).label} activity this month.`
                : 'No activity yet — spending and funding items land here.'}
            </p>
          )}
          {visibleActivity(budget).map((item) => {
            const row = activityRow(item, budget, funds)
            const editable = onChanged != null && item.type !== 'fund'
            // min-w-0 down the left side lets a long title wrap inside the
            // row instead of pushing it wide; the icon tile and the amount
            // never shrink or break.
            const content = (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[15px] ${ACTIVITY_TONES[row.tone].tile}`}
                  >
                    {row.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold break-words">
                      {row.title}
                    </p>
                    <p className="text-[11.5px] text-muted-2">{row.sub}</p>
                  </div>
                </div>
                <p
                  className={`num shrink-0 text-sm font-bold ${ACTIVITY_TONES[row.tone].amount}`}
                >
                  {row.amount}
                </p>
              </>
            )
            if (!editable) {
              return (
                <div
                  key={row.key}
                  data-testid="activity-row"
                  className="flex items-center justify-between gap-3 border-b border-hairline-2 py-[13px]"
                >
                  {content}
                </div>
              )
            }
            return (
              <div key={row.key}>
                <button
                  type="button"
                  data-testid="activity-row"
                  onClick={() =>
                    setEditing(editing === row.key ? null : row.key)
                  }
                  className="flex w-full cursor-pointer items-center justify-between gap-3 border-b border-hairline-2 py-[13px] text-left"
                >
                  {content}
                </button>
                {editing === row.key && item.type === 'expense' && (
                  <ExpenseEditForm
                    item={item}
                    categories={budget.categories}
                    funds={funds}
                    onSave={(input) => saveExpense(item, input)}
                    onDelete={() => removeItem(item)}
                    onCancel={() => setEditing(null)}
                  />
                )}
                {editing === row.key && item.type === 'income' && (
                  <IncomeEditForm
                    item={item}
                    onSave={(input) => saveIncome(item, input)}
                    onDelete={() => removeItem(item)}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            )
          })}
        </section>
      ))}
      {pager && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadEarlier()}
          className="my-3.5 w-full cursor-pointer rounded-[8px] border border-input-border bg-card py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60"
        >
          ← {monthYearLabel(target)}
        </button>
      )}
    </>
  )
}

export default ActivityFeed
