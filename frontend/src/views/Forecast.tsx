import { useEffect, useState } from 'react'
import type {
  Account,
  BindingConstraint,
  Forecast as ForecastData,
  ForecastOverrides,
  PlannedPurchaseInput,
} from '../api.ts'
import { fetchAccounts, fetchForecast, fetchMaxAffordable } from '../api.ts'
import type { ChartColumn, SensitivityRowCopy } from '../forecast.ts'
import {
  bindingConstraintCopy,
  bridgeCopy,
  chartColumns,
  ethGrowthSliderBounds,
  formatMillions,
  purchaseAmountSliderBounds,
  purchaseCostRows,
  sensitivityRows,
  spendSliderBounds,
  verdict,
  verdictDelta,
} from '../forecast.ts'
import { formatUsd } from '../ledger.ts'
import { hasWithdrawalBuckets } from '../sourcing.ts'

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
        <p className="num">ETH {formatUsd(column.ethUsd)}</p>
        <p className="num">Brokerage {formatUsd(column.brokerageUsd)}</p>
        <p className="num">401(k) {formatUsd(column.retirementUsd)}</p>
        <p className="num">Soc. Sec. {formatUsd(column.ssUsd)}/yr</p>
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
  const [overrides, setOverrides] = useState<ForecastOverrides>({})
  // The solver's answer per row index — cleared the moment the row
  // moves, since the ceiling was solved for the old inputs.
  const [constraints, setConstraints] = useState<Record<number, BindingConstraint>>({})

  useEffect(() => {
    void fetchAccounts().then(setAccounts)
    void fetchForecast().then(setForecast)
  }, [])

  const applyOverride = (patch: ForecastOverrides) => {
    const next = { ...overrides, ...patch }
    setOverrides(next)
    void fetchForecast(next).then(setForecast)
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

  if (forecast === undefined || accounts === undefined) {
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
