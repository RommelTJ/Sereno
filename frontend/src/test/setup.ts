import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Testing Library only auto-cleans up when vitest globals are enabled.
afterEach(() => {
  cleanup()
})

// jsdom implements no IntersectionObserver, and the Ledger table observes a
// sentinel row to page in older months. This no-op default keeps every test
// that renders the table working; stubIntersectionObserver replaces it in
// the tests where the scrolling itself is what's under test.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('IntersectionObserver', NoopIntersectionObserver)

// jsdom implements no matchMedia either. Views that switch layout on a
// media query (Safe-to-spend's inline vs. floating add-forms) read it,
// so the default answers every query as matched — the widest layout,
// which is the one the pre-existing tests were written against.
// stubMatchMedia replaces it where the narrow layout is under test; the
// default is restored before every test so a narrow stub never leaks.
// jsdom has no visualViewport, and the default keeps it that way;
// stubVisualViewport supplies one where the on-screen keyboard matters.
beforeEach(() => {
  vi.stubGlobal('visualViewport', undefined)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
})
