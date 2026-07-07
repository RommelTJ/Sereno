import { useEffect, useState } from 'react'
import type { Account, Sourcing, SourcingStep } from '../api.ts'
import { fetchAccounts, fetchSourcing } from '../api.ts'
import { formatUsd } from '../ledger.ts'
import {
  hasWithdrawalBuckets,
  stepAction,
  stepDetail,
  stepMarker,
} from '../sourcing.ts'

// No birthdate lives in the schema, so the screen owns its starting
// age — the handoff forecast's age 38 — and the input re-evaluates
// any other age server-side.
const DEFAULT_AGE = 38

function StepRow({
  step,
  index,
  headroom,
}: {
  step: SourcingStep
  index: number
  headroom: number
}) {
  const active = step.gross > 0
  if (!active) {
    return (
      <div
        data-testid={`sourcing-step-${index}`}
        className="flex justify-between rounded-[11px] border border-card-border px-[13px] py-[11px] text-muted-2"
      >
        <span>
          {stepMarker(index)} {step.name}
        </span>
        <b>{stepDetail(step, headroom)}</b>
      </div>
    )
  }
  return (
    <div
      data-testid={`sourcing-step-${index}`}
      className="rounded-[11px] border border-accent bg-green-soft p-[13px]"
    >
      <div className="flex justify-between">
        <span>
          {stepMarker(index)} {step.name}
        </span>
        <b className="num">{`${stepAction(step)} ${formatUsd(step.gross)}`}</b>
      </div>
      <p className="mt-[5px] text-[11.5px] text-muted">
        {stepDetail(step, headroom)}
      </p>
    </div>
  )
}

function RuleCard({
  title,
  tag,
  children,
}: {
  title: string
  tag: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[11px] border border-card-border p-[13px]">
      <div className="flex justify-between font-bold">
        <span>{title}</span>
        <span className="font-medium text-muted-2">{tag}</span>
      </div>
      <p className="mt-1 text-muted">{children}</p>
    </div>
  )
}

function Withdrawals() {
  const [sourcing, setSourcing] = useState<Sourcing | null>()
  const [accounts, setAccounts] = useState<Account[]>()
  const [age, setAge] = useState(DEFAULT_AGE)
  const [spend, setSpend] = useState<number | null>(null)

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchSourcing(DEFAULT_AGE).then(setSourcing)
  }, [])

  const reevaluate = (nextAge: number, nextSpend: number | null) => {
    if (!Number.isFinite(nextAge) || nextAge < 0) {
      return
    }
    void fetchSourcing(nextAge, nextSpend ?? undefined).then(setSourcing)
  }

  if (sourcing === undefined || accounts === undefined) {
    return <div data-testid="view-withdrawals" className="max-w-[980px]" />
  }

  if (sourcing === null) {
    return (
      <div data-testid="view-withdrawals" className="max-w-[980px]">
        <div
          data-testid="sourcing-empty"
          className="rounded-card border border-card-border bg-card p-[26px] text-[13.5px] text-muted"
        >
          {hasWithdrawalBuckets(accounts) ? (
            <>
              Withdrawal sourcing needs the year's tax parameters, a spend
              plan for the target, and at least one balance to draw from.
              Load the tax year and plan under Settings &amp; data, then
              enter balances in Ledger entries.
            </>
          ) : (
            <>
              No accounts have a withdrawal priority yet, so there are no
              buckets to draw from. Use Edit on each investment account
              under Settings &amp; data to set its kind, investable flag,
              and withdrawal priority.
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div data-testid="view-withdrawals" className="max-w-[980px]">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="rounded-card border border-card-border bg-card p-6">
          <p className="text-sm font-bold">
            Sequencing — solve for net delivered
          </p>

          <div className="mt-3 flex gap-5 text-xs text-muted">
            <label className="flex items-center gap-2">
              Age
              <input
                data-testid="sourcing-age"
                type="number"
                value={age}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAge(value)
                  reevaluate(value, spend)
                }}
                className="num w-[70px] rounded-[7px] border border-card-border bg-transparent px-2 py-1 text-ink"
              />
            </label>
            <label className="flex items-center gap-2">
              Spend/yr
              <input
                data-testid="sourcing-spend"
                type="number"
                step={1000}
                value={spend ?? sourcing.target_net}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setSpend(value)
                  if (value > 0) {
                    reevaluate(age, value)
                  }
                }}
                className="num w-[110px] rounded-[7px] border border-card-border bg-transparent px-2 py-1 text-ink"
              />
            </label>
          </div>

          <div
            data-testid="sourcing-waterfall"
            className="mt-3.5 flex flex-col gap-[9px] text-[13px]"
          >
            <div className="flex justify-between rounded-[11px] border border-card-border p-[13px]">
              <span>1 · Target net spend</span>
              <b className="num">{formatUsd(sourcing.target_net)}</b>
            </div>
            <div className="flex justify-between rounded-[11px] border border-card-border p-[13px] text-red-text">
              <span>2 · − Non-portfolio income</span>
              <b className="num">{`−${formatUsd(sourcing.income)}`}</b>
            </div>
            <div className="flex justify-between rounded-[11px] bg-soft p-[13px]">
              <span>3 · = Gap from portfolio</span>
              <b className="num">{formatUsd(sourcing.gap)}</b>
            </div>
            {sourcing.steps.map((step, index) => (
              <StepRow
                key={step.name}
                step={step}
                index={index}
                headroom={sourcing.headroom}
              />
            ))}
            <div className="flex justify-between rounded-[11px] bg-ink p-[13px] text-white">
              <span>✓ Net delivered</span>
              <b className="num">{formatUsd(sourcing.net_delivered)}</b>
            </div>
            {sourcing.shortfall > 0 && (
              <div
                data-testid="sourcing-shortfall"
                className="rounded-[11px] border border-red bg-red-soft p-[13px] text-[12.5px] text-red-text"
              >
                Gap unfillable — {formatUsd(sourcing.shortfall)} short of the
                target this year.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-card border border-card-border bg-card p-6">
          <p className="text-sm font-bold">Bucket rules</p>
          <div className="mt-3.5 flex flex-col gap-[11px] text-[12.5px]">
            <RuleCard title="① ETH" tag="LTCG · drawn first">
              Harvest up to the 0% LTCG ceiling. Drawn first to unwind
              concentration.
            </RuleCard>
            <RuleCard title="② Brokerage" tag="LTCG on gain only">
              Lot-level basis from open tax lots. Dividends and interest are
              taxed yearly either way.
            </RuleCard>
            <RuleCard title="③ 401(k)" tag="ordinary income">
              Withdrawals stack on ordinary income. Under 59½ it stays
              locked. Drawn last.
            </RuleCard>
          </div>
          <p className="mt-3.5 rounded-[11px] border border-dashed border-red bg-red-soft p-3 text-xs text-red-text">
            <b>Engine rule:</b> never 0.04 × balance per bucket. Solve for
            net spendable; gross varies by tax cost.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Withdrawals
