import { useEffect, useState } from 'react'

interface Health {
  status: string
  version: string
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-card border border-card-border bg-card p-7">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-tile bg-accent font-bold text-white">
            S
          </div>
          <h1 className="text-[21px] font-bold">Sereno</h1>
        </div>
        <p className="mt-3 text-sm text-muted">
          A calm, queryable picture of your money. Scaffold in place — the
          dashboard is next.
        </p>
        <p className="mt-4 text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
          Backend
        </p>
        <p className="num text-sm" data-testid="backend-status">
          {health ? `${health.status} · v${health.version}` : 'unreachable'}
        </p>
        <p className="mt-4 text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
          Tokens
        </p>
        <div className="mt-2 flex gap-2 text-[11px] font-semibold">
          <span className="rounded-pill bg-green-soft px-3 py-1 text-accent">
            Positive
          </span>
          <span className="rounded-pill bg-amber-soft px-3 py-1 text-amber-text">
            Caution
          </span>
          <span className="rounded-pill bg-red-soft px-3 py-1 text-red-text">
            Over budget
          </span>
        </div>
        <div className="mt-3 h-[7px] overflow-hidden rounded-[5px] bg-track">
          <div className="h-full w-2/3 rounded-[5px] bg-accent" />
        </div>
      </div>
    </main>
  )
}

export default App
