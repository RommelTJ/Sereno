// The deploy's public hostname, read from SERENO_PUBLIC_HOST by
// vite.config.ts. Set — the reverse-proxied deployment — the dev
// server allows the host and points HMR at it over wss on 443, where
// the proxy terminates TLS. Unset or empty, nothing is added, so the
// local-dev and CI config stays exactly as it was before the variable
// existed.
import type { ServerOptions } from 'vite'

export function publicHostServer(host: string | undefined): Partial<ServerOptions> {
  if (!host) return {}
  return {
    allowedHosts: [host],
    hmr: { host, clientPort: 443, protocol: 'wss' },
  }
}
