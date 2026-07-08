import { useState } from 'react'
import type { Envelope, ExpenseInput, Fund } from '../api.ts'
import { expenseInput, monthLabel } from '../budget.ts'
import { todayIso } from '../ledger.ts'

const inputClasses =
  'mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2.5 text-sm'

export function FieldLabel({ text }: { text: string }) {
  return (
    <span className="text-[11px] font-semibold text-muted-2 uppercase">
      {text}
    </span>
  )
}

interface SpendingFormProps {
  month: string
  categories: Envelope[]
  funds: Fund[]
  onAdd: (input: ExpenseInput) => Promise<void>
}

function SpendingForm({ month, categories, funds, onAdd }: SpendingFormProps) {
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState(String(categories[0]?.id ?? ''))
  const [fundedFrom, setFundedFrom] = useState('discretionary')
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    const input = expenseInput(amount, Number(categoryId), fundedFrom, todayIso())
    if (!input) return
    setAdding(true)
    try {
      await onAdd(input)
      setAmount('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <section
      data-testid="spending-form"
      className="rounded-card border border-card-border bg-card p-[22px]"
    >
      <h2 className="text-sm font-bold">Add a spending item</h2>
      <div className="mt-3.5 grid grid-cols-1 gap-[11px] sm:grid-cols-2">
        <label htmlFor="spend-amount" className="block">
          <FieldLabel text="Amount" />
          <input
            id="spend-amount"
            className={`num ${inputClasses}`}
            placeholder="$ 0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label htmlFor="spend-category" className="block">
          <FieldLabel text="Category" />
          <select
            id="spend-category"
            className={inputClasses}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.emoji
                  ? `${category.emoji} ${category.name}`
                  : category.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor="spend-funded-from" className="mt-[11px] block">
        <FieldLabel text="Funded from" />
        <select
          id="spend-funded-from"
          className={inputClasses}
          value={fundedFrom}
          onChange={(event) => setFundedFrom(event.target.value)}
        >
          <option value="discretionary">
            {monthLabel(month)} budget · discretionary
          </option>
          {funds.map((fund) => (
            <option key={fund.id} value={`fund:${fund.id}`}>
              {fund.emoji ? `${fund.emoji} ${fund.name}` : fund.name}
            </option>
          ))}
        </select>
      </label>
      {fundedFrom !== 'discretionary' && (
        <p className="mt-2 rounded-tile bg-amber-soft-2 px-[11px] py-2 text-[11.5px] text-amber-text">
          ↳ Log a matching withdrawal from Vanguard Cash Plus so the fund and
          cash draw down together.
        </p>
      )}
      <button
        type="button"
        disabled={adding}
        onClick={() => void handleAdd()}
        className="mt-3.5 w-full cursor-pointer rounded-[11px] bg-sidebar py-3 text-[13.5px] font-bold text-white disabled:opacity-60"
      >
        + Add spending row
      </button>
    </section>
  )
}

export default SpendingForm
