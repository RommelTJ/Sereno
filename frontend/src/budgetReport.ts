// View-model helpers for the Budget report view and its Dashboard card.

import type { BudgetYear } from './api.ts'
import { formatUsd } from './ledger.ts'

// "2025-03" → "Mar" — the year lives in the picker, so rows stay terse.
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(year, monthNumber - 1).toLocaleDateString('en-US', {
    month: 'short',
  })
}

// Variances carry their sign: "+$500" is under plan, "-$700" over.
export const formatSignedUsd = (value: number): string =>
  value < 0 ? formatUsd(value) : `+${formatUsd(value)}`

export const varianceClass = (value: number): string =>
  value < 0 ? 'text-red-text' : 'text-accent'

// The picker spans the data: the data-start year through the initially
// served (current) year, newest first — no data yet means just that year.
export function yearOptions(report: BudgetYear): number[] {
  const first = report.data_start
    ? Number(report.data_start.slice(0, 4))
    : report.year
  const years: number[] = []
  for (let year = report.year; year >= first; year--) {
    years.push(year)
  }
  return years
}
