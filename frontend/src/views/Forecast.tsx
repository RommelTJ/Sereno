import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type {
  Account,
  BindingConstraint,
  Forecast as ForecastData,
  ForecastOverrides,
  PlannedPurchaseInput,
  SpendBand,
  SpendBandInput,
} from '../api.ts'
import {
  createSpendBands,
  fetchAccounts,
  fetchForecast,
  fetchMaxAffordable,
  fetchSpendBands,
} from '../api.ts'
import { bandProblem, overrideBands, scheduleChanged } from '../spendBands.ts'
import { todayIso } from '../ledger.ts'
import type { ChartColumn, SensitivityRowCopy, SpendStep } from '../forecast.ts'
import {
  bindingConstraintCopy,
  bridgeCopy,
  chartColumns,
  ethGrowthSliderBounds,
  formatMillions,
  purchaseAmountSliderBounds,
  purchaseCostRows,
  sensitivityRows,
  spendCopy,
  spendSliderBounds,
  spendSteps,
  STEP_CHART_HEIGHT,
  verdict,
  verdictDelta,
} from '../forecast.ts'
import { formatSignedUsd } from '../budgetReport.ts'
import { formatUsd } from '../ledger.ts'
import { hasWithdrawalBuckets } from '../sourcing.ts'

function BandRow({
  index,
  band,
  minYear,
  maxYear,
  onUpdate,
  onNote,
  onRemove,
}: {
  index: number
  band: SpendBandInput
  minYear: number
  maxYear: number
  onUpdate: (patch: Partial<SpendBandInput>) => void
  onNote: (note: string) => void
  onRemove: () => void
}) {
  const bounds = spendSliderBounds(band.annual_amount)
  const yearChange =
    (key: 'start_year' | 'end_year') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.value === '') {
        // Only the end year may be open-ended; a blank start is just
        // an in-progress edit.
        if (key === 'end_year') {
          onUpdate({ end_year: null })
        }
        return
      }
      const next = Number(event.target.value)
      if (Number.isInteger(next) && next >= minYear && next <= maxYear) {
        onUpdate({ [key]: next })
      }
    }
  return (
    <div className="mt-3 rounded-[8px] border border-hairline p-2.5">
      <div className="flex items-center gap-2">
        <input
          data-testid={`forecast-band-start-${index}`}
          type="number"
          min={minYear}
          max={maxYear}
          value={band.start_year}
          onChange={yearChange('start_year')}
          className="num w-[78px] rounded-[8px] border border-input-border px-[9px] py-1.5 text-[13px]"
        />
        <span className="text-xs text-muted-2">→</span>
        <input
          data-testid={`forecast-band-end-${index}`}
          type="number"
          min={minYear}
          max={maxYear}
          value={band.end_year ?? ''}
          placeholder="open"
          onChange={yearChange('end_year')}
          className="num w-[78px] rounded-[8px] border border-input-border px-[9px] py-1.5 text-[13px]"
        />
        <span className="num min-w-0 flex-1 text-right text-[13px] font-bold">
          {formatUsd(band.annual_amount)}
        </span>
        <button
          data-testid={`forecast-band-remove-${index}`}
          type="button"
          aria-label="Remove band"
          onClick={onRemove}
          className="px-1 text-[13px] text-muted-2"
        >
          ✕
        </button>
      </div>
      <input
        data-testid={`forecast-band-amount-${index}`}
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={band.annual_amount}
        onChange={(event) => onUpdate({ annual_amount: Number(event.target.value) })}
        className="mt-1.5 w-full accent-accent"
      />
      <input
        data-testid={`forecast-band-note-${index}`}
        type="text"
        value={band.note ?? ''}
        placeholder="Why this band? (saved with the plan)"
        onChange={(event) => onNote(event.target.value)}
        className="mt-1.5 w-full rounded-[8px] border border-input-border px-[9px] py-1.5 text-[12px]"
      />
    </div>
  )
}

