import type { Account } from '../api.ts'
import type { LedgerRow } from '../ledger.ts'
import { formatUsd } from '../ledger.ts'

interface LedgerTableProps {
  columns: Account[]
  rows: LedgerRow[]
}

function LedgerTable({ columns, rows }: LedgerTableProps) {
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
              {columns.map((account) => (
                <th
                  key={account.id}
                  className="px-3.5 py-2.5 text-right font-semibold"
                >
                  {account.name}
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
                {row.values.map((value, cell) => (
                  <td
                    key={columns[cell].id}
                    className={`px-3.5 py-[11px] text-right${
                      columns[cell].is_liability ? ' text-red-text' : ''
                    }`}
                  >
                    {formatUsd(value)}
                  </td>
                ))}
                <td className="px-3.5 py-[11px] text-right font-bold">
                  {formatUsd(row.netWorth)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default LedgerTable
