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