function BarColumn({ column, year }: { column: ChartColumn; year: number }) {
  return (
    <div
      data-testid={`forecast-col-${column.age}`}
      className="group relative flex flex-1 flex-col items-center justify-end"
    >
      <div
        data-testid={`forecast-tip-${column.age}`}
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden w-max -translate-x-1/2 rounded-[8px] bg-ink px-3 py-2 text-[11px] leading-[1.7] text-white group-hover:block"
      >
        <p className="font-bold">
          Age {column.age} · {year}
        </p>
        {column.purchaseUsd != null && (
          <p className="num">Purchase {formatUsd(column.purchaseUsd)}</p>
        )}
        {column.shortUsd != null && (
          <p className="num text-[#ffb3a7]">
            Unaffordable — {formatUsd(column.shortUsd)} short
          </p>
        )}
        <p data-testid={`forecast-total-${column.age}`} className="num font-bold">
          Total {formatUsd(column.totalUsd)}
          {column.deltaUsd != null && ` (${formatSignedUsd(column.deltaUsd)})`}
        </p>
        <p className="num">ETH {formatUsd(column.ethUsd)}</p>
        <p className="num">Brokerage {formatUsd(column.brokerageUsd)}</p>
        <p className="num">401(k) {formatUsd(column.retirementUsd)}</p>
        {/* Social Security is an annual flow, not a balance the total
            can absorb — the rule says so before the /yr suffix does. */}
        <p
          data-testid={`forecast-ss-line-${column.age}`}
          className="num mt-1.5 border-t border-white/20 pt-1.5"
        >
          Soc. Sec. {formatUsd(column.ssUsd)}/yr
        </p>
      </div>
      {column.cap > 0 && (
        <div
          data-testid={`forecast-cap-${column.age}`}
          className="w-full"
          style={{
            height: `${column.cap}px`,
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(28,27,26,0.12) 0 3px, transparent 3px 6px)',
          }}
        />
      )}
      <div className="w-full bg-accent" style={{ height: `${column.eth}px` }} />
      <div className="w-full bg-sidebar" style={{ height: `${column.brokerage}px` }} />
      <div className="w-full bg-amber" style={{ height: `${column.retirement}px` }} />
      <div
        data-testid={`forecast-ss-${column.age}`}
        className="w-full bg-ss-blue"
        style={{ height: `${column.ss}px` }}
      />
    </div>
  )
}

interface StepDrag {
  bandIndex: number
  edge: 'start' | 'end' | null
  startX: number
  startY: number
  band0: SpendBandInput
  dollarsPerPx: number
  colWidth: number
  moved: boolean
}

