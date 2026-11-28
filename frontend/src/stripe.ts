// Zebra striping, one rule for every data table: the second, fourth, …
// body rows carry the stripe. Decided by position rather than by content,
// so a blank month is striped like any other, and the first row — the
// Ledger's highlighted newest month — never is.
export const stripeClass = (index: number): string =>
  index % 2 === 1 ? 'bg-stripe' : ''
