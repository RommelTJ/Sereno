// Shared band logic for the two schedule editors — the Forecast
// view's transient rows and the Settings card. The overlap rule
// mirrors the server's validate_bands wording exactly, so a draft is
// caught client-side before a fetch or save would 422, and change
// detection treats row order and blank-versus-null notes as no-ops so
// an untouched schedule never posts a redundant version.

import type { SpendBand, SpendBandInput } from './api.ts'

interface BandRange {
  start_year: number
  end_year: number | null
}

export const bandLabel = (band: BandRange): string =>
  band.end_year == null
    ? `${band.start_year}+`
    : `${band.start_year}-${band.end_year}`

// The first problem in a draft schedule, in the server's own words —
// null when the draft is saveable. Ends are inclusive, a null end is
// open-ended, and adjacency is legal.
export const bandProblem = (bands: readonly BandRange[]): string | null => {
  for (const band of bands) {
    if (band.end_year != null && band.end_year < band.start_year) {
      return `band ${bandLabel(band)} ends before it starts`
    }
  }
  const ordered = [...bands].sort((a, b) => a.start_year - b.start_year)
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const earlier = ordered[index]
    const later = ordered[index + 1]
    if (earlier.end_year == null || later.start_year <= earlier.end_year) {
      return `bands ${bandLabel(earlier)} and ${bandLabel(later)} overlap`
    }
  }
  return null
}

// Saved rows as the editors hold them: ids dropped (override rows
// have no identity, like purchase rows), notes kept for Save to plan.
export const overrideBands = (saved: SpendBand[]): SpendBandInput[] =>
  saved.map(({ start_year, end_year, annual_amount, note }) => ({
    start_year,
    end_year,
    annual_amount,
    note,
  }))

const normalizedNote = (note: string | null | undefined): string | null =>
  note ? note : null

const bandKey = (band: SpendBandInput): string =>
  JSON.stringify([
    band.start_year,
    band.end_year ?? null,
    band.annual_amount,
    normalizedNote(band.note),
  ])

export const scheduleChanged = (
  bands: SpendBandInput[],
  saved: SpendBand[],
): boolean => {
  const current = bands.map(bandKey).sort()
  const stored = overrideBands(saved).map(bandKey).sort()
  return (
    current.length !== stored.length ||
    current.some((value, index) => value !== stored[index])
  )
}
