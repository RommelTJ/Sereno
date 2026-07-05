import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { todayIso } from '../ledger.ts'
import {
  ACCOUNTS,
  ASSUMPTION,
  FUNDS,
  LEDGER,
  SOCIAL_SECURITY,
  SPEND_PLAN,
  TAX_PARAMS,
} from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Settings from './Settings.tsx'

const routes = () => ({
  '/api/accounts': ACCOUNTS,
  '/api/ledger': LEDGER,
  '/api/funds': FUNDS,
  '/api/assumptions': ASSUMPTION,
  '/api/spend-plan': SPEND_PLAN,
  '/api/social-security': SOCIAL_SECURITY,
  '/api/tax-params': TAX_PARAMS,
})

beforeEach(() => {
  stubApi(routes())
})

describe('Accounts & buckets card', () => {
  it('lists each account with its latest ledger balance', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-account-row')
    expect(rows).toHaveLength(10)
    expect(within(rows[0]).getByText('Ethereum')).toBeInTheDocument()
    expect(within(rows[0]).getByText('· eth')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$70,000')).toBeInTheDocument()
    expect(within(rows[4]).getByText('Retirement')).toBeInTheDocument()
    expect(within(rows[4]).getByText('$350,000')).toBeInTheDocument()
  })

  it('shows a liability as a negative red figure', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-account-row')
    const amount = within(rows[9]).getByText('-$150,000')
    expect(amount).toHaveClass('text-red')
  })

  it('falls back to an older month when the latest lacks an entry', async () => {
    const ledger = [
      {
        ...LEDGER[0],
        balances: LEDGER[0].balances.filter((b) => b.account_id !== 9),
      },
      LEDGER[1],
    ]
    stubApi({ ...routes(), '/api/ledger': ledger })
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-account-row')
    expect(within(rows[8]).getByText('Car')).toBeInTheDocument()
    expect(within(rows[8]).getByText('$15,000')).toBeInTheDocument()
  })

  it('lists each fund with its balance', async () => {
    render(<Settings />)

    const rows = await screen.findAllByTestId('settings-fund-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Emergency fund')).toBeInTheDocument()
    expect(within(rows[0]).getByText('· fund · sinking')).toBeInTheDocument()
    expect(within(rows[0]).getByText('$10,000')).toBeInTheDocument()
  })
})

describe('Assumptions card', () => {
  it('shows return, inflation, ETH growth and planned spend', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getByText('Return')).toBeInTheDocument()
    expect(within(card).getByText('7.0%')).toBeInTheDocument()
    expect(within(card).getByText('Inflation')).toBeInTheDocument()
    expect(within(card).getByText('3.0%')).toBeInTheDocument()
    expect(within(card).getByText('ETH growth')).toBeInTheDocument()
    expect(
      within(card).getByText('· refined from tracking'),
    ).toBeInTheDocument()
    expect(within(card).getByText('Planned spend')).toBeInTheDocument()
    expect(within(card).getByText('$45,000 / yr')).toBeInTheDocument()
  })

  it('shows placeholders when no config rows exist yet', async () => {
    stubApi({ ...routes(), '/api/assumptions': null, '/api/spend-plan': null })
    render(<Settings />)

    const card = await screen.findByTestId('assumptions-card')
    expect(within(card).getAllByText('—')).toHaveLength(4)
  })
})

describe('Social Security card', () => {
  it('shows each person with start age and monthly amount', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('social-security-card')
    expect(within(card).getByText('· editable, dated')).toBeInTheDocument()
    expect(within(card).getByText('You — from 67')).toBeInTheDocument()
    expect(within(card).getByText('$1,500/mo')).toBeInTheDocument()
    expect(within(card).getByText('Spouse — from 67')).toBeInTheDocument()
    expect(within(card).getByText('$1,400/mo')).toBeInTheDocument()
  })

  it('says so when no estimates exist yet', async () => {
    stubApi({ ...routes(), '/api/social-security': [] })
    render(<Settings />)

    const card = await screen.findByTestId('social-security-card')
    expect(within(card).getByText('no estimates yet')).toBeInTheDocument()
  })
})

