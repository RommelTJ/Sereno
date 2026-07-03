import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App.tsx'

describe('App', () => {
  it('renders the shell and shows backend health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ status: 'ok', version: '0.0.2' }),
      }),
    )

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Sereno' })).toBeInTheDocument()
    expect(await screen.findByText('ok · v0.0.2')).toBeInTheDocument()
  })
})
