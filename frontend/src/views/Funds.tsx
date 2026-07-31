import { useEffect, useState } from 'react'
import type { Fund, FundUpdate, TopUpSource } from '../api.ts'
import {
  archiveFund,
  createFund,
  createFundEntry,
  fetchFunds,
  topUpFund,
  updateFund,
} from '../api.ts'
import EmojiSelect from '../components/EmojiSelect.tsx'
import GhostButton from '../components/GhostButton.tsx'
import NewFundForm from '../components/NewFundForm.tsx'
import { FieldLabel } from '../components/SpendingForm.tsx'
import { FUND_EMOJI_OPTIONS } from '../emoji.ts'
import type { NewFund } from '../funds.ts'
import {
  correctedBalance,
  fundEdit,
  fundView,
  topUpAmount,
  totalParked,
} from '../funds.ts'
import { formatUsd, todayIso } from '../ledger.ts'

// One inline form open per row at a time: the plan edit, the top-up, and
// the balance correction share the row's footer, so opening one closes
// the others — and keeps a single Save/Cancel pair on screen.
type RowForm = 'plan' | 'topup' | 'correct' | null

function FundRow({
  fund,
  onArchive,
  onCorrect,
  onSavePlan,
  onTopUp,
}: {
  fund: Fund
  onArchive: (fundId: number) => Promise<void>
  onCorrect: (fundId: number, balance: number) => Promise<void>
  onSavePlan: (fundId: number, edit: FundUpdate) => Promise<void>
  onTopUp: (
    fundId: number,
    amount: number,
    source: TopUpSource,
    asOf: string,
  ) => Promise<void>
}) {
  const view = fundView(fund)
  const [form, setForm] = useState<RowForm>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [monthly, setMonthly] = useState('')
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState<TopUpSource>('top_up')
  const [asOf, setAsOf] = useState(todayIso)
  const [corrected, setCorrected] = useState('')

  const startEditing = () => {
    setName(fund.name)
    setEmoji(fund.emoji ?? '')
    setMonthly(fund.monthly_plan === null ? '' : String(fund.monthly_plan))
    setForm('plan')
  }

  const startToppingUp = () => {
    setAmount('')
    // The source and date belong to the move being entered, not to the
    // row: a rollover pick or a backdate never sticks around for the
    // next top-up.
    setSource('top_up')
    setAsOf(todayIso())
    setForm('topup')
  }

  const startCorrecting = () => {
    setCorrected(String(fund.balance))
    setForm('correct')
  }

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSavePlan(fund.id, fundEdit(name, emoji, monthly))
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
      await onTopUp(fund.id, delta, source, asOf)
      setForm(null)
    } finally {
      setSaving(false)
    }
  }

  const saveCorrection = async () => {
    const balance = correctedBalance(corrected)
    if (balance === null || balance === fund.balance) return
    setSaving(true)
    try {
      await onCorrect(fund.id, balance)
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
        <div className="flex flex-wrap items-baseline justify-end gap-3">
          <p className="num text-[13.5px] font-semibold">{view.amount}</p>
          <GhostButton label="Top up" onClick={startToppingUp} />
          <GhostButton label="Correct balance" onClick={startCorrecting} />
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
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label htmlFor={`fund-name-${fund.id}`} className="block">
            <FieldLabel text="Name" />
            <input
              id={`fund-name-${fund.id}`}
              className="mt-1 w-[180px] rounded-input border border-input-border bg-card px-3 py-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="w-[150px]">
            <EmojiSelect
              id={`fund-emoji-${fund.id}`}
              value={emoji}
              options={FUND_EMOJI_OPTIONS}
              onChange={setEmoji}
            />
          </div>
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
        <div className="mt-2 flex flex-wrap items-end gap-2">
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
          <label htmlFor={`fund-topup-source-${fund.id}`} className="block">
            <FieldLabel text="Source" />
            <select
              id={`fund-topup-source-${fund.id}`}
              className="mt-1 rounded-input border border-input-border bg-card px-3 py-2 text-sm"
              value={source}
              onChange={(event) =>
                setSource(
                  event.target.value === 'rollover' ? 'rollover' : 'top_up',
                )
              }
            >
              <option value="top_up">
                Regular top-up (counts against this month)
              </option>
              <option value="rollover">From last month's leftover</option>
            </select>
          </label>
          <label htmlFor={`fund-topup-date-${fund.id}`} className="block">
            <FieldLabel text="As of" />
            <input
              id={`fund-topup-date-${fund.id}`}
              type="date"
              className="mt-1 rounded-input border border-input-border bg-card px-3 py-2 text-sm"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
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
      {form === 'correct' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label htmlFor={`fund-correct-${fund.id}`} className="block">
            <FieldLabel text="New balance" />
            <input
              id={`fund-correct-${fund.id}`}
              className="num mt-1 w-[140px] rounded-input border border-input-border bg-card px-3 py-2 text-sm"
              placeholder="tracker only"
              value={corrected}
              onChange={(event) => setCorrected(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveCorrection()}
            className="cursor-pointer rounded-[8px] bg-accent px-3 py-1 text-[11.5px] font-bold text-white disabled:opacity-60"
          >
            Save
          </button>
          <GhostButton label="Cancel" onClick={() => setForm(null)} />
          <p className="text-[11.5px] text-muted-2">
            restates the tracker — safe-to-spend is untouched
          </p>
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

  const correct = async (fundId: number, balance: number) => {
    // A hand-entered entry is the headline-neutral restatement: NULL
    // source, so the tracker moves and safe-to-spend never hears of it.
    await createFundEntry({ fund_id: fundId, as_of_date: todayIso(), balance })
    setFunds(await fetchFunds())
  }

  const topUp = async (
    fundId: number,
    amount: number,
    source: TopUpSource,
    asOf: string,
  ) => {
    // The default source and a today date are omitted, never sent — only
    // a rollover or a redated move marks the payload.
    await topUpFund(fundId, {
      amount,
      ...(source === 'rollover' ? { source } : {}),
      ...(asOf && asOf !== todayIso() ? { as_of_date: asOf } : {}),
    })
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
                onCorrect={correct}
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
