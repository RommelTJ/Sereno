import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  // A ref, not the loading state: the sentinel can intersect twice in one
  // tick, and only a ref is already updated when the second one lands.
  const inFlight = useRef(false)
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([])
  const { refresh } = useNetWorth()

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchLedger().then((page) => {
      setMonths(page.months)
      setHasMore(page.has_more)
    })
    void fetchQuickLinks().then(setQuickLinks)
  }, [])

  // Older months, a page at a time, cursored on the oldest month on screen.
  const loadMore = useCallback(async () => {
    const oldest = months?.[months.length - 1]?.month
    if (!oldest || inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const page = await fetchLedger(oldest)
      setMonths((current) => [...(current ?? []), ...page.months])
      setHasMore(page.has_more)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [months])

  const saveBalance = async (input: BalanceEntryInput) => {
    await createBalanceEntry(input)
    // Back to the newest page: the save happens at the top of the screen,
    // and a fresh first page is cheaper than replaying every loaded one.
    const [page] = await Promise.all([fetchLedger(), refresh()])
    setMonths(page.months)
    setHasMore(page.has_more)
  }

  const columns = accounts ? ledgerColumns(accounts) : []

  return (
    <div
      data-testid="view-ledger"
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr] 2xl:grid-cols-[1fr_440px]"
    >
      {accounts && months && (
        <>
          <LedgerTable
            columns={columns}
            rows={ledgerRows(months, columns)}
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
          />
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
