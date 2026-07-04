import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { NetWorth } from '../api.ts'
import { fetchNetWorth } from '../api.ts'
import { NetWorthContext } from '../netWorth.ts'

function NetWorthProvider({ children }: { children: ReactNode }) {
  const [netWorth, setNetWorth] = useState<NetWorth | null>(null)

  const refresh = useCallback(async () => {
    try {
      setNetWorth(await fetchNetWorth())
    } catch {
      // Local LAN app — the handoff specifies no error states. Keep the
      // last known value (or the placeholder) if the API is unreachable.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <NetWorthContext value={{ netWorth, refresh }}>{children}</NetWorthContext>
  )
}

export default NetWorthProvider
