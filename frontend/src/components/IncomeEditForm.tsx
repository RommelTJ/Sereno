import { useState } from 'react'
import type { ActivityItem, IncomeUpdateInput } from '../api.ts'
import {
  SOURCE_OPTIONS,
  editMonthOptions,
  incomeUpdateInput,
  sourceOptionFor,
} from '../budget.ts'
import DeleteButton from './DeleteButton.tsx'
import { FieldLabel } from './SpendingForm.tsx'

const inputClasses =
  'mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2.5 text-sm'

interface IncomeEditFormProps {
  item: ActivityItem
  onSave: (input: IncomeUpdateInput) => Promise<void>
  onDelete: () => Promise<void>
  onCancel: () => void
}

// The inline edit form a tapped income row expands into: the create
// form's fields plus the date, each prefilled from the row. The source
// select re-prefills the title on switch, exactly like the create form —
// the title belongs to the selected source. tax_treatment and account_id
// ride along unchanged via incomeUpdateInput.
function IncomeEditForm({
  item,
  onSave,
  onDelete,
  onCancel,
}: IncomeEditFormProps) {
  const storedMonth = item.budget_month ?? item.txn_date.slice(0, 7)
  const storedOption = sourceOptionFor(item.source, item.source_label)
  const [amount, setAmount] = useState(String(item.amount))
  const [month, setMonth] = useState(storedMonth)
  const [sourceKey, setSourceKey] = useState(storedOption.value)
  const [sourceLabel, setSourceLabel] = useState(
    item.source_label ?? storedOption.sourceLabel,
  )
  const [txnDate, setTxnDate] = useState(item.txn_date)
  const [note, setNote] = useState(item.note ?? '')
  const [pending, setPending] = useState(item.pending ?? false)
  const [saving, setSaving] = useState(false)

  const months = editMonthOptions(storedMonth, txnDate)

  const handleSourceChange = (value: string) => {
    setSourceKey(value)
    const option = SOURCE_OPTIONS.find((source) => source.value === value)
    if (option) setSourceLabel(option.sourceLabel)
  }

  const handleSave = async () => {
    const input = incomeUpdateInput(
      item,
      amount,
      sourceKey,
      month,
      txnDate,
      sourceLabel,
      note,
      pending,
    )
    if (!input) return
    setSaving(true)
    try {
      await onSave(input)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    try {
      await onDelete()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="income-edit-form"
      className="my-2 rounded-[10px] border border-input-border bg-card p-3.5"
    >
      <div className="grid grid-cols-1 gap-[11px] sm:grid-cols-2">
        <label htmlFor="edit-income-amount" className="block">
          <FieldLabel text="Amount" />
          <input
            id="edit-income-amount"
            className={`num ${inputClasses}`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label htmlFor="edit-income-month" className="block">
          <FieldLabel text="Funds month" />
          <select
            id="edit-income-month"
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
        <label htmlFor="edit-income-source" className="block">
          <FieldLabel text="Source" />
          <select
            id="edit-income-source"
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
        <label htmlFor="edit-income-date" className="block">
          <FieldLabel text="Date" />
          <input
            id="edit-income-date"
            type="date"
            className={`num ${inputClasses}`}
            value={txnDate}
            onChange={(event) => setTxnDate(event.target.value)}
          />
        </label>
        <label htmlFor="edit-income-source-title" className="block">
          <FieldLabel text="Source title" />
          <input
            id="edit-income-source-title"
            className={inputClasses}
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
          />
        </label>
        <label htmlFor="edit-income-note" className="block">
          <FieldLabel text="Note" />
          <input
            id="edit-income-note"
            className={inputClasses}
            placeholder="optional"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <label
        htmlFor="edit-income-pending"
        className="mt-[11px] flex items-center gap-2 py-1"
      >
        <input
          id="edit-income-pending"
          type="checkbox"
          className="h-4 w-4 accent-sidebar"
          checked={pending}
          onChange={(event) => setPending(event.target.checked)}
        />
        <FieldLabel text="Pending" />
      </label>
      <div className="mt-3.5 flex gap-2.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="flex-1 cursor-pointer rounded-[11px] bg-accent py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
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
        <DeleteButton disabled={saving} onDelete={() => void handleDelete()} />
      </div>
    </div>
  )
}

export default IncomeEditForm
