// iOS Safari leaves position: fixed elements pinned to the layout
// viewport when the on-screen keyboard opens, so a bottom sheet ends up
// behind the keyboard. The visual viewport says how much of the window
// the keyboard covers: the sheet lifts by that inset and caps its height
// to what is still visible. jsdom's window is 768px tall.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stubVisualViewport } from './test/stubs.ts'
import { useVisualViewportInset } from './useVisualViewportInset.ts'

describe('useVisualViewportInset', () => {
  it('reports no inset and the whole window without a visualViewport', () => {
    const { result } = renderHook(() => useVisualViewportInset())

    expect(result.current).toEqual({ bottom: 0, height: 768 })
  })

  it('reports no inset while the keyboard is down', () => {
    stubVisualViewport()

    const { result } = renderHook(() => useVisualViewportInset())

    expect(result.current).toEqual({ bottom: 0, height: 768 })
  })

  it('lifts by the height the keyboard covers', () => {
    const viewport = stubVisualViewport()
    const { result } = renderHook(() => useVisualViewportInset())

    act(() => viewport.set({ height: 368 }))

    expect(result.current).toEqual({ bottom: 400, height: 368 })
  })

  it('follows the visual viewport as Safari scrolls it', () => {
    const viewport = stubVisualViewport()
    const { result } = renderHook(() => useVisualViewportInset())

    act(() => viewport.set({ height: 368, offsetTop: 50 }))

    expect(result.current).toEqual({ bottom: 350, height: 368 })
  })

  it('stops following once unmounted', () => {
    const viewport = stubVisualViewport()
    const { result, unmount } = renderHook(() => useVisualViewportInset())

    unmount()
    act(() => viewport.set({ height: 368 }))

    expect(result.current).toEqual({ bottom: 0, height: 768 })
  })
})
