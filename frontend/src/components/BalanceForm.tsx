import { useState } from 'react'
import type { Account, BalanceEntryInput, LedgerMonth } from '../api.ts'
import type { BalanceDraft } from '../ledger.ts'
import {
  draftFor,
  entryInput,
  formatUsd,
  liveNetWorth,
  parseAmount,
  todayIso,
} from '../ledger.ts'

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

function Field({ id, label, value, onChange }: FieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-[11px] font-semibold text-muted-2 uppercase">
        {label}
      </span>
      <input
        id={id}
        className="num mt-1 w-full rounded-input border border-input-border px-3 py-2.5 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

interface BalanceFormProps {
  accounts: Account[] // the picker's accounts: active, assets then liabilities
  months: LedgerMonth[]
  onSave: (input: BalanceEntryInput) => Promise<void>
}

function BalanceForm({ accounts, months, onSave }: BalanceFormProps) {
  const [accountId, setAccountId] = useState(() => accounts[0]?.id ?? 0)
  const account =
    accounts.find((option) => option.id === accountId) ?? accounts[0]
  const [draft, setDraft] = useState<BalanceDraft>(() =>
    account ? draftFor(account, months) : { value: '', qty: '', price: '' },
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!account) {
    return null
  }

  const selectAccount = (id: number) => {
    const next = accounts.find((option) => option.id === id)
    if (!next) return
    setAccountId(id)
    setDraft(draftFor(next, months))
    setSaved(false)
  }

  const setField = (key: keyof BalanceDraft) => (value: string) => {
    setSaved(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const ethValue = parseAmount(draft.qty) * parseAmount(draft.price)
  const netWorth = liveNetWorth(months, account, draft)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(entryInput(account, draft, todayIso()))
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-card border border-card-border bg-card p-5.5">
      <h2 className="text-sm font-bold">Update this month's balances</h2>
      <p className="mt-0.5 text-[11.5px] text-muted-2">
        Latest entry in a month wins · earlier rows kept as history.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <label htmlFor="balance-account" className="block">
          <span className="text-[11px] font-semibold text-muted-2 uppercase">
            Account
          </span>
          <select
            id="balance-account"
            className="mt-1 w-full rounded-input border border-input-border bg-card px-3 py-2.5 text-sm"
            value={account.id}
            onChange={(event) => selectAccount(Number(event.target.value))}
          >
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.emoji ? `${option.emoji} ${option.name}` : option.name}
              </option>
            ))}
          </select>
        </label>

        {account.kind === 'eth' ? (
          <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Field
                id="balance-eth-qty"
                label="ETH held"
                value={draft.qty}
                onChange={setField('qty')}
              />
              <Field
                id="balance-eth-price"
                label="$ / ETH"
                value={draft.price}
                onChange={setField('price')}
              />
            </div>
            <p
              data-testid="eth-value"
              className="rounded-input bg-[#f3f6f3] px-3 py-2.5 text-[12.5px] text-[#3a473f]"
            >
              ETH value <b className="num">{formatUsd(ethValue)}</b>{' '}
              <span className="text-muted-2">
                = {draft.qty || '0'} × {formatUsd(parseAmount(draft.price))}
              </span>
            </p>
          </>
        ) : (
          <Field
            id="balance-value"
            label="Value"
            value={draft.value}
            onChange={setField('value')}
          />
        )}
      </div>

      <div className="mt-4.5 flex items-center justify-between border-t border-hairline pt-4">
        <div>
          <p className="text-[11px] font-semibold text-muted-2 uppercase">
            Net worth (live)
          </p>
          <p data-testid="live-net-worth" className="num text-[22px] font-extrabold">
            {formatUsd(netWorth)}
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="cursor-pointer rounded-[11px] bg-sidebar px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
        >
          {saved ? 'Saved ✓' : 'Save balance'}
        </button>
      </div>
    </section>
  )
}

export default BalanceForm
