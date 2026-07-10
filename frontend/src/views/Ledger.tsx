import { useEffect, useState } from 'react'
import type {
  Account,
  BalanceEntryInput,
  LedgerMonth,
  QuickLink,
} from '../api.ts'
import {
  createBalanceEntry,
  fetchAccounts,
  fetchLedger,
  fetchQuickLinks,
} from '../api.ts'
import BalanceForm from '../components/BalanceForm.tsx'
import LedgerTable from '../components/LedgerTable.tsx'
import QuickLinks from '../components/QuickLinks.tsx'
import { ledgerColumns, ledgerRows } from '../ledger.ts'
import { useNetWorth } from '../netWorth.ts'

function Ledger() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [months, setMonths] = useState<LedgerMonth[] | null>(null)
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([])
  const { refresh } = useNetWorth()

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchLedger().then(setMonths)
    void fetchQuickLinks().then(setQuickLinks)
  }, [])

  const saveBalance = async (input: BalanceEntryInput) => {
    await createBalanceEntry(input)
    const [updated] = await Promise.all([fetchLedger(), refresh()])
    setMonths(updated)
  }

  const columns = accounts ? ledgerColumns(accounts) : []

  return (
    <div
      data-testid="view-ledger"
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]"
    >
      {accounts && months && (
        <>
          <LedgerTable columns={columns} rows={ledgerRows(months, columns)} />
          <div className="flex flex-col gap-5">
            <BalanceForm
              accounts={columns}
              months={months}
              onSave={saveBalance}
            />
            <QuickLinks links={quickLinks} />
          </div>
        </>
      )}
    </div>
  )
}

export default Ledger
