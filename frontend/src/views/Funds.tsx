import { useEffect, useState } from 'react'
import type { Fund, FundUpdate } from '../api.ts'
import {
  archiveFund,
  createFund,
  createFundEntry,
  fetchFunds,
  topUpFund,
  updateFund,
} from '../api.ts'
import GhostButton from '../components/GhostButton.tsx'
import NewFundForm from '../components/NewFundForm.tsx'
import { FieldLabel } from '../components/SpendingForm.tsx'
import type { NewFund } from '../funds.ts'
import { fundPlanEdit, fundView, topUpAmount, totalParked } from '../funds.ts'
import { formatUsd, todayIso } from '../ledger.ts'

// One inline form open per row at a time: the plan edit and the top-up
// share the row's footer, so opening one closes the other — and keeps a
// single Save/Cancel pair on screen.
type RowForm = 'plan' | 'topup' | null

function FundRow({
  fund,
  onArchive,
  onSavePlan,
  onTopUp,
}: {
  fund: Fund
  onArchive: (fundId: number) => Promise<void>
  onSavePlan: (fundId: number, edit: FundUpdate) => Promise<void>
  onTopUp: (fundId: number, amount: number) => Promise<void>
}) {
  const view = fundView(fund)
  const [form, setForm] = useState<RowForm>(null)
  const [saving, setSaving] = useState(false)
  const [monthly, setMonthly] = useState('')
  const [amount, setAmount] = useState('')

  const startEditing = () => {
    setMonthly(fund.monthly_plan === null ? '' : String(fund.monthly_plan))
    setForm('plan')
  }

  const startToppingUp = () => {
    setAmount('')
    setForm('topup')
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSavePlan(fund.id, fundPlanEdit(monthly))
      setForm(null)
    } finally {
      setSaving(false)
    }
  }

  const saveTopUp = async () => {
    const delta = topUpAmount(amount)
    if (!delta) return
    setSaving(true)
    try {
      await onTopUp(fund.id, delta)
      setForm(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="fund-row">
      <div className="flex items-baseline justify-between">
        <p className="text-[14.5px] font-bold">
          {view.name}{' '}
          <span className="text-[11.5px] font-medium text-muted-2">
            · {view.meta}
          </span>
        </p>
        <div className="flex items-baseline gap-3">
          <p className="num text-[13.5px] font-semibold">{view.amount}</p>
          <GhostButton label="Top up" onClick={startToppingUp} />
          <GhostButton label="Edit" onClick={startEditing} />
          <GhostButton
            label="Archive"
            onClick={() => void onArchive(fund.id)}
          />
        </div>
      </div>
      {view.barPct !== null && (
        <div className="mt-2 h-[9px] overflow-hidden rounded-[6px] bg-track">
          <div
            data-testid="fund-bar"
            className={`h-full rounded-[6px] ${view.done ? 'bg-accent' : 'bg-sidebar'}`}
            style={{ width: `${view.barPct}%` }}
          />
        </div>
      )}
      <p
        className={`mt-[5px] text-[11.5px] ${view.done ? 'text-accent' : 'text-muted-2'}`}
      >
        {view.note}
      </p>
      {form === 'plan' && (
        <div className="mt-2 flex items-end gap-2">
          <label htmlFor={`fund-plan-${fund.id}`} className="block">
            <FieldLabel text="$ / month" />
            <input
              id={`fund-plan-${fund.id}`}
              className="num mt-1 w-[120px] rounded-input border border-input-border bg-card px-3 py-2 text-sm"
              placeholder="blank = paused"
              value={monthly}
              onChange={(event) => setMonthly(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="cursor-pointer rounded-[8px] bg-accent px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-60"
          >
            Save
          </button>
          <GhostButton label="Cancel" onClick={() => setForm(null)} />
        </div>
      )}
      {form === 'topup' && (
        <div className="mt-2 flex items-end gap-2">
          <label htmlFor={`fund-topup-${fund.id}`} className="block">
            <FieldLabel text="$ amount" />
            <input
              id={`fund-topup-${fund.id}`}
              className="num mt-1 w-[120px] rounded-input border border-input-border bg-card px-3 py-2 text-sm"
              placeholder="negative releases"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveTopUp()}
            className="cursor-pointer rounded-[8px] bg-accent px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-60"
          >
            Save
          </button>
          <GhostButton label="Cancel" onClick={() => setForm(null)} />
        </div>
      )}
    </div>
  )
}

function Funds() {
  const [funds, setFunds] = useState<Fund[] | null>(null)

  useEffect(() => {
    void fetchFunds().then(setFunds)
  }, [])

  const addFund = async ({ fund, saved }: NewFund) => {
    const created = await createFund(fund)
    if (saved > 0) {
      await createFundEntry({
        fund_id: created.id,
        as_of_date: todayIso(),
        balance: saved,
      })
    }
    setFunds(await fetchFunds())
  }

  const archive = async (fundId: number) => {
    await archiveFund(fundId)
    setFunds(await fetchFunds())
  }

  const savePlan = async (fundId: number, edit: FundUpdate) => {
    await updateFund(fundId, edit)
    setFunds(await fetchFunds())
  }

  const topUp = async (fundId: number, amount: number) => {
    await topUpFund(fundId, { amount })
    setFunds(await fetchFunds())
  }

  return (
    <div data-testid="view-funds" className="max-w-[760px]">
      {funds && (
        <div className="rounded-card border border-card-border bg-card p-[22px]">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted-2">
              Total parked{' '}
              <span className="num text-xl font-extrabold text-ink">
                {formatUsd(totalParked(funds))}
              </span>
            </p>
            <p className="text-[12.5px] text-muted-2">
              notes auto-calculate from target, saved &amp; date
            </p>
          </div>
          <NewFundForm onAdd={addFund} />
          <div className="mt-[18px] flex flex-col gap-5">
            {funds.map((fund) => (
              <FundRow
                key={fund.id}
                fund={fund}
                onArchive={archive}
                onSavePlan={savePlan}
                onTopUp={topUp}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Funds
