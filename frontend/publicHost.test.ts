// The deploy's public hostname enters vite.config.ts through the
// SERENO_PUBLIC_HOST env var, so the tracked file stays correct for
// every environment and only ignored files differ on the deploy box.
// Unset — the local-dev and CI case — the helper adds nothing, keeping
// today's server config byte-identical.
import { describe, expect, it } from 'vitest'

import { publicHostServer } from './publicHost.ts'

describe('publicHostServer', () => {
  it('adds nothing when the host is unset', () => {
    expect(publicHostServer(undefined)).toEqual({})
  })

  it('adds nothing when the host is empty', () => {
    // Compose renders `SERENO_PUBLIC_HOST:` with no value as '' — that
    // must not half-configure the check as allowedHosts: [''].
    expect(publicHostServer('')).toEqual({})
  })

  it('allows the host and points HMR at it over wss when set', () => {
    expect(publicHostServer('finance.example.com')).toEqual({
      allowedHosts: ['finance.example.com'],
      hmr: { host: 'finance.example.com', clientPort: 443, protocol: 'wss' },
    })
  })
})
