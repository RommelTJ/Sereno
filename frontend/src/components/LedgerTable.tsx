import { useCallback } from 'react'
import type { LedgerColumn, LedgerRow } from '../ledger.ts'
import { formatUsd } from '../ledger.ts'

// The derived column reads as derived: a lighter header than the
// accounts beside it and a tint that sits over whichever row it lands
// in, highlighted newest month included.
const SUBTOTAL_TINT = 'bg-black/[0.02]'

const columnKey = (column: LedgerColumn) =>
  column.kind === 'account' ? column.account.id : column.label

interface LedgerTableProps {
  columns: LedgerColumn[]
  rows: LedgerRow[]
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}

function LedgerTable({
  columns,
  rows,
  hasMore,
  loading,
  onLoadMore,
}: LedgerTableProps) {
  // The sentinel row below the last month asks for the next page when it
  // comes into view. Observed against the viewport, since the page itself is
  // the scroller — an IntersectionObserver follows an iOS momentum flick,
  // which a wheel or scroll listener would not. The ref callback rebuilds the
  // observer whenever the row remounts, and its cleanup disconnects the old
  // one; the observer stops existing entirely once the oldest month is on
  // screen and the row goes away.
  const watch = useCallback(
    (sentinel: HTMLTableRowElement | null) => {
      if (!sentinel) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
        },
        { rootMargin: '200px' },
      )
      observer.observe(sentinel)
      return () => observer.disconnect()
    },
    [onLoadMore],
  )

  return (
    <section className="overflow-hidden rounded-card border border-card-border bg-card">
      <h2 className="border-b border-hairline px-5.5 py-4.5 text-sm font-bold">
        Monthly balance entries{' '}
        <span className="font-medium text-muted-2">· one row per month</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="num w-full border-collapse text-[12.5px] whitespace-nowrap">
          <thead>
            <tr className="bg-[#faf8f3] text-muted-2">
              <th className="px-3.5 py-2.5 text-left font-semibold">Date</th>
              {columns.map((column) => (
                <th
                  key={columnKey(column)}
                  className={`px-3.5 py-2.5 text-right ${
                    column.kind === 'account'
                      ? 'font-semibold'
                      : `font-medium ${SUBTOTAL_TINT}`
                  }`}
                >
                  {column.kind === 'account'
                    ? column.account.name
                    : column.label}
                </th>
              ))}
              <th className="px-3.5 py-2.5 text-right font-bold text-ink">
                Net worth
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.month}
                data-testid="ledger-row"
                className={
                  index === 0
                    ? 'border-b border-hairline bg-[#f3f6f3] font-semibold'
                    : 'border-b border-hairline-2 text-[#5b6058]'
                }
              >
                <td className="px-3.5 py-[11px] text-left font-semibold">
                  {row.date}
                </td>
                {row.values.map((value, cell) => {
                  const column = columns[cell]
                  const liability =
                    column.kind === 'account' && column.account.is_liability
                  return (
                    <td
                      key={columnKey(column)}
                      className={`px-3.5 py-[11px] text-right${
                        liability ? ' text-red-text' : ''
                      }${column.kind === 'subtotal' ? ` ${SUBTOTAL_TINT}` : ''}`}
                    >
                      {formatUsd(value)}
                    </td>
                  )
                })}
                <td className="px-3.5 py-[11px] text-right font-bold">
                  {formatUsd(row.netWorth)}
                </td>
              </tr>
            ))}
            {hasMore && (
              <tr data-testid="ledger-sentinel" ref={watch}>
                <td
                  colSpan={columns.length + 2}
                  className="px-3.5 py-[11px] text-left text-muted-2"
                >
                  {loading ? 'Loading older months…' : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default LedgerTable
