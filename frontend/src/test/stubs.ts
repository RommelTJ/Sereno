import { vi } from 'vitest'

/**
 * Stub global fetch with per-path JSON payloads, e.g.
 * `stubApi({ '/api/ledger': [...] })`. A method-prefixed key like
 * `'POST /api/funds'` wins over the bare path when the same path serves a
 * GET and a POST with different payloads, and a query-carrying key like
 * `'/api/budget-month?month=2026-05'` wins over the bare path for requests
 * with exactly that query — so one path can serve different months.
 * Payloads are read at call time, so a test can mutate the routes object
 * to simulate server state changing between requests. Requests to
 * unstubbed paths reject loudly.
 */
export function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const pathWithQuery = url.replace(/^https?:\/\/[^/]+/, '')
    const path = pathWithQuery.split('?')[0]
    const method = init?.method ?? 'GET'
    const body =
      routes[`${method} ${pathWithQuery}`] ??
      routes[pathWithQuery] ??
      routes[`${method} ${path}`] ??
      routes[path]
    if (body === undefined) {
      return Promise.reject(
        new Error(`unstubbed fetch: ${init?.method ?? 'GET'} ${path}`),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init?.method === 'POST' ? 201 : 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Replace setup's no-op IntersectionObserver with one that keeps its
 * callbacks, so a test can put the observed element on screen without a
 * layout engine: `const observer = stubIntersectionObserver()` then
 * `act(() => observer.trigger())`.
 */
export function stubIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = []
  class CapturingIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', CapturingIntersectionObserver)
  return {
    trigger() {
      for (const callback of callbacks) {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }
    },
  }
}

/**
 * Replace setup's always-matching matchMedia with one whose answer the
 * test controls: `const media = stubMatchMedia(false)` renders the
 * narrow layout, and `act(() => media.set(true))` crosses the
 * breakpoint, notifying every listener the way a resize would.
 */
export function stubMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(listener),
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
  return {
    set(next: boolean) {
      matches = next
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent)
      }
    },
    listenerCount: () => listeners.size,
  }
}
