import { useState } from 'react'
import type { IncomeInput } from '../api.ts'
import { SOURCE_OPTIONS, fundsMonthOptions, incomeInput } from '../budget.ts'
import { todayIso } from '../ledger.ts'
import { FieldLabel } from './SpendingForm.tsx'

const inputClasses =
  'mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2.5 text-sm'

function IncomeForm({
  onAdd,
}: {
  onAdd: (input: IncomeInput) => Promise<void>
}) {
  const months = fundsMonthOptions(todayIso())
  const [amount, setAmount] = useState('')
  const [month, setMonth] = useState(months[0].value)
  const [sourceKey, setSourceKey] = useState(SOURCE_OPTIONS[0].value)
  const [sourceLabel, setSourceLabel] = useState(SOURCE_OPTIONS[0].sourceLabel)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)

  // Switching the source re-prefills the title, overwriting any edit —
  // the title belongs to the selected source, not to the form session.
  const handleSourceChange = (value: string) => {
    setSourceKey(value)
    const option = SOURCE_OPTIONS.find((source) => source.value === value)
    if (option) setSourceLabel(option.sourceLabel)
  }

  const handleAdd = async () => {
    const input = incomeInput(
      amount,
      sourceKey,
      month,
      todayIso(),
      sourceLabel,
      note,
    )
    if (!input) return
    setAdding(true)
    try {
      await onAdd(input)
      setAmount('')
      setNote('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <section
      data-testid="income-form"
      className="rounded-card border border-card-border bg-card p-[22px]"
    >
      <h2 className="text-sm font-bold">Add an income item</h2>
      <p className="mt-0.5 text-[11.5px] text-muted-2">
        A credit tagged to the month it funds.
      </p>
      <div className="mt-3.5 grid grid-cols-1 gap-[11px] sm:grid-cols-2">
        <label htmlFor="income-amount" className="block">
          <FieldLabel text="Amount" />
          <input
            id="income-amount"
            className={`num ${inputClasses}`}
            placeholder="$ 0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label htmlFor="income-month" className="block">
          <FieldLabel text="Funds month" />
          <select
            id="income-month"
            className={inputClasses}
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            {months.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor="income-source" className="mt-[11px] block">
        <FieldLabel text="Source" />
        <select
          id="income-source"
          className={inputClasses}
          value={sourceKey}
          onChange={(event) => handleSourceChange(event.target.value)}
        >
          {SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-[11px] grid grid-cols-1 gap-[11px] sm:grid-cols-2">
        <label htmlFor="income-source-title" className="block">
          <FieldLabel text="Source title" />
          <input
            id="income-source-title"
            className={inputClasses}
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
          />
        </label>
        <label htmlFor="income-note" className="block">
          <FieldLabel text="Note" />
          <input
            id="income-note"
            className={inputClasses}
            placeholder="optional"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={adding}
        onClick={() => void handleAdd()}
        className="mt-3.5 w-full cursor-pointer rounded-[11px] bg-accent py-3 text-[13.5px] font-bold text-white disabled:opacity-60"
      >
        + Add income row
      </button>
      <p className="mt-3.5 rounded-input bg-[#f3f6f3] px-3 py-3 text-xs text-[#3a473f]">
        <b>Rollover</b> — what a month leaves over rolls into the next month's
        funding. Lean months treat you later.
      </p>
    </section>
  )
}

export default IncomeForm