function SpendStepChart({
  steps,
  startAge,
  bands,
  maxYear,
  onPreview,
  onCommit,
}: {
  steps: SpendStep[]
  startAge: number
  bands: SpendBandInput[]
  maxYear: number
  onPreview: (bands: SpendBandInput[]) => void
  onCommit: () => void
}) {
  const currentYear = new Date().getFullYear()
  const rowRef = useRef<HTMLDivElement>(null)
  const drag = useRef<StepDrag | null>(null)
  const maxLevel = Math.max(...steps.map((step) => step.level), 1)

  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value))

  const dragPatch = (
    session: StepDrag,
    clientX: number,
    clientY: number,
  ): Partial<SpendBandInput> | null => {
    if (session.edge === 'start' || session.edge === 'end') {
      if (session.colWidth <= 0) {
        return null
      }
      const years = Math.round((clientX - session.startX) / session.colWidth)
      if (session.edge === 'start') {
        const next = clamp(
          session.band0.start_year + years,
          currentYear,
          session.band0.end_year ?? maxYear,
        )
        return next === bands[session.bandIndex]?.start_year ? null : { start_year: next }
      }
      const end0 = session.band0.end_year ?? maxYear
      const next = clamp(end0 + years, session.band0.start_year, maxYear)
      return next === bands[session.bandIndex]?.end_year ? null : { end_year: next }
    }
    // A mid-band column: vertical drag owns the level, on the $1,000
    // grid, with the px-to-dollar mapping frozen at the drag's start
    // so the scale never warps mid-gesture.
    const dollars = (session.startY - clientY) * session.dollarsPerPx
    const next = Math.max(
      0,
      Math.round((session.band0.annual_amount + dollars) / 1_000) * 1_000,
    )
    return next === bands[session.bandIndex]?.annual_amount
      ? null
      : { annual_amount: next }
  }

  return (
    <div className="mt-4 border-t border-hairline-2 pt-3">
      <div className="flex justify-between text-[11.5px] text-[#5b6058]">
        <span className="font-bold">Spend per year</span>
        <span className="text-faint">
          today's $ · drag a band's step or edge
        </span>
      </div>
      <div
        ref={rowRef}
        data-testid="forecast-spend-steps"
        className="mt-1.5 flex h-[56px] touch-none items-end gap-[2px]"
      >
        {steps.map((step) => (
          <div
            key={step.age}
            data-testid={`forecast-step-${step.age}`}
            data-banded={step.banded}
            title={`Age ${step.age} · ${currentYear + step.age - startAge} · ${formatUsd(step.level)}/yr`}
            className={`flex-1 ${
              step.banded
                ? `bg-amber ${step.edge != null ? 'cursor-ew-resize' : 'cursor-ns-resize'}`
                : 'bg-[#d9d4c9]'
            }`}
            style={{ height: `${step.height}px` }}
            onPointerDown={(event) => {
              if (step.bandIndex == null) {
                return
              }
              event.currentTarget.setPointerCapture?.(event.pointerId)
              const width = rowRef.current?.getBoundingClientRect().width ?? 0
              drag.current = {
                bandIndex: step.bandIndex,
                edge: step.edge,
                startX: event.clientX,
                startY: event.clientY,
                band0: bands[step.bandIndex],
                dollarsPerPx: maxLevel / STEP_CHART_HEIGHT,
                colWidth: steps.length > 0 ? width / steps.length : 0,
                moved: false,
              }
            }}
            onPointerMove={(event) => {
              const session = drag.current
              if (session == null) {
                return
              }
              const patch = dragPatch(session, event.clientX, event.clientY)
              if (patch == null) {
                return
              }
              session.moved = true
              onPreview(
                bands.map((band, index) =>
                  index === session.bandIndex
                    ? { ...session.band0, ...patch }
                    : band,
                ),
              )
            }}
            onPointerUp={() => {
              const session = drag.current
              drag.current = null
              if (session?.moved) {
                onCommit()
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span>
      <span className={`inline-block h-[11px] w-[11px] rounded-[2px] align-[-1px] ${color}`} />{' '}
      {label}
    </span>
  )
}

const ROW_TONE = {
  ok: 'text-accent',
  tight: 'text-amber-text',
  bad: 'text-red-text',
}

function SensitivityRow({ row }: { row: SensitivityRowCopy }) {
  return (
    <div
      data-testid="forecast-sense-row"
      data-current={row.current}
      className={`flex items-center gap-3.5 border-b border-hairline-2 px-5 py-[13px] ${
        row.current ? 'bg-[#f3f6f3]' : ''
      }`}
    >
      <div className="num w-[90px] font-bold">{row.spend}</div>
      <div className="num flex-1 text-[#5b6058]">{row.lasts}</div>
      <p className={`text-[12.5px] font-semibold ${ROW_TONE[row.tone]}`}>{row.outcome}</p>
    </div>
  )
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  testId,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  testId: string
  onChange: (value: number) => void
}) {
  return (
    <>
      <div className="mt-3.5 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="num font-bold text-ink">{display}</span>
      </div>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-accent"
      />
    </>
  )
}

function SsField({
  label,
  value,
  testId,
  onChange,
}: {
  label: string
  value: number
  testId: string
  onChange: (value: number) => void
}) {
  return (
    <label>
      <span className="text-[10px] font-semibold text-muted-2 uppercase">{label}</span>
      <input
        data-testid={testId}
        type="number"
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (event.target.value !== '' && Number.isFinite(next) && next >= 0) {
            onChange(next)
          }
        }}
        className="num mt-[3px] w-full rounded-[8px] border border-input-border px-[9px] py-2 text-[13px]"
      />
    </label>
  )
}

function PurchaseRow({
  index,
  purchase,
  minYear,
  maxYear,
  constraint,
  onUpdate,
  onRename,
  onRemove,
  onMax,
}: {
  index: number
  purchase: PlannedPurchaseInput
  minYear: number
  maxYear: number
  constraint: BindingConstraint | undefined
  onUpdate: (patch: Partial<PlannedPurchaseInput>) => void
  onRename: (name: string) => void
  onRemove: () => void
  onMax: () => void
}) {
  const bounds = purchaseAmountSliderBounds(purchase.amount)
  return (
    <div className="mt-3 rounded-[8px] border border-hairline p-2.5">
      <div className="flex items-center gap-2">
        <input
          data-testid={`forecast-purchase-name-${index}`}
          type="text"
          value={purchase.name}
          onChange={(event) => onRename(event.target.value)}
          className="min-w-0 flex-1 rounded-[8px] border border-input-border px-[9px] py-1.5 text-[13px]"
        />
        <input
          data-testid={`forecast-purchase-year-${index}`}
          type="number"
          min={minYear}
          max={maxYear}
          value={purchase.year}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (
              event.target.value !== '' &&
              Number.isInteger(next) &&
              next >= minYear &&
              next <= maxYear
            ) {
              onUpdate({ year: next })
            }
          }}
          className="num w-[78px] rounded-[8px] border border-input-border px-[9px] py-1.5 text-[13px]"
        />
        <button
          data-testid={`forecast-purchase-remove-${index}`}
          type="button"
          aria-label="Remove purchase"
          onClick={onRemove}
          className="px-1 text-[13px] text-muted-2"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>Amount</span>
        <span className="num font-bold text-ink">{formatUsd(purchase.amount)}</span>
      </div>
      <input
        data-testid={`forecast-purchase-amount-${index}`}
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={purchase.amount}
        onChange={(event) => onUpdate({ amount: Number(event.target.value) })}
        className="mt-1 w-full accent-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <button
          data-testid={`forecast-purchase-max-${index}`}
          type="button"
          onClick={onMax}
          className="rounded-[8px] border border-input-border px-2 py-1 text-[11.5px] font-semibold"
        >
          Max affordable
        </button>
        {constraint != null && (
          <p
            data-testid={`forecast-purchase-constraint-${index}`}
            className="flex-1 text-right text-[10.5px] leading-[1.4] text-muted-2"
          >
            {bindingConstraintCopy(constraint)}
          </p>
        )}
      </div>
    </div>
  )
}

