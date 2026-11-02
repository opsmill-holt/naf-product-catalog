import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MyStack } from './MyStack'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tools = ['Example Corp Tool', 'Other Org Engine']

function respond(status: number, body: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 300, json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('MyStack', () => {
  it('shows nothing when no tool is marked', () => {
    const { container } = render(<MyStack tools={[]} onRemove={() => {}} onClear={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('sends the tools without details when the fields are left empty, then clears the marks', async () => {
    const fetch = respond(201, { reference: 'submission-20261102-abcdef' })
    const onClear = vi.fn()
    render(<MyStack tools={tools} onRemove={() => {}} onClear={onClear} />)
    expect(screen.getByText('2 tools in my stack')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(fetch).toHaveBeenCalledWith('/api/stacks', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ products: tools, name: '', email: '', organization: '' })
    expect((await screen.findByRole('status')).textContent).toContain('submission-20261102-abcdef')
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('sends the optional details the visitor types', async () => {
    const fetch = respond(201, { reference: 'r' })
    render(<MyStack tools={tools} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.type(screen.getByLabelText('Organization (optional)'), 'Example Net')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body).organization).toBe('Example Net')
  })

  it('keeps the marks and shows the reason when the service refuses the stack', async () => {
    respond(422, { detail: 'these products are not in the catalog: Other Org Engine' })
    const onClear = vi.fn()
    render(<MyStack tools={tools} onRemove={() => {}} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Other Org Engine')
    expect(onClear).not.toHaveBeenCalled()
  })

  it('removes a tool from the list', async () => {
    const onRemove = vi.fn()
    render(<MyStack tools={tools} onRemove={onRemove} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Other Org Engine' }))
    expect(onRemove).toHaveBeenCalledWith('Other Org Engine')
  })
})
