import type { Envelope } from '../api.ts'
import { envelopeView, monthLabel } from '../budget.ts'

function EnvelopeRow({ envelope }: { envelope: Envelope }) {
  const view = envelopeView(envelope)
  return (
    <div
      data-testid="envelope-row"
      className="border-b border-hairline-2 py-[11px] last:border-b-0"
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
    </div>
  )
}

function EnvelopesCard({
  month,
  envelopes,
}: {
  month: string
  envelopes: Envelope[]
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
        <EnvelopeRow key={envelope.id} envelope={envelope} />
      ))}
    </div>
  )
}

export default EnvelopesCard
