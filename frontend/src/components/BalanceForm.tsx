import { useState } from 'react'
import type { BalanceFormValues } from '../ledger.ts'
import {
  computeLiveNetWorth,
  formatAmount,
  formatUsd,
  parseAmount,
} from '../ledger.ts'

interface FieldProps {
  id: string
  label: string
  small?: boolean
  value: string
  onChange: (value: string) => void
}

function Field({ id, label, small = false, value, onChange }: FieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span
        className={`font-semibold uppercase ${
          small ? 'text-[10px] text-faint' : 'text-[11px] text-muted-2'
        }`}
      >
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
  initial: BalanceFormValues
  otherBalances: number
  onSave: (values: BalanceFormValues) => Promise<void>
}

function BalanceForm({ initial, otherBalances, onSave }: BalanceFormProps) {
  const [fields, setFields] = useState(() => ({
    vfiax: formatAmount(initial.vfiax),
    vtiax: formatAmount(initial.vtiax),
    vgsh: formatAmount(initial.vgsh),
    retire: formatAmount(initial.retire),
    ethQty: formatAmount(initial.ethQty),
    ethPrice: formatAmount(initial.ethPrice),
  }))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const setField = (key: keyof typeof fields) => (value: string) => {
    setSaved(false)
    setFields((current) => ({ ...current, [key]: value }))
  }

  const values: BalanceFormValues = {
    vfiax: parseAmount(fields.vfiax),
    vtiax: parseAmount(fields.vtiax),
    vgsh: parseAmount(fields.vgsh),
    retire: parseAmount(fields.retire),
    ethQty: parseAmount(fields.ethQty),
    ethPrice: parseAmount(fields.ethPrice),
  }
  const ethValue = values.ethQty * values.ethPrice
  const netWorth = computeLiveNetWorth(values, otherBalances)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(values)
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
        <div>
          <span className="text-[11px] font-semibold text-muted-2 uppercase">
            Taxable brokerage · per fund
          </span>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field
              id="balance-vfiax"
              label="VFIAX"
              small
              value={fields.vfiax}
              onChange={setField('vfiax')}
            />
            <Field
              id="balance-vtiax"
              label="VTIAX"
              small
              value={fields.vtiax}
              onChange={setField('vtiax')}
            />
            <Field
              id="balance-vgsh"
              label="VGSH"
              small
              value={fields.vgsh}
              onChange={setField('vgsh')}
            />
          </div>
        </div>
        <Field
          id="balance-retire"
          label="Retirement"
          value={fields.retire}
          onChange={setField('retire')}
        />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field
            id="balance-eth-qty"
            label="ETH held"
            value={fields.ethQty}
            onChange={setField('ethQty')}
          />
          <Field
            id="balance-eth-price"
            label="$ / ETH"
            value={fields.ethPrice}
            onChange={setField('ethPrice')}
          />
        </div>
        <p
          data-testid="eth-value"
          className="rounded-input bg-[#f3f6f3] px-3 py-2.5 text-[12.5px] text-[#3a473f]"
        >
          ETH value <b className="num">{formatUsd(ethValue)}</b>{' '}
          <span className="text-muted-2">
            = {fields.ethQty || '0'} × {formatUsd(values.ethPrice)}
          </span>
        </p>
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
          {saved ? 'Saved ✓' : 'Save balances'}
        </button>
      </div>
    </section>
  )
}

export default BalanceForm
