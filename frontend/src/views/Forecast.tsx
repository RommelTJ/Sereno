import { useEffect, useState } from 'react'
import type { Forecast as ForecastData, ForecastOverrides } from '../api.ts'
import { fetchForecast } from '../api.ts'
import type { ChartColumn, SensitivityRowCopy } from '../forecast.ts'
import {
  bridgeCopy,
  chartColumns,
  formatMillions,
  sensitivityRows,
  spendSliderBounds,
  verdict,
} from '../forecast.ts'
import { formatUsd } from '../ledger.ts'

function BarColumn({ column }: { column: ChartColumn }) {
  return (
    <div
      data-testid={`forecast-col-${column.age}`}
      className="flex flex-1 flex-col items-center justify-end"
    >
      <div className="w-[72%] bg-accent" style={{ height: `${column.eth}px` }} />
      <div className="w-[72%] bg-sidebar" style={{ height: `${column.brokerage}px` }} />
      <div className="w-[72%] bg-amber" style={{ height: `${column.retirement}px` }} />
      <div
        data-testid={`forecast-ss-${column.age}`}
        className="w-[72%] bg-ss-blue"
        style={{ height: `${column.ss}px` }}
      />
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

function Forecast() {
  const [forecast, setForecast] = useState<ForecastData | null>()
  const [overrides, setOverrides] = useState<ForecastOverrides>({})

  useEffect(() => {
    void fetchForecast().then(setForecast)
  }, [])

  const applyOverride = (patch: ForecastOverrides) => {
    const next = { ...overrides, ...patch }
    setOverrides(next)
    void fetchForecast(next).then(setForecast)
  }

  if (forecast === undefined) {
    return <div data-testid="view-forecast" className="max-w-[1000px]" />
  }

  if (forecast === null) {
    return (
      <div data-testid="view-forecast" className="max-w-[1000px]">
        <div
          data-testid="forecast-empty"
          className="rounded-card border border-card-border bg-card p-[26px] text-[13.5px] text-muted"
        >
          The longevity forecast needs the year's tax parameters, return and
          inflation assumptions, a spend target, and at least one balance to
          simulate. Add the config under Settings &amp; data, then enter
          balances in Ledger entries.
        </div>
      </div>
    )
  }

  const outcome = verdict(forecast.run_out_age)
  const bridge = bridgeCopy(forecast.series)
  const bounds = spendSliderBounds(forecast.spend)
  const spend = overrides.spend ?? forecast.spend
  const returnPct = overrides.return_pct ?? forecast.return_pct
  const inflationPct = overrides.inflation_pct ?? forecast.inflation_pct
  const ssYou = overrides.ss_you ?? forecast.ss_you
  const ssSpouse = overrides.ss_spouse ?? forecast.ss_spouse
  const ssStart = overrides.ss_start ?? forecast.ss_start
  const ssAnnual = (ssYou + ssSpouse) * 12

  return (
    <div data-testid="view-forecast" className="max-w-[1000px]">
      <div className="grid grid-cols-[1.4fr_1fr] gap-5">
        <div
          data-testid="forecast-verdict"
          className={`rounded-card border p-6 ${
            outcome.ok ? 'border-accent bg-green-soft' : 'border-red bg-red-soft'
          }`}
        >
          <p className="text-[11px] font-semibold tracking-[1.2px] text-muted-2 uppercase">
            At {formatUsd(forecast.spend)} / year
          </p>
          <p
            className={`mt-1 text-[34px] leading-[1.05] font-extrabold ${
              outcome.ok ? 'text-accent' : 'text-red'
            }`}
          >
            {outcome.headline}
          </p>
          <p className="num mt-2 text-[13.5px] text-[#3a473f]">
            Projected <b>{formatMillions(forecast.balance_at_90)}</b> at age 90{' '}
            <span className="text-muted-2">(today's dollars)</span>
          </p>
        </div>
        <div
          data-testid="forecast-bridge"
          className="flex flex-col justify-center rounded-card border border-card-border bg-card p-6"
        >
          <p className="text-[11px] font-semibold text-muted-2">BRIDGE TO 401(k) @ 59½</p>
          <p className="mt-[7px] text-[13.5px]">
            Need to cover <b>21.5 yrs</b>
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
        <p className="mb-[26px] text-sm font-bold">Balance by bucket · age 38 → 95</p>
        <div className="relative flex h-[200px] items-end gap-2 border-b border-[#d9d4c9]">
          {chartColumns(forecast.series).map((column) => (
            <BarColumn key={column.age} column={column} />
          ))}
        </div>
        <div className="mt-1.5 flex gap-2">
          {chartColumns(forecast.series).map((column) => (
            <div key={column.age} className="flex-1 text-center text-[10px] text-muted-2">
              {column.age}
            </div>
          ))}
        </div>
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

      <div className="mt-5 grid grid-cols-[1.3fr_1fr] items-start gap-5">
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
        </div>
        <div className="rounded-card border border-card-border bg-card p-[22px]">
          <p className="text-[13px] font-bold">Assumptions</p>
          <SliderRow
            label="Spend / yr"
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
            <div className="mt-2 grid grid-cols-3 gap-2">
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