describe('Tax parameters card', () => {
  it('shows the latest year with its ceilings, NIIT and deduction', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('2026 · MFJ')).toBeInTheDocument()
    expect(within(card).getByText('0% LTCG up to')).toBeInTheDocument()
    expect(within(card).getByText('$96,700')).toBeInTheDocument()
    expect(within(card).getByText('15% → 20% at')).toBeInTheDocument()
    expect(within(card).getByText('$600,050')).toBeInTheDocument()
    expect(within(card).getByText('NIIT')).toBeInTheDocument()
    expect(within(card).getByText('3.8% over $250,000')).toBeInTheDocument()
    expect(within(card).getByText('Std deduction')).toBeInTheDocument()
    expect(within(card).getByText('$30,000')).toBeInTheDocument()
  })

  it('lists the ordinary brackets', async () => {
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('10% to $24,800')).toBeInTheDocument()
    expect(within(card).getByText('12% to $100,800')).toBeInTheDocument()
    expect(within(card).getByText('22% to $211,400')).toBeInTheDocument()
    expect(within(card).getByText('24% and up')).toBeInTheDocument()
  })

  it('says so when no tax years are loaded yet', async () => {
    stubApi({ ...routes(), '/api/tax-params': [] })
    render(<Settings />)

    const card = await screen.findByTestId('tax-card')
    expect(within(card).getByText('no tax years loaded yet')).toBeInTheDocument()
  })
})

describe('Data model note', () => {
  it('explains append-only and points at schema.sql', async () => {
    render(<Settings />)

    const note = await screen.findByTestId('data-note')
    expect(
      within(note).getByText('Data model · append-only'),
    ).toBeInTheDocument()
    expect(within(note).getByText(/Never UPDATE a balance/)).toBeInTheDocument()
    expect(within(note).getByText('schema.sql')).toBeInTheDocument()
  })
})

const postCalls = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => input === path && init?.method === 'POST',
  )

describe('Editing appends new config rows', () => {
  it('saves edited assumptions as a new row effective today', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/assumptions': { ...ASSUMPTION, id: 2 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Return %'), {
      target: { value: '6.5' },
    })
    fireEvent.change(within(card).getByLabelText('Inflation %'), {
      target: { value: '2.8' },
    })
    r['/api/assumptions'] = {
      ...ASSUMPTION,
      id: 2,
      return_pct: 6.5,
      inflation_pct: 2.8,
    }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('6.5%')).toBeInTheDocument()
    expect(within(card).getByText('2.8%')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/assumptions')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      return_pct: 6.5,
      inflation_pct: 2.8,
    })
    expect(postCalls(fetchMock, '/api/spend-plan')).toHaveLength(0)
  })

  it('saves an edited planned spend carrying the guardrail knobs forward', async () => {
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/spend-plan': { ...SPEND_PLAN, id: 2, annual_target: 48_000 },
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('assumptions-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('Spend $ / yr'), {
      target: { value: '48,000' },
    })
    r['/api/spend-plan'] = { ...SPEND_PLAN, id: 2, annual_target: 48_000 }

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$48,000 / yr')).toBeInTheDocument()
    const body = JSON.parse(
      postCalls(fetchMock, '/api/spend-plan')[0][1]?.body as string,
    )
    expect(body).toEqual({
      effective_date: todayIso(),
      annual_target: 48_000,
      initial_rate: 0.0294,
      guardrail_band: 0.2,
    })
    expect(postCalls(fetchMock, '/api/assumptions')).toHaveLength(0)
  })

  it('saves an edited Social Security amount for that person only', async () => {
    const you = { ...SOCIAL_SECURITY[0], id: 3, monthly_amount: 1_550 }
    const r: Record<string, unknown> = {
      ...routes(),
      'POST /api/social-security': you,
    }
    const fetchMock = stubApi(r)
    render(<Settings />)
    const card = await screen.findByTestId('social-security-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(card).getByLabelText('You $ / mo'), {
      target: { value: '1,550' },
    })
    r['/api/social-security'] = [you, SOCIAL_SECURITY[1]]

    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('$1,550/mo')).toBeInTheDocument()
    const calls = postCalls(fetchMock, '/api/social-security')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual({
      person: 'you',
      effective_date: todayIso(),
      start_age: 67,
      monthly_amount: 1_550,
    })
  })
})
