import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Account, Guardrails as GuardrailsData } from '../api.ts'
import { fetchAccounts, fetchGuardrails } from '../api.ts'
import {
  formatRate,
  hasInvestableAccount,
  markerLeftPct,
  sliderBounds,
  zoneCopy,
} from '../guardrails.ts'
import { formatUsd } from '../ledger.ts'

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
        {label}
      </p>
      {children}
    </div>
  )
}

function Band({ guardrails }: { guardrails: GuardrailsData }) {
  return (
    <div className="mt-7">
      <div className="flex justify-between text-[11px] font-semibold text-muted-2">
        <span>CUT 10%</span>
        <span>HOLD</span>
        <span>RAISE 10%</span>
      </div>
      <div className="relative mt-[7px] flex h-[30px] overflow-hidden rounded-[9px] border border-card-border">
        <div className="flex flex-1 items-center justify-center bg-red-soft-2 text-[10.5px] text-red-text">
          &gt;{formatRate(guardrails.upper)}
        </div>
        <div className="flex-2 bg-green-soft-2" />
        <div className="flex flex-1 items-center justify-center bg-amber-soft text-[10.5px] text-amber-text">
          &lt;{formatRate(guardrails.lower)}
        </div>
        <div
          data-testid="guardrails-marker"
          className="absolute top-0 h-full w-[3px] bg-ink"
          style={{
            left: `${markerLeftPct(guardrails.rate, guardrails.lower, guardrails.upper)}%`,
          }}
        />
      </div>
      <div className="mt-[5px] flex justify-between text-[10.5px] text-muted-2">
        <span>upper guardrail {formatRate(guardrails.upper)}</span>
        <span>lower guardrail {formatRate(guardrails.lower)}</span>
      </div>
    </div>
  )
}

function Guardrails() {
  const [guardrails, setGuardrails] = useState<GuardrailsData | null>()
  const [accounts, setAccounts] = useState<Account[]>()
  const [spend, setSpend] = useState<number | null>(null)

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchGuardrails().then(setGuardrails)
  }, [])

  const trySpend = (value: number) => {
    setSpend(value)
    void fetchGuardrails(value).then(setGuardrails)
  }

  if (guardrails === undefined || accounts === undefined) {
    return <div data-testid="view-guardrails" className="max-w-[860px]" />
  }

  if (guardrails === null) {
    return (
      <div data-testid="view-guardrails" className="max-w-[860px]">
        <div
          data-testid="guardrails-empty"
          className="rounded-card border border-card-border bg-card p-[26px] text-[13.5px] text-muted"
        >
          {hasInvestableAccount(accounts) ? (
            <>
              Guardrails need a spend plan — an annual target and the
              at-retirement withdrawal rate — plus at least one month of
              balances. Set both on the{' '}
              <Link to="/settings" className="text-accent underline">
                Assumptions card under Settings &amp; data
              </Link>
              , then enter this month's balances in Ledger entries.
            </>
          ) : (
            <>
              No accounts are marked investable yet, so there is no
              portfolio to measure a withdrawal rate against. Use Edit on
              each investment account under Settings &amp; data to set its
              kind, investable flag, and withdrawal priority.
            </>
          )}
        </div>
      </div>
    )
  }

  const cut = guardrails.zone === 'cut'
  const copy = zoneCopy(guardrails.zone, guardrails.spend)
  const bounds = sliderBounds(guardrails)

  return (
    <div data-testid="view-guardrails" className="max-w-[860px]">
      <div className="rounded-card border border-card-border bg-card p-[26px]">
        <div className="flex flex-wrap gap-6">
          <Kpi label="Investable portfolio">
            <p className="num text-[26px] font-extrabold">
              {formatUsd(guardrails.investable)}
            </p>
          </Kpi>
          <Kpi label="Planned spend">
            <p className="num text-[26px] font-extrabold">
              {formatUsd(guardrails.spend)}
            </p>
          </Kpi>
          <Kpi label="Withdrawal rate">
            <p
              data-testid="guardrails-rate"
              className={`num text-[26px] font-extrabold ${cut ? 'text-red' : 'text-accent'}`}
            >
              {formatRate(guardrails.rate)}
            </p>
          </Kpi>
          <div className="ml-auto self-center text-right text-[11.5px] text-muted-2">
            <p>Guyton-Klinger ±{Math.round(guardrails.band * 100)}%</p>
            <p>4% ceiling {formatUsd(guardrails.four_percent_spend)}</p>
          </div>
        </div>

        <Band guardrails={guardrails} />

        <div
          data-testid="guardrails-banner"
          className={`mt-[22px] rounded-[13px] border p-[18px] ${
            cut ? 'border-red bg-red-soft' : 'border-accent bg-green-soft'
          }`}
        >
          <p className={`text-lg font-extrabold ${cut ? 'text-red' : 'text-accent'}`}>
            {copy.message}
          </p>
          <p className="mt-[5px] text-[12.5px] text-muted">{copy.sub}</p>
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-xs text-muted">
            <span>Drag to test a spend level</span>
            <span className="num font-bold text-ink">
              {formatUsd(spend ?? guardrails.spend)}/yr
            </span>
          </div>
          <input
            data-testid="guardrails-slider"
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={spend ?? guardrails.spend}
            onChange={(event) => trySpend(Number(event.target.value))}
            className="mt-2 w-full accent-accent"
          />
        </div>

        <div className="mt-[18px] grid grid-cols-1 gap-3.5 text-[12.5px] sm:grid-cols-2">
          <div
            data-testid="guardrails-raise-trigger"
            className="rounded-[11px] bg-amber-soft p-[13px]"
          >
            <b>Raise trigger</b>
            <br />
            If portfolio rises to{' '}
            <b className="num">{formatUsd(guardrails.raise_trigger)}</b> →
            raise spend ~10%.
          </div>
          <div
            data-testid="guardrails-cut-trigger"
            className="rounded-[11px] bg-red-soft-2 p-[13px]"
          >
            <b>Cut trigger</b>
            <br />
            If portfolio falls to{' '}
            <b className="num">{formatUsd(guardrails.cut_trigger)}</b> → cut
            spend ~10%.
          </div>
        </div>
      </div>
    </div>
  )
}

export default Guardrails
