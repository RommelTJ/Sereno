import { useEffect, useState } from 'react'

interface Health {
  status: string
  version: string
}

function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return (
    <div
      className="rounded-card border border-card-border bg-card p-7"
      data-testid="view-dashboard"
    >
      <p className="text-sm text-muted">
        At-a-glance overview — the net worth hero, safe-to-spend card, and plan
        cards land here next.
      </p>
      <p className="mt-4 text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
        Backend
      </p>
      <p className="num text-sm" data-testid="backend-status">
        {health ? `${health.status} · v${health.version}` : 'unreachable'}
      </p>
    </div>
  )
}

export default Dashboard
