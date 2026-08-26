import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Mortgage as MortgageData, MortgageDerived } from '../api.ts'
import { fetchMortgage } from '../api.ts'
import { formatUsd } from '../ledger.ts'
import {
  escrowLine,
  paymentLine,
  payoffLine,
  remainingTerm,
  savingsLine,
  termsLine,
} from '../mortgage.ts'

function Payoff({
  mortgage,
  derived,
}: {
  mortgage: MortgageData
  derived: MortgageDerived
}) {
  const savings = savingsLine(derived)
  return (
    <>
      <p
        data-testid="mortgage-balance"
        className="num mt-1 text-[26px] font-extrabold"
      >
        {formatUsd(derived.balance)}
      </p>
      <p data-testid="mortgage-terms" className="mt-[3px] text-[13px] text-muted">
        {termsLine(mortgage)}
      </p>
      <div
        data-testid="mortgage-payoff"
        className="mt-[22px] rounded-[13px] border border-accent bg-green-soft p-[18px]"
      >
        <p className="text-lg font-extrabold text-accent">
          Payoff: {payoffLine(derived)}
        </p>
        <p className="mt-[5px] text-[12.5px] text-muted">
          {remainingTerm(derived.remaining_months)} remaining ·{' '}
          {formatUsd(derived.remaining_interest)} of interest left
        </p>
      </div>
      {savings && (
        <p
          data-testid="mortgage-savings"
          className="mt-[18px] rounded-[11px] bg-amber-soft p-[13px] text-[12.5px]"
        >
          {savings}
        </p>
      )}
      <p
        data-testid="mortgage-payment"
        className="mt-[18px] text-[13px] text-muted"
      >
        {paymentLine(mortgage, derived)}
      </p>
    </>
  )
}

function Mortgage() {
  const [mortgage, setMortgage] = useState<MortgageData | null>()

  useEffect(() => {
    void fetchMortgage().then(setMortgage)
  }, [])

  if (mortgage === undefined) {
    return <div data-testid="view-mortgage" className="max-w-[860px]" />
  }

  if (mortgage === null) {
    return (
      <div data-testid="view-mortgage" className="max-w-[860px]">
        <div
          data-testid="mortgage-empty"
          className="rounded-card border border-card-border bg-card p-[26px] text-[13.5px] text-muted"
        >
          No mortgage terms yet. Enter the rate, principal &amp; interest,
          extra principal, and escrow on the{' '}
          <Link to="/settings" className="text-accent underline">
            Mortgage card under Settings &amp; data
          </Link>
          , and the payoff is solved from the balance already in the ledger.
        </div>
      </div>
    )
  }

  const escrow = escrowLine(mortgage)

  return (
    <div data-testid="view-mortgage" className="max-w-[860px]">
      <div className="rounded-card border border-card-border bg-card p-[26px]">
        {mortgage.derived ? (
          <Payoff mortgage={mortgage} derived={mortgage.derived} />
        ) : (
          <>
            <p
              data-testid="mortgage-terms"
              className="text-[13px] text-muted"
            >
              {termsLine(mortgage)}
            </p>
            <p
              data-testid="mortgage-no-balance"
              className="mt-[18px] rounded-[13px] border border-card-border p-[18px] text-[13px] text-muted"
            >
              No payoff yet — the schedule is solved from this account's
              balance, and the ledger has none. Enter the balance in Ledger
              entries.
            </p>
          </>
        )}
        {escrow && (
          <p
            data-testid="mortgage-escrow"
            className="mt-[10px] text-[12.5px] text-muted-2"
          >
            {escrow}
          </p>
        )}
      </div>
    </div>
  )
}

export default Mortgage
