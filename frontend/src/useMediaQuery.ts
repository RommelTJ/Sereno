import { useCallback, useSyncExternalStore } from 'react'

// Whether a CSS media query matches, kept live across resizes. Read
// synchronously on first render, so a layout switched on it never paints
// the wrong variant first.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
