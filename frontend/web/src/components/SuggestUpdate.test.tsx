import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { product } from '../graph/fixtures'
import { SuggestUpdate } from './SuggestUpdate'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tool = product('a', 'active', [['Collector', 'full']])
const blocks = ['Presentation', 'Collector', 'Executor']

function respond(status: number, body: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 300, status, json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('SuggestUpdate', () => {
  it('sends the topic, the correction and the optional details', async () => {
    const fetch = respond(201, { reference: 'submission-test' })
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('What needs updating?'), 'license_model')
    await userEvent.type(screen.getByLabelText('What should it say instead?'), 'Open core')
    await userEvent.type(screen.getByLabelText(/Link to a source/), 'https://example.org')
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }))
    expect(fetch).toHaveBeenCalledWith('/api/suggestions', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      product: 'Publisher a',
      topic: 'license_model',
      correction: 'Open core',
      source_url: 'https://example.org',
      name: '',
      email: '',
    })
    expect((await screen.findByRole('status')).textContent).toContain('submission-test')
  })

  it('asks for the block of a coverage suggestion, listing the product’s blocks first', async () => {
    const fetch = respond(201, { reference: 'r' })
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('What needs updating?'), 'coverage')
    const options = [...(screen.getByLabelText('Which building block?') as HTMLSelectElement).options].map((option) => option.text)
    expect(options).toEqual(['Choose a block', 'Collector', 'Presentation (not covered now)', 'Executor (not covered now)'])
    await userEvent.type(screen.getByLabelText('What should it say instead?'), 'It also writes changes.')
    expect((screen.getByRole('button', { name: 'Send suggestion' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.selectOptions(screen.getByLabelText('Which building block?'), 'Executor')
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ topic: 'coverage', block: 'Executor' })
  })

  it('shows why the service refused the suggestion', async () => {
    respond(422, { detail: 'Publisher a is not in the catalog' })
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.type(screen.getByLabelText('What should it say instead?'), 'New text')
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }))
    expect((await screen.findByRole('alert')).textContent).toContain('not in the catalog')
  })
})
