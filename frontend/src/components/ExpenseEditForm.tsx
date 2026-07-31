import { useState } from 'react'
import type {
  ActivityItem,
  Envelope,
  ExpenseUpdateInput,
  Fund,
} from '../api.ts'
import { editMonthOptions, expenseUpdateInput } from '../budget.ts'
import { FieldLabel } from './SpendingForm.tsx'

const inputClasses =
  'mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2.5 text-sm'

interface ExpenseEditFormProps {
  item: ActivityItem
  categories: Envelope[]
  funds: Fund[]
  onSave: (input: ExpenseUpdateInput) => Promise<void>
  onCancel: () => void
}

// The inline edit form a tapped expense row expands into: the same
// Paid-from optgroups as the create form, plus the budget month (the
// prepay reassignment) and the date. Fields the form doesn't show
// (is_fixed, account_id) ride along unchanged via expenseUpdateInput.
function ExpenseEditForm({
  item,
  categories,
  funds,
  onSave,
  onCancel,
}: ExpenseEditFormProps) {
  const storedMonth = item.budget_month ?? item.txn_date.slice(0, 7)
  const storedPaidFrom =
    item.funded_from === 'fund' && item.fund_id != null
      ? `fund:${item.fund_id}`
      : item.category_id != null
        ? `cat:${item.category_id}`
        : ''
  const [amount, setAmount] = useState(String(item.amount))
  const [paidFrom, setPaidFrom] = useState(storedPaidFrom)
  const [txnDate, setTxnDate] = useState(item.txn_date)
  const [budgetMonth, setBudgetMonth] = useState(storedMonth)
  const [note, setNote] = useState(item.note ?? '')
  const [saving, setSaving] = useState(false)

  const months = editMonthOptions(storedMonth, txnDate)
  // An archived category or fund is no longer among the options; keeping
  // the stored pick selectable means a prefill never silently rewires the
  // row's funding source.
  const storedPaidFromKnown =
    categories.some((category) => `cat:${category.id}` === storedPaidFrom) ||
    funds.some((fund) => `fund:${fund.id}` === storedPaidFrom)

  const handleSave = async () => {
    const input = expenseUpdateInput(
      item,
      amount,
      paidFrom,
      txnDate,
      budgetMonth,
      note,
    )
    if (!input) return
    setSaving(true)
    try {
      await onSave(input)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="expense-edit-form"
      className="my-2 rounded-[10px] border border-input-border bg-card p-3.5"
    >
      <div className="grid grid-cols-1 gap-[11px] sm:grid-cols-2">
        <label htmlFor="edit-expense-amount" className="block">
          <FieldLabel text="Amount" />
          <input
            id="edit-expense-amount"
            className={`num ${inputClasses}`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label htmlFor="edit-expense-paid-from" className="block">
          <FieldLabel text="Paid from" />
          <select
            id="edit-expense-paid-from"
            className={inputClasses}
            value={paidFrom}
            onChange={(event) => setPaidFrom(event.target.value)}
          >
            {!storedPaidFromKnown && storedPaidFrom !== '' && (
              <option value={storedPaidFrom}>{item.category ?? '—'}</option>
            )}
            <optgroup label="Budget envelopes">
              {categories.map((category) => (
                <option key={category.id} value={`cat:${category.id}`}>
                  {category.emoji
                    ? `${category.emoji} ${category.name}`
                    : category.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Funds">
              {funds.map((fund) => (
                <option key={fund.id} value={`fund:${fund.id}`}>
                  {fund.emoji ? `${fund.emoji} ${fund.name}` : fund.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label htmlFor="edit-expense-month" className="block">
          <FieldLabel text="Budget month" />
          <select
            id="edit-expense-month"
            className={inputClasses}
            value={budgetMonth}
            onChange={(event) => setBudgetMonth(event.target.value)}
          >
            {months.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="edit-expense-date" className="block">
          <FieldLabel text="Date" />
          <input
            id="edit-expense-date"
            type="date"
            className={`num ${inputClasses}`}
            value={txnDate}
            onChange={(event) => setTxnDate(event.target.value)}
          />
        </label>
      </div>
      <label htmlFor="edit-expense-note" className="mt-[11px] block">
        <FieldLabel text="Note" />
        <input
          id="edit-expense-note"
          className={inputClasses}
          placeholder="optional"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="mt-3.5 flex gap-2.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="flex-1 cursor-pointer rounded-[11px] bg-sidebar py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="flex-1 cursor-pointer rounded-[11px] border border-input-border bg-card py-2.5 text-[13px] font-semibold text-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default ExpenseEditForm
