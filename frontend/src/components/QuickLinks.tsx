import type { QuickLink } from '../api.ts'

// The institution URLs behind the monthly balance ritual, one click from
// the form that needs them. Display-only — links are managed on Settings
// & data — and absent entirely until links exist.
function QuickLinks({ links }: { links: QuickLink[] }) {
  if (links.length === 0) {
    return null
  }
  return (
    <section
      data-testid="quick-links"
      className="rounded-card border border-card-border bg-card p-5.5"
    >
      <h2 className="text-sm font-bold">Quick links</h2>
      <p className="mt-0.5 text-[11.5px] text-muted-2">
        Each opens in a new tab · managed in Settings &amp; data.
      </p>
      <div className="mt-2">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center border-b border-hairline-2 py-[11px] text-[13px] font-semibold last:border-b-0"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  )
}

export default QuickLinks