function Forecast() {
  const [forecast, setForecast] = useState<ForecastData | null>()
  const [accounts, setAccounts] = useState<Account[]>()
  const [savedBands, setSavedBands] = useState<SpendBand[]>()
  const [overrides, setOverrides] = useState<ForecastOverrides>({})
  // The solver's answer per row index — cleared the moment the row
  // moves, since the ceiling was solved for the old inputs.
  const [constraints, setConstraints] = useState<Record<number, BindingConstraint>>({})

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchSpendBands().then((saved) => {
      setSavedBands(saved)
      if (saved.length > 0) {
        // Seed the transient rows from the plan. The initial forecast
        // below already reflects the saved schedule server-side, so
        // no second fetch is needed.
        setOverrides((current) => ({ ...current, bands: overrideBands(saved) }))
      }
    })
    void fetchForecast().then(setForecast)
  }, [])

  const applyOverride = (patch: ForecastOverrides) => {
    const next = { ...overrides, ...patch }
    setOverrides(next)
    // An overlapping band draft would 422 server-side: hold every
    // refetch until the shared check clears — the inline warning
    // says what to fix.
    if (bandProblem(next.bands ?? []) == null) {
      void fetchForecast(next).then(setForecast)
    }
  }

  const purchases = overrides.purchases ?? []

  const addPurchase = () => {
    applyOverride({
      purchases: [
        ...purchases,
        { name: 'New purchase', year: new Date().getFullYear() + 1, amount: 50_000 },
      ],
    })
  }

  const updatePurchase = (index: number, patch: Partial<PlannedPurchaseInput>) => {
    setConstraints(({ [index]: _stale, ...rest }) => rest)
    applyOverride({
      purchases: purchases.map((purchase, i) =>
        i === index ? { ...purchase, ...patch } : purchase,
      ),
    })
  }

  const removePurchase = (index: number) => {
    // Indices shift under the remaining rows, so no solved ceiling
    // survives a removal.
    setConstraints({})
    applyOverride({ purchases: purchases.filter((_, i) => i !== index) })
  }

  const fillMaxAffordable = (index: number) => {
    const others = purchases.filter((_, i) => i !== index)
    void fetchMaxAffordable(purchases[index].year, {
      ...overrides,
      purchases: others,
    }).then((result) => {
      if (result == null) {
        return
      }
      updatePurchase(index, { amount: result.max_amount })
      setConstraints((current) => ({
        ...current,
        [index]: result.binding_constraint,
      }))
    })
  }

  const renamePurchase = (index: number, name: string) => {
    // The name never travels: update the row without a refetch.
    setOverrides({
      ...overrides,
      purchases: purchases.map((purchase, i) =>
        i === index ? { ...purchase, name } : purchase,
      ),
    })
  }

  const bands = overrides.bands ?? []
  const problem = bandProblem(bands)
  const bandsChanged = savedBands != null && scheduleChanged(bands, savedBands)

  const addBand = () => {
    const start = new Date().getFullYear() + 1
    applyOverride({
      bands: [
        ...bands,
        {
          start_year: start,
          end_year: start + 9,
          annual_amount: overrides.spend ?? forecast?.spend ?? 0,
          note: null,
        },
      ],
    })
  }

  const updateBand = (index: number, patch: Partial<SpendBandInput>) => {
    applyOverride({
      bands: bands.map((band, i) => (i === index ? { ...band, ...patch } : band)),
    })
  }

  const removeBand = (index: number) => {
    applyOverride({ bands: bands.filter((_, i) => i !== index) })
  }

  const noteBand = (index: number, note: string) => {
    // The note never travels in band= params — like a purchase's
    // name — but Save to plan persists it.
    setOverrides({
      ...overrides,
      bands: bands.map((band, i) =>
        i === index ? { ...band, note: note || null } : band,
      ),
    })
  }

  const saveBands = async () => {
    await createSpendBands({ effective_date: todayIso(), bands })
    setSavedBands(await fetchSpendBands())
  }

  const resetBands = () => {
    if (savedBands != null) {
      applyOverride({ bands: overrideBands(savedBands) })
    }
  }

  if (forecast === undefined || accounts === undefined || savedBands === undefined) {
    return <div data-testid="view-forecast" className="max-w-[1000px]" />
  }

  if (forecast === null) {
    return (
      <div data-testid="view-forecast" className="max-w-[1000px]">
        <div
          data-testid="forecast-empty"
          className="rounded-card border border-card-border bg-card p-[26px] text-[13.5px] text-muted"
        >
          {hasWithdrawalBuckets(accounts) ? (
            <>
              The longevity forecast needs the year's tax parameters, return
              and inflation assumptions, a spend target, and at least one
              balance to simulate. Add the config under Settings &amp; data,
              then enter balances in Ledger entries.
            </>
          ) : (
            <>
              No accounts have a withdrawal priority yet, so there are no
              buckets to simulate. Use Edit on each investment account under
              Settings &amp; data to set its kind, investable flag, and
              withdrawal priority.
            </>
          )}
        </div>
      </div>
    )
  }

  const outcome = verdict(forecast.run_out_age)
  const delta = verdictDelta(forecast)
  const bridge = bridgeCopy(forecast.series, forecast.start_age)
  const columns = chartColumns(forecast.series, {
    baseline: forecast.baseline.series,
    purchases: forecast.purchases,
    unaffordable: forecast.unaffordable,
  })
  const bounds = spendSliderBounds(forecast.spend)
  // With a Jan-1 birthdate, age start_age is reached in the current
  // calendar year, so each later age lands (age − start_age) years out.
  const currentYear = new Date().getFullYear()
  const spend = overrides.spend ?? forecast.spend
  const returnPct = overrides.return_pct ?? forecast.return_pct
  const inflationPct = overrides.inflation_pct ?? forecast.inflation_pct
  // A null echo means ETH grows at the blended rate — the slider
  // tracks the return until a what-if or stored rate takes over.
  const ethGrowthPct =
    overrides.eth_growth_pct ?? forecast.eth_growth_pct ?? returnPct
  const ethBounds = ethGrowthSliderBounds(ethGrowthPct)
  const ssYou = overrides.ss_you ?? forecast.ss_you
  const ssSpouse = overrides.ss_spouse ?? forecast.ss_spouse
  const ssStart = overrides.ss_start ?? forecast.ss_start
  const ssAnnual = (ssYou + ssSpouse) * 12

  return (
    <div data-testid="view-forecast" className="max-w-[1000px]">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div
          data-testid="forecast-verdict"
          className={`rounded-card border p-6 ${
            outcome.ok ? 'border-accent bg-green-soft' : 'border-red bg-red-soft'
          }`}
        >
          <p className="text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
            {spendCopy(forecast.spend, forecast.bands)}
          </p>
          <p
            className={`mt-1 text-[34px] leading-[1.05] font-extrabold ${
              outcome.ok ? 'text-accent' : 'text-red'
            }`}
          >
            {outcome.headline}
          </p>
          <p className="num mt-2 text-[13.5px] text-[#3a473f]">
            Projected <b>{formatMillions(forecast.balance_at_100)}</b> at age 100{' '}
            <span className="text-muted-2">(today's dollars)</span>
          </p>
          {delta != null && (
            <p
              data-testid="forecast-verdict-delta"
              className="num mt-1 text-[12.5px] text-[#5b6058]"
            >
              {delta}
            </p>
          )}
        </div>
        <div
          data-testid="forecast-bridge"
          className="flex flex-col justify-center rounded-card border border-card-border bg-card p-6"
        >
          <p className="text-[11px] font-semibold text-muted-2">BRIDGE TO 401(k) @ 59½</p>
          <p className="mt-[7px] text-[13.5px]">
            Need to cover <b>{59.5 - forecast.start_age} yrs</b>
          </p>
          <p className={`text-[13.5px] ${bridge.ok ? 'text-accent' : 'text-red'}`}>
            Taxable buckets last <b>{bridge.years}</b> {bridge.ok ? '✓' : '⚠'}
          </p>
        </div>
      </div>

      <div
        data-testid="forecast-chart"
        className="mt-5 rounded-card border border-card-border bg-card p-6"
      >
        <p className="mb-[26px] text-sm font-bold">
          Balance by bucket · age {forecast.start_age} → 100
        </p>
        <div className="relative flex h-[200px] items-end gap-[2px] border-b border-[#d9d4c9]">
          {columns.map((column) => (
            <BarColumn
              key={column.age}
              column={column}
              year={currentYear + column.age - forecast.start_age}
            />
          ))}
        </div>
        <div className="mt-1.5 flex gap-[2px]">
          {columns.map((column) => (
            <div
              key={column.age}
              className="flex-1 overflow-visible text-center text-[10px] text-muted-2"
            >
              {column.marker ? (
                <span
                  data-testid={`forecast-mark-${column.age}`}
                  className={column.shortUsd != null ? 'text-red-text' : 'text-ink'}
                >
                  {column.marker}
                </span>
              ) : (
                column.label
              )}
            </div>
          ))}
        </div>
        <SpendStepChart
          steps={spendSteps(forecast.start_age, bands, spend, currentYear)}
          startAge={forecast.start_age}
          bands={bands}
          maxYear={currentYear + 100 - forecast.start_age}
          onPreview={(next) => setOverrides({ ...overrides, bands: next })}
          onCommit={() => applyOverride({})}
        />
        <div className="mt-3.5 flex gap-[18px] text-[11.5px] text-[#5b6058]">
          <LegendSwatch color="bg-accent" label="ETH (first)" />
          <LegendSwatch color="bg-sidebar" label="Taxable brokerage" />
          <LegendSwatch color="bg-amber" label="401(k) · locked to 59½" />
          <LegendSwatch
            color="bg-ss-blue"
            label={`Soc. Security · spent first from ${ssStart}`}
          />
        </div>
        <p className="mt-1.5 text-[10.5px] text-faint">
          Social Security is income, not a balance — its sliver is enlarged to stay
          visible.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div
          data-testid="forecast-sensitivity"
          className="overflow-hidden rounded-card border border-card-border bg-card"
        >
          <p className="border-b border-hairline px-5 py-4 text-sm font-bold">
            How much could we spend?
          </p>
          {sensitivityRows(forecast.sensitivity, forecast.spend).map((row) => (
            <SensitivityRow key={row.spend} row={row} />
          ))}
          {forecast.purchase_costs.length > 0 && (
            <div data-testid="forecast-purchase-costs">
              <p className="border-y border-hairline bg-[#faf9f6] px-5 py-4 text-sm font-bold">
                What do the purchases cost?
              </p>
              {purchaseCostRows(forecast.purchase_costs, purchases).map((row) => (
                <div
                  data-testid="forecast-cost-row"
                  key={`${row.year}-${row.name}`}
                  className="flex items-center gap-3.5 border-b border-hairline-2 px-5 py-[13px]"
                >
                  <div className="w-[150px]">
                    <p className="text-[12.5px] font-bold">{row.name}</p>
                    <p className="num text-[11px] text-muted-2">
                      {row.year} · {row.amount}
                    </p>
                  </div>
                  <div className="num flex-1 text-[12.5px] text-[#5b6058]">
                    without it: {row.lasts}
                  </div>
                  <p className={`text-[12.5px] font-semibold ${ROW_TONE[row.tone]}`}>
                    {row.outcome}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-card border border-card-border bg-card p-[22px]">
          <p className="text-[13px] font-bold">Assumptions</p>
          <SliderRow
            label={forecast.bands.length > 0 ? 'Baseline spend / yr' : 'Spend / yr'}
            value={spend}
            display={formatUsd(spend)}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            testId="forecast-spend"
            onChange={(value) => applyOverride({ spend: value })}
          />
          <SliderRow
            label="Return"
            value={returnPct}
            display={`${returnPct.toFixed(1)}%`}
            min={3}
            max={11}
            step={0.5}
            testId="forecast-return"
            onChange={(value) => applyOverride({ return_pct: value })}
          />
          <SliderRow
            label="ETH growth"
            value={ethGrowthPct}
            display={`${ethGrowthPct.toFixed(1)}%`}
            min={ethBounds.min}
            max={ethBounds.max}
            step={ethBounds.step}
            testId="forecast-eth"
            onChange={(value) => applyOverride({ eth_growth_pct: value })}
          />
          <SliderRow
            label="Inflation"
            value={inflationPct}
            display={`${inflationPct.toFixed(1)}%`}
            min={1}
            max={6}
            step={0.5}
            testId="forecast-inflation"
            onChange={(value) => applyOverride({ inflation_pct: value })}
          />
          <div className="mt-4 border-t border-hairline pt-3.5">
            <div className="flex justify-between text-xs text-muted">
              <span>
                Social Security <span className="text-faint">· today's $</span>
              </span>
              <span className="num font-bold text-accent">{formatUsd(ssAnnual)}/yr</span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <SsField
                label="You $/mo"
                value={ssYou}
                testId="forecast-ss-you"
                onChange={(value) => applyOverride({ ss_you: value })}
              />
              <SsField
                label="Spouse $/mo"
                value={ssSpouse}
                testId="forecast-ss-spouse"
                onChange={(value) => applyOverride({ ss_spouse: value })}
              />
              <SsField
                label="From age"
                value={ssStart}
                testId="forecast-ss-start"
                onChange={(value) => applyOverride({ ss_start: value })}
              />
            </div>
          </div>
          <div data-testid="forecast-purchases" className="mt-4 border-t border-hairline pt-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                Planned purchases <span className="text-faint">· what-if only</span>
              </span>
              <button
                data-testid="forecast-purchase-add"
                type="button"
                onClick={addPurchase}
                className="rounded-[8px] border border-input-border px-2 py-1 text-[12px] font-semibold"
              >
                + Add
              </button>
            </div>
            {purchases.map((purchase, index) => (
              <PurchaseRow
                // Rows have no identity beyond their position in the
                // transient what-if list.
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                index={index}
                purchase={purchase}
                minYear={new Date().getFullYear()}
                maxYear={new Date().getFullYear() + 100 - forecast.start_age}
                constraint={constraints[index]}
                onUpdate={(patch) => updatePurchase(index, patch)}
                onRename={(name) => renamePurchase(index, name)}
                onRemove={() => removePurchase(index)}
                onMax={() => fillMaxAffordable(index)}
              />
            ))}
          </div>
          <div data-testid="forecast-bands" className="mt-4 border-t border-hairline pt-3.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                Spend bands <span className="text-faint">· today's $</span>
              </span>
              <button
                data-testid="forecast-band-add"
                type="button"
                onClick={addBand}
                className="rounded-[8px] border border-input-border px-2 py-1 text-[12px] font-semibold"
              >
                + Add
              </button>
            </div>
            {bands.map((band, index) => (
              <BandRow
                // Rows have no identity beyond their position, like
                // purchase rows.
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                index={index}
                band={band}
                minYear={new Date().getFullYear()}
                maxYear={new Date().getFullYear() + 100 - forecast.start_age}
                onUpdate={(patch) => updateBand(index, patch)}
                onNote={(note) => noteBand(index, note)}
                onRemove={() => removeBand(index)}
              />
            ))}
            {problem != null && (
              <p
                data-testid="forecast-band-problem"
                className="mt-2 text-[11.5px] font-semibold text-red-text"
              >
                {problem}
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                data-testid="forecast-band-save"
                type="button"
                onClick={() => void saveBands()}
                disabled={problem != null || !bandsChanged}
                className="rounded-[8px] border border-input-border px-2 py-1 text-[11.5px] font-semibold disabled:opacity-40"
              >
                Save to plan
              </button>
              <button
                data-testid="forecast-band-reset"
                type="button"
                onClick={resetBands}
                disabled={!bandsChanged}
                className="rounded-[8px] border border-input-border px-2 py-1 text-[11.5px] font-semibold disabled:opacity-40"
              >
                Reset to plan
              </button>
            </div>
          </div>
          <p className="mt-3.5 text-[11px] text-muted-2">
            Real return {(returnPct - inflationPct).toFixed(1)}% · ETH spent first · SS{' '}
            {formatUsd(ssAnnual)}/yr cuts the portfolio draw from age {ssStart}.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Forecast
