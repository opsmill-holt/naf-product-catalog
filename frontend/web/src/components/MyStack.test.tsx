import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sampleCatalog } from '../graph/fixtures'
import { MyStack } from './MyStack'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Publisher a covers Collector and Observability; Publisher c covers Intent.
const tools = ['Publisher a', 'Publisher c']

function respond(status: number, body: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 300, json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('MyStack', () => {
  it('shows nothing when no tool is marked', () => {
    const { container } = render(<MyStack catalog={sampleCatalog} tools={[]} onRemove={() => {}} onClear={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('sends the tools without details when the fields are left empty, then clears the marks', async () => {
    const fetch = respond(201, { reference: 'submission-20261102-abcdef' })
    const onClear = vi.fn()
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={onClear} />)
    expect(screen.getByText('2 tools in my stack')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(fetch).toHaveBeenCalledWith('/api/stacks', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ products: tools, no_tool_blocks: [], name: '', email: '', organization: '' })
    expect((await screen.findByRole('status')).textContent).toContain('submission-20261102-abcdef')
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('sends the optional details the visitor types', async () => {
    const fetch = respond(201, { reference: 'r' })
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.type(screen.getByLabelText('Organization (optional)'), 'Example Net')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body).organization).toBe('Example Net')
  })

  it('keeps the marks and shows the reason when the service refuses the stack', async () => {
    respond(422, { detail: 'these products are not in the catalog: Publisher c' })
    const onClear = vi.fn()
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Publisher c')
    expect(onClear).not.toHaveBeenCalled()
  })

  it('removes a tool from the list', async () => {
    const onRemove = vi.fn()
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={onRemove} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Publisher c' }))
    expect(onRemove).toHaveBeenCalledWith('Publisher c')
  })

  it('shows the blocks the tools cover and offers the others as having no tool', async () => {
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    const covered = screen.getByRole('heading', { name: 'Building blocks your tools cover' }).parentElement!
    expect(covered.textContent).toContain('Observability')
    expect(covered.textContent).toContain('Intent')
    expect(covered.textContent).toContain('Collector')
    const offered = screen.getAllByRole('checkbox').map((box) => box.parentElement!.textContent)
    expect(offered).toEqual(['I have no tool for Presentation', 'I have no tool for Orchestrator', 'I have no tool for Executor'])
  })

  it('sends only the blocks the visitor ticks as having no tool', async () => {
    const fetch = respond(201, { reference: 'r' })
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByLabelText('I have no tool for Executor'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body).no_tool_blocks).toEqual(['Executor'])
  })

  it('drops a ticked block once a chosen tool covers it', async () => {
    const fetch = respond(201, { reference: 'r' })
    const { rerender } = render(<MyStack catalog={sampleCatalog} tools={['Publisher c']} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByLabelText('I have no tool for Collector'))
    rerender(<MyStack catalog={sampleCatalog} tools={['Publisher c', 'Publisher a']} onRemove={() => {}} onClear={() => {}} />)
    expect(screen.queryByLabelText('I have no tool for Collector')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(JSON.parse(fetch.mock.calls[0][1].body).no_tool_blocks).toEqual([])
  })
})
