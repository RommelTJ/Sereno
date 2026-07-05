import { useEffect, useState } from 'react'
import type { Account, LedgerMonth } from '../api.ts'
import { createBalanceEntry, fetchAccounts, fetchLedger } from '../api.ts'
import BalanceForm from '../components/BalanceForm.tsx'
import LedgerTable from '../components/LedgerTable.tsx'
import type { BalanceFormValues } from '../ledger.ts'
import {
  balanceEntryInputs,
  initialFormValues,
  ledgerColumns,
  ledgerRows,
  otherBalancesTotal,
  todayIso,
} from '../ledger.ts'
import { useNetWorth } from '../netWorth.ts'

function Ledger() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [months, setMonths] = useState<LedgerMonth[] | null>(null)
  const { refresh } = useNetWorth()

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchLedger().then(setMonths)
  }, [])

  const saveBalances = (loaded: Account[]) => async (values: BalanceFormValues) => {
    await Promise.all(
      balanceEntryInputs(values, loaded, todayIso()).map(createBalanceEntry),
    )
    const [updated] = await Promise.all([fetchLedger(), refresh()])
    setMonths(updated)
  }

  return (
    <div
      data-testid="view-ledger"
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]"
    >
      {accounts && months && (
        <>
          <LedgerTable
            columns={ledgerColumns(accounts)}
            rows={ledgerRows(months, ledgerColumns(accounts))}
          />
          <BalanceForm
            initial={initialFormValues(months, accounts)}
            otherBalances={otherBalancesTotal(months, accounts)}
            onSave={saveBalances(accounts)}
          />
        </>
      )}
    </div>
  )
}

export default Ledger
