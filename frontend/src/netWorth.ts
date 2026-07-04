import { createContext, useContext } from 'react'
import type { NetWorth } from './api.ts'

export interface NetWorthContextValue {
  netWorth: NetWorth | null
  refresh: () => Promise<void>
}

// Default lets components render outside the provider (e.g. a view under
// test): no value, refresh is a no-op.
export const NetWorthContext = createContext<NetWorthContextValue>({
  netWorth: null,
  refresh: async () => undefined,
})

export const useNetWorth = () => useContext(NetWorthContext)
