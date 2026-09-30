// A layout switch that reads the viewport width: the answer on first
// render must already be right (no inline-then-floating flash), and a
// resize across the breakpoint must re-render the view.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stubMatchMedia } from './test/stubs.ts'
import { useMediaQuery } from './useMediaQuery.ts'

describe('useMediaQuery', () => {
  it('answers with the query’s current match on first render', () => {
    stubMatchMedia(false)

    const { result } = renderHook(() => useMediaQuery('(min-width: 97.5rem)'))

    expect(result.current).toBe(false)
  })

  it('re-renders when the viewport crosses the query', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(min-width: 97.5rem)'))

    act(() => media.set(true))

    expect(result.current).toBe(true)
  })

  it('stops listening once unmounted', () => {
    const media = stubMatchMedia(true)
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 97.5rem)'))
    expect(media.listenerCount()).toBe(1)

    unmount()

    expect(media.listenerCount()).toBe(0)
  })
})
