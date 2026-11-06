import { cleanup, render, screen, within } from '@testing-library/react'
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

const card = (number: number) => screen.getByRole('group', { name: `Change ${number}` })

describe('SuggestUpdate', () => {
  it('sends one change with the optional details', async () => {
    const fetch = respond(201, { reference: 'submission-test' })
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.selectOptions(within(card(1)).getByLabelText('What needs updating?'), 'license_model')
    await userEvent.type(within(card(1)).getByLabelText('What should it say instead?'), 'Open core')
    await userEvent.type(within(card(1)).getByLabelText(/Link to a source/), 'https://example.org')
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }))
    expect(fetch).toHaveBeenCalledWith('/api/suggestions', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      product: 'Publisher a',
      changes: [{ topic: 'license_model', correction: 'Open core', source_url: 'https://example.org' }],
      name: '',
      email: '',
    })
    expect((await screen.findByRole('status')).textContent).toContain('submission-test')
  })

  it('sends several changes in one suggestion, and a change can be removed', async () => {
    const fetch = respond(201, { reference: 'r' })
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.type(within(card(1)).getByLabelText('What should it say instead?'), 'New description')
    await userEvent.click(screen.getByRole('button', { name: 'Add another change' }))
    await userEvent.selectOptions(within(card(2)).getByLabelText('What needs updating?'), 'coverage')
    await userEvent.selectOptions(within(card(2)).getByLabelText('Which building block?'), 'Executor')
    await userEvent.type(within(card(2)).getByLabelText('What should it say instead?'), 'It also writes changes.')
    await userEvent.click(screen.getByRole('button', { name: 'Add another change' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove change 3' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send 2 changes' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body).changes).toEqual([
      { topic: 'description', correction: 'New description', source_url: '' },
      { topic: 'coverage', block: 'Executor', correction: 'It also writes changes.', source_url: '' },
    ])
  })

  it('lists the product’s blocks first for coverage, and waits for every change to be complete', async () => {
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.selectOptions(within(card(1)).getByLabelText('What needs updating?'), 'coverage')
    const options = [...(within(card(1)).getByLabelText('Which building block?') as HTMLSelectElement).options].map((option) => option.text)
    expect(options).toEqual(['Choose a block', 'Collector', 'Presentation (not covered now)', 'Executor (not covered now)'])
    await userEvent.type(within(card(1)).getByLabelText('What should it say instead?'), 'Text')
    const send = () => screen.getByRole('button', { name: /^Send/ }) as HTMLButtonElement
    expect(send().disabled).toBe(true) // no block chosen yet
    await userEvent.selectOptions(within(card(1)).getByLabelText('Which building block?'), 'Collector')
    expect(send().disabled).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Add another change' }))
    expect(send().disabled).toBe(true) // the new change is empty
  })

  it('shows why the service refused the suggestion', async () => {
    respond(422, { detail: 'Publisher a is not in the catalog' })
    render(<SuggestUpdate product={tool} blocks={blocks} onClose={() => {}} />)
    await userEvent.type(within(card(1)).getByLabelText('What should it say instead?'), 'New text')
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }))
    expect((await screen.findByRole('alert')).textContent).toContain('not in the catalog')
  })
})
