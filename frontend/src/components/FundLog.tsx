import type { FundLogEntry } from '../api.ts'
import { monthYearLabel, nextMonth, previousMonth } from '../budget.ts'
import { fundLogRow } from '../funds.ts'

const PAGER_BUTTON =
  'min-h-[44px] min-w-[44px] cursor-pointer rounded-[8px] border border-input-border bg-card px-4 text-[13px] font-semibold text-muted disabled:opacity-60'

// The fund log beside the funds: one calendar month of fund_entry history,
// newest first, paged a month at a time like Safe-to-spend's pager. Each
// row is what the entry did — the draw it paid for, the contribution, the
// correction — with the signed move and the balance it left.
function FundLog({
  month,
  entries,
  paging,
  onPage,
}: {
  month: string
  entries: FundLogEntry[] | null
  paging: boolean
  onPage: (month: string) => void
}) {
  return (
    <section
      data-testid="fund-log"
      className="rounded-card border border-card-border bg-card p-[22px]"
    >
      <p className="text-sm font-bold">Fund log</p>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={paging}
          onClick={() => onPage(previousMonth(month))}
          className={PAGER_BUTTON}
        >
          ←
        </button>
        <p data-testid="fund-log-month" className="text-sm font-bold">
          {monthYearLabel(month)}
        </p>
        <button
          type="button"
          aria-label="Next month"
          disabled={paging}
          onClick={() => onPage(nextMonth(month))}
          className={PAGER_BUTTON}
        >
          →
        </button>
      </div>
      {entries?.length === 0 && (
        <p className="py-4 text-[12.5px] text-muted">
          No fund activity in {monthYearLabel(month)}.
        </p>
      )}
      {entries?.map((entry) => {
        const row = fundLogRow(entry)
        return (
          <div
            key={row.id}
            data-testid="fund-log-row"
            className="flex items-start justify-between gap-3 border-b border-hairline-2 py-[11px] text-[13px] last:border-b-0"
          >
            <div className="min-w-0">
              <p className="font-semibold">{row.description}</p>
              <p className="text-[11.5px] text-muted-2">
                {row.date} · <span>{row.fund}</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={`num font-semibold ${entry.delta < 0 ? 'text-muted' : 'text-accent'}`}
              >
                {row.amount}
              </p>
              <p className="num text-[11.5px] text-muted-2">{row.balance}</p>
            </div>
          </div>
        )
      })}
    </section>
  )
}

export default FundLog
