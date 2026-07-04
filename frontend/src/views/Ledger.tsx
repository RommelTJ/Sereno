import { useEffect, useState } from 'react'
import type { Account, LedgerMonth } from '../api.ts'
import { fetchAccounts, fetchLedger } from '../api.ts'
import LedgerTable from '../components/LedgerTable.tsx'
import { ledgerRows } from '../ledger.ts'

function Ledger() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [months, setMonths] = useState<LedgerMonth[] | null>(null)

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchLedger().then(setMonths)
  }, [])

  return (
    <div
      data-testid="view-ledger"
      className="grid grid-cols-[1.6fr_1fr] items-start gap-5"
    >
      {accounts && months && (
        <LedgerTable rows={ledgerRows(months, accounts)} />
      )}
    </div>
  )
}

export default Ledger
