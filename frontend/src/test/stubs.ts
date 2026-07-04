import { vi } from 'vitest'

/**
 * Stub global fetch with per-path JSON payloads, e.g.
 * `stubApi({ '/api/ledger': [...] })`. Payloads are read at call time, so a
 * test can mutate the routes object to simulate server state changing
 * between requests. Requests to unstubbed paths reject loudly.
 */
export function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const body = routes[path]
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
