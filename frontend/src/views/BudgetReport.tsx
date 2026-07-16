import { useEffect, useState } from 'react'
import type { BudgetYear, BudgetYearMonth } from '../api.ts'
import { fetchBudgetYear } from '../api.ts'
import {
  formatSignedUsd,
  monthLabel,
  varianceClass,
  yearOptions,
} from '../budgetReport.ts'
import { formatUsd } from '../ledger.ts'

const cell = 'px-3.5 py-[11px] text-right'

function ReportRow({ row }: { row: BudgetYearMonth }) {
  return (
    <tr data-testid="report-row" className="border-b border-hairline-2">
      <td className="px-3.5 py-[11px] text-left font-semibold">
        {monthLabel(row.month)}
        {row.provisional && (
          <span className="font-medium text-muted-2"> · in progress</span>
        )}
      </td>
      <td className={`${cell} text-[#5b6058]`}>
        {row.planned != null && formatUsd(row.planned)}
      </td>
      <td className={cell}>{row.actual != null && formatUsd(row.actual)}</td>
      <td
        className={`${cell}${row.variance != null ? ` ${varianceClass(row.variance)}` : ''}`}
      >
        {row.variance != null && formatSignedUsd(row.variance)}
      </td>
      <td
        className={`${cell} font-bold${
          row.cumulative_variance != null
            ? ` ${varianceClass(row.cumulative_variance)}`
            : ''
        }`}
      >
        {row.cumulative_variance != null &&
          formatSignedUsd(row.cumulative_variance)}
      </td>
    </tr>
  )
}

function BudgetReport() {
  const [report, setReport] = useState<BudgetYear | null>(null)
  // Locked from the first (current-year) response, so picking an older
  // year never shrinks the picker to that year.
  const [years, setYears] = useState<number[]>([])

  useEffect(() => {
    void fetchBudgetYear().then((initial) => {
      setReport(initial)
      setYears(yearOptions(initial))
    })
  }, [])

  const changeYear = async (year: number) => {
    setReport(await fetchBudgetYear(year))
  }

  return (
    <div data-testid="view-budget-report">
      <section className="overflow-hidden rounded-card border border-card-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5.5 py-4.5">
          <h2 className="text-sm font-bold">
            Plan vs. actual{' '}
            <span className="font-medium text-muted-2">
              · blank months have no data
            </span>
          </h2>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-2 uppercase">
            Year
            <select
              value={report?.year ?? ''}
              onChange={(event) => void changeYear(Number(event.target.value))}
              className="rounded-input border border-input-border bg-card px-2.5 py-1.5 text-[13px] font-semibold normal-case"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="num w-full border-collapse text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="bg-[#faf8f3] text-muted-2">
                <th className="px-3.5 py-2.5 text-left font-semibold">Month</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">
                  Planned
                </th>
                <th className="px-3.5 py-2.5 text-right font-semibold">
                  Actual
                </th>
                <th className="px-3.5 py-2.5 text-right font-semibold">
                  Variance
                </th>
                <th className="px-3.5 py-2.5 text-right font-bold text-ink">
                  Cumulative
                </th>
              </tr>
            </thead>
            <tbody>
              {report?.months.map((row) => (
                <ReportRow key={row.month} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default BudgetReport
