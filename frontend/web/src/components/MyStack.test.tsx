import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sampleCatalog } from '../graph/fixtures'
import { downloadReview } from '../stackReview'
import { MyStack } from './MyStack'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

// Publisher a covers Collector and Observability; Publisher c covers Intent.
const tools = ['Publisher a', 'Publisher c']

function respond(status: number, body: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: status < 300, status, json: () => Promise.resolve(body) })
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

  it('keeps checking for the review after the dialog is closed, then offers it in a pop-up', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({ reference: 'r', analysis_id: 'abc' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending', text: null }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'done', text: 'Your tools cover Collector.' }) })
    vi.stubGlobal('fetch', fetch)
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(/developed by OpsMill’s Solution Architects is reviewing your stack\. You can close this window/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText(/AI skill is reviewing your stack/)).toBeTruthy()
    expect(await screen.findByText('Your stack review is ready.', {}, { timeout: 8000 })).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/analyses/abc')
    await userEvent.click(screen.getByRole('button', { name: 'View review' }))
    expect(screen.getByRole('dialog', { name: 'Review of your stack' }).textContent).toContain('Your tools cover Collector.')
    expect(screen.queryByText('Your stack review is ready.')).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(screen.getByRole('button', { name: 'View my stack review' })).toBeTruthy()
  }, 15_000)

  it('says when the review is not available', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({ reference: 'r', analysis_id: 'abc' }) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'failed', text: null }) })
    vi.stubGlobal('fetch', fetch)
    render(<MyStack catalog={sampleCatalog} tools={tools} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Submit my stack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText(/review of your stack is not available/, {}, { timeout: 6000 })).toBeTruthy()
  }, 10_000)

  it('resumes waiting for a review after a reload', async () => {
    window.localStorage.setItem('catalog.stackReview', JSON.stringify({ id: 'abc', startedAt: Date.now(), seen: false }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'done', text: 'Ready.' }) }))
    render(<MyStack catalog={sampleCatalog} tools={[]} onRemove={() => {}} onClear={() => {}} />)
    expect(screen.getByText(/AI skill is reviewing your stack/)).toBeTruthy()
    expect(await screen.findByText('Your stack review is ready.', {}, { timeout: 6000 })).toBeTruthy()
  }, 10_000)

  it('drops a stored review the service no longer has, without a message', async () => {
    window.localStorage.setItem('catalog.stackReview', JSON.stringify({ id: 'old', startedAt: Date.now(), seen: false }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) }))
    const { container } = render(<MyStack catalog={sampleCatalog} tools={[]} onRemove={() => {}} onClear={() => {}} />)
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(container.innerHTML).toBe('')
    expect(window.localStorage.getItem('catalog.stackReview')).toBeNull()
  }, 10_000)

  it('clears a finished review from the header', async () => {
    window.localStorage.setItem('catalog.stackReview', JSON.stringify({ id: 'abc', startedAt: Date.now(), status: 'done', text: 'Ready.', seen: true }))
    const { container } = render(<MyStack catalog={sampleCatalog} tools={[]} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear my stack review' }))
    expect(container.innerHTML).toBe('')
    expect(window.localStorage.getItem('catalog.stackReview')).toBeNull()
  })

  it('stops waiting for a review from the header', async () => {
    window.localStorage.setItem('catalog.stackReview', JSON.stringify({ id: 'abc', startedAt: Date.now(), seen: false }))
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending', text: null }) })
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<MyStack catalog={sampleCatalog} tools={[]} onRemove={() => {}} onClear={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop waiting for my stack review' }))
    expect(container.innerHTML).toBe('')
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(fetch).not.toHaveBeenCalled()
  }, 10_000)

  it('downloads the review as a dated text file', async () => {
    const created: Blob[] = []
    vi.stubGlobal('URL', { ...URL, createObjectURL: (blob: Blob) => (created.push(blob), 'blob:review'), revokeObjectURL: () => {} })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('stack-review-2026-11-04.txt')
    })
    downloadReview('Your stack\nTwo tools.', new Date('2026-11-04T12:00:00Z'))
    expect(click).toHaveBeenCalledOnce()
    expect(await created[0].text()).toBe('Stack review from the Network Automation Product Catalog, 2026-11-04\n\nYour stack\nTwo tools.\n')
    click.mockRestore()
  })
})

