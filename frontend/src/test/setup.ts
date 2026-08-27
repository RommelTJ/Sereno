import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

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
