import type { Envelope } from '../api.ts'
import { envelopeView, monthLabel } from '../budget.ts'

// Each row is a tap target (the ActivityFeed tappable-row pattern, so it
// works on touch): tapping selects the envelope as the Activity feed's
// filter, and the selected row wears a tinted background. The constant
// px/-mx pair keeps the geometry identical either way, so selection never
// shifts the layout.
function EnvelopeRow({
  envelope,
  selected,
  onSelect,
}: {
  envelope: Envelope
  selected: boolean
  onSelect: (envelope: Envelope) => void
}) {
  const view = envelopeView(envelope)
  return (
    <button
      type="button"
      data-testid="envelope-row"
      aria-pressed={selected}
      onClick={() => onSelect(envelope)}
      className={`-mx-2 block w-[calc(100%+16px)] cursor-pointer rounded-[8px] border-b border-hairline-2 px-2 py-[11px] text-left last:border-b-0 ${selected ? 'bg-tile' : ''}`}
    >
      <div className="flex justify-between text-[13px]">
        <span>{view.label}</span>
        <span
          className={`num font-semibold ${view.over ? 'text-red' : 'text-muted'}`}
        >
          {view.right}
        </span>
      </div>
      <div className="mt-1.5 h-[7px] overflow-hidden rounded-[5px] bg-track">
        <div
          data-testid="envelope-bar"
          className={`h-full rounded-[5px] ${view.over ? 'bg-red' : 'bg-accent'}`}
          style={{ width: `${view.barPct}%` }}
        />
      </div>
    </button>
  )
}

function EnvelopesCard({
  month,
  envelopes,
  selectedId,
  onSelect,
}: {
  month: string
  envelopes: Envelope[]
  selectedId: number | null
  onSelect: (envelope: Envelope) => void
}) {
  return (
    <div className="rounded-card border border-card-border bg-card p-[22px]">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-sm font-bold">{monthLabel(month)} envelopes</p>
        <p className="text-[11.5px] text-muted-2">
          over is OK — trims safe-to-spend
        </p>
      </div>
      {envelopes.map((envelope) => (
        <EnvelopeRow
          key={envelope.id}
          envelope={envelope}
          selected={envelope.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default EnvelopesCard
