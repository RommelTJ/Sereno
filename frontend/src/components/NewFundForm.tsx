import { useState } from 'react'
import type { NewFund } from '../funds.ts'
import { newFund } from '../funds.ts'
import { FieldLabel } from './SpendingForm.tsx'

const inputClasses =
  'mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2.5 text-sm'

function NewFundForm({ onAdd }: { onAdd: (input: NewFund) => Promise<void> }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')
  const [date, setDate] = useState('')
  const [monthly, setMonthly] = useState('')
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    const input = newFund(name, target, saved, date, monthly)
    if (!input) return
    setAdding(true)
    try {
      await onAdd(input)
      setName('')
      setTarget('')
      setSaved('')
      setDate('')
      setMonthly('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <section
      data-testid="new-fund-form"
      className="mt-4 rounded-[14px] border border-dashed border-[#d4cdbf] bg-[#faf8f3] p-[18px]"
    >
      <h2 className="mb-3 text-[13px] font-bold">+ New fund or goal</h2>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-[11px]">
        <label htmlFor="new-fund-name" className="block">
          <FieldLabel text="Name" />
          <input
            id="new-fund-name"
            className={inputClasses}
            placeholder="e.g. Vacation"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label htmlFor="new-fund-target" className="block">
          <FieldLabel text="Target $" />
          <input
            id="new-fund-target"
            className={`num ${inputClasses}`}
            placeholder="0"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </label>
        <label htmlFor="new-fund-saved" className="block">
          <FieldLabel text="Saved $" />
          <input
            id="new-fund-saved"
            className={`num ${inputClasses}`}
            placeholder="0"
            value={saved}
            onChange={(event) => setSaved(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-[11px] grid grid-cols-[1.4fr_1fr_auto] items-end gap-[11px]">
        <div>
          <label htmlFor="new-fund-date">
            <FieldLabel text="Target date" />
          </label>{' '}
          <span className="text-[11px] font-semibold text-faint">
            · blank = sinking fund
          </span>
          <input
            id="new-fund-date"
            type="date"
            className={inputClasses}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <label htmlFor="new-fund-monthly" className="block">
          <FieldLabel text="$ / month" />
          <input
            id="new-fund-monthly"
            className={`num ${inputClasses}`}
            placeholder="0"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={adding}
          onClick={() => void handleAdd()}
          className="h-[42px] cursor-pointer rounded-[10px] bg-accent px-[18px] text-[13.5px] font-bold text-white disabled:opacity-60"
        >
          + Add
        </button>
      </div>
    </section>
  )
}

export default NewFundForm
