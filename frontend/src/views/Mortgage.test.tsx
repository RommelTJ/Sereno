import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { MORTGAGE } from '../test/fixtures.ts'
import { stubApi } from '../test/stubs.ts'
import Mortgage from './Mortgage.tsx'

function renderView() {
  return render(
    <MemoryRouter>
      <Mortgage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  stubApi({ '/api/mortgage': MORTGAGE })
})

describe('summary card', () => {
  it('leads with the balance the payoff was solved from', async () => {
    renderView()

    expect(await screen.findByTestId('mortgage-balance')).toHaveTextContent(
      '$150,000.00',
    )
  })

  it('reads the rate and the payment it splits into', async () => {
    renderView()

    expect(await screen.findByTestId('mortgage-terms')).toHaveTextContent(
      '3.00% · $1,075.00 P&I + $200.00 extra',
    )
  })

  it('names the payoff month, the age then, and the term left', async () => {
    renderView()

    const payoff = await screen.findByTestId('mortgage-payoff')
    expect(payoff).toHaveTextContent('February 2038 (age 50)')
    expect(payoff).toHaveTextContent('11 yr 8 mo remaining')
  })

  it('prices what the extra principal buys', async () => {
    renderView()

    expect(await screen.findByTestId('mortgage-savings')).toHaveTextContent(
      'Extra principal saves 32 months and $6,840.04 of interest',
    )
  })

  it('sets the payment today against its real value at payoff', async () => {
    renderView()

    expect(await screen.findByTestId('mortgage-payment')).toHaveTextContent(
      '$1,275.00/mo today · $903.11/mo real at payoff',
    )
  })

  it('says the escrow outlives the payoff', async () => {
    renderView()

    expect(await screen.findByTestId('mortgage-escrow')).toHaveTextContent(
      'Escrow ($450.00/mo) continues after payoff',
    )
  })

  it('drops the savings line when no extra principal is paid', async () => {
    stubApi({
      '/api/mortgage': {
        ...MORTGAGE,
        monthly_extra: 0,
        derived: { ...MORTGAGE.derived, months_saved: 0, interest_saved: 0 },
      },
    })
    renderView()

    await screen.findByTestId('mortgage-terms')
    expect(screen.queryByTestId('mortgage-savings')).not.toBeInTheDocument()
  })
})

describe('without a balance to amortize', () => {
  const NO_BALANCE = { ...MORTGAGE, derived: null }

  it('still shows the stored terms', async () => {
    stubApi({ '/api/mortgage': NO_BALANCE })
    renderView()

    expect(await screen.findByTestId('mortgage-terms')).toHaveTextContent(
      '3.00% · $1,075.00 P&I + $200.00 extra',
    )
  })

  it('says why there is no payoff instead of showing one', async () => {
    stubApi({ '/api/mortgage': NO_BALANCE })
    renderView()

    expect(await screen.findByTestId('mortgage-no-balance')).toHaveTextContent(
      /balance/i,
    )
    expect(screen.queryByTestId('mortgage-payoff')).not.toBeInTheDocument()
  })

  it('keeps the escrow line, which never depended on the payoff', async () => {
    stubApi({ '/api/mortgage': NO_BALANCE })
    renderView()

    expect(await screen.findByTestId('mortgage-escrow')).toHaveTextContent(
      'Escrow ($450.00/mo) continues after payoff',
    )
  })
})

describe('before the terms are entered', () => {
  it('points at the Settings card', async () => {
    stubApi({ '/api/mortgage': null })
    renderView()

    const empty = await screen.findByTestId('mortgage-empty')
    expect(empty).toHaveTextContent(/Settings/)
    expect(empty.querySelector('a')).toHaveAttribute('href', '/settings')
  })
})
