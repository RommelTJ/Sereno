import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  Fund,
  FundLogEntry,
  FundUpdate,
  TopUpSource,
} from '../api.ts'
import {
  archiveFund,
  createFund,
  createFundEntry,
  fetchFundEntries,
  fetchFunds,
  topUpFund,
  updateFund,
} from '../api.ts'
import EmojiSelect from '../components/EmojiSelect.tsx'
import FundLog from '../components/FundLog.tsx'
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
import { useMediaQuery } from '../useMediaQuery.ts'

// Tailwind's lg: from here up the log sits beside the funds.
const SIDE_BY_SIDE = '(min-width: 64rem)'

// One inline form open per row at a time: the plan edit, the top-up, and
// the balance correction share the row's footer, so opening one closes
// the others — and keeps a single Save/Cancel pair on screen.
type RowForm = 'plan' | 'topup' | 'correct' | null

// Clicks landing on the card's own controls — its buttons and the inline
// forms' fields — never toggle the card's selection.
const CARD_CONTROLS = 'button, input, select, textarea, label'

function FundRow({
  fund,
  selected,
  onSelect,
  onArchive,
  onCorrect,
  onSavePlan,
  onTopUp,
}: {
  fund: Fund
  selected: boolean
  onSelect: (fundId: number) => void
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
    <div
      data-testid="fund-row"
      onClick={(event) => {
        if (!(event.target as Element).closest(CARD_CONTROLS)) {
          onSelect(fund.id)
        }
      }}
      className={`-m-2 cursor-pointer rounded-[10px] p-2 ${selected ? 'bg-tile' : ''}`}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[14.5px] font-bold">
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(fund.id)}
            className="cursor-pointer text-left"
          >
            {view.name}
          </button>{' '}
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
  // The fund the log is filtered to lives in ?fund=, so a refresh, Back,
  // and a Safe-to-spend fund-row link all land on it. An id naming no
  // active fund is ignored; undefined means the funds haven't loaded, so
  // the log waits rather than fetching unfiltered first.
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = Number(searchParams.get('fund'))
  const selectedFund = funds?.find((fund) => fund.id === requested) ?? null
  const selectedId = funds ? (selectedFund?.id ?? null) : undefined
  // The log's month opens on the current one; logVersion bumps after every
  // fund change so the log refetches the entries that change wrote.
  const [logMonth, setLogMonth] = useState(() => todayIso().slice(0, 7))
  const [logVersion, setLogVersion] = useState(0)
  const [entries, setEntries] = useState<FundLogEntry[] | null>(null)
  const [paging, setPaging] = useState(false)
  const sideBySide = useMediaQuery(SIDE_BY_SIDE)
  const logRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void fetchFunds().then(setFunds)
  }, [])

  useEffect(() => {
    if (selectedId === undefined) return
    // A slow response for a month or filter already left must not land.
    let current = true
    setPaging(true)
    void fetchFundEntries(logMonth, selectedId)
      .then((next) => {
        if (current) setEntries(next)
      })
      .finally(() => {
        if (current) setPaging(false)
      })
    return () => {
      current = false
    }
  }, [logMonth, logVersion, selectedId])

  // Selecting the selected fund clears it. The URL is replaced, not
  // pushed, so toggling never piles up history for Back to walk through.
  // Stacked below the funds list, the log is out of sight, so a new
  // selection scrolls it into view.
  const select = (fundId: number) => {
    const clearing = selectedId === fundId
    setSearchParams(clearing ? {} : { fund: String(fundId) }, {
      replace: true,
    })
    if (!clearing && !sideBySide) {
      logRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const refresh = async () => {
    setFunds(await fetchFunds())
    setLogVersion((version) => version + 1)
  }

  const addFund = async ({ fund, saved }: NewFund) => {
    const created = await createFund(fund)
    if (saved > 0) {
      await createFundEntry({
        fund_id: created.id,
        as_of_date: todayIso(),
        balance: saved,
      })
    }
    await refresh()
  }

  const archive = async (fundId: number) => {
    await archiveFund(fundId)
    await refresh()
  }

  const savePlan = async (fundId: number, edit: FundUpdate) => {
    await updateFund(fundId, edit)
    await refresh()
  }

  const correct = async (fundId: number, balance: number) => {
    // A hand-entered entry is the headline-neutral restatement: NULL
    // source, so the tracker moves and safe-to-spend never hears of it.
    await createFundEntry({ fund_id: fundId, as_of_date: todayIso(), balance })
    await refresh()
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
    await refresh()
  }

  // Funds take two thirds and the log the last third from lg up; below
  // it the log stacks under the funds list.
  return (
    <div
      data-testid="view-funds"
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3"
    >
      <div data-testid="funds-column" className="lg:col-span-2">
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
                  selected={fund.id === selectedId}
                  onSelect={select}
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
      <FundLog
        ref={logRef}
        month={logMonth}
        entries={entries}
        paging={paging}
        onPage={setLogMonth}
        filter={selectedFund ? fundView(selectedFund).name : null}
        onClearFilter={() => setSearchParams({}, { replace: true })}
      />
    </div>
  )
}

export default Funds
