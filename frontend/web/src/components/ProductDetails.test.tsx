import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Product, Requirement } from '../api'
import { ProductDetails } from './ProductDetails'

const hostile = '<script>alert("x")</script><img src=x onerror=alert(1)>'

const product: Product = {
  id: 'p1',
  name: hostile,
  full_name: `Example ${hostile}`,
  publisher: 'Example',
  description: hostile,
  homepage_url: 'https://example.org/',
  license_model: null,
  status: 'active',
  status_date: null,
  sources: { publisher: [{ title: hostile, url: 'https://example.org/a' }], description: [], license_model: [], status: [] },
  claims: [
    {
      block: 'Intent',
      extent: 'partial',
      assessed: true,
      note: hostile,
      sources: [],
      verdicts: [
        { requirement: 'intent-must-1', verdict: 'met', note: hostile, sources: [{ title: 'Docs', url: 'https://example.org/docs' }] },
        { requirement: 'intent-should-1', verdict: 'partly_met', note: 'Only through a plugin.', sources: [{ title: 'Plugin', url: 'https://example.org/plugin' }] },
        { requirement: 'framework-should-1', verdict: 'not_shown', note: null, sources: [] },
      ],
    },
  ],
}

const requirement = (identifier: string, level: Requirement['level'], block: string | null, summary: string): Requirement => ({
  identifier,
  level,
  position: 1,
  summary,
  statement: `It ${level.toUpperCase()} ...`,
  reference_url: 'https://reference.networkautomation.forum/Framework/Framework/#intent',
  block,
})

const requirements = [
  requirement('framework-should-1', 'should', null, 'Uses version control'),
  requirement('intent-must-1', 'must', 'Intent', 'Represents any network aspect'),
  requirement('intent-should-1', 'should', 'Intent', 'Uses a vendor-neutral model'),
  requirement('intent-may-1', 'may', 'Intent', 'Includes intended-state logic'),
  requirement('executor-must-1', 'must', 'Executor', 'Writes to the network'),
]

afterEach(cleanup)

describe('ProductDetails', () => {
  it('shows submitted text as plain text, never as markup', () => {
    const { container } = render(<ProductDetails product={product} requirements={requirements} inStack={false} onToggleStack={() => {}} onClose={() => {}} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert("x")</script>')
  })

  it('lists the MUST and SHOULD requirements the product falls short on first, with verdict and source', () => {
    render(<ProductDetails product={product} requirements={requirements} inStack={false} onToggleStack={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Meets 1 of 2 MUST and SHOULD requirements of Intent.')).toBeTruthy()
    const shortfalls = screen.getByRole('list', { name: 'Requirements Intent falls short on' })
    const items = within(shortfalls).getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toHaveLength(1)
    expect(items[0]).toContain('Uses a vendor-neutral model')
    expect(items[0]).toContain('Partly met')
    expect(items[0]).toContain('example.org')
    // Framework-wide requirements are not shortfalls: they do not count toward full coverage.
    expect(screen.queryByText('Uses version control')).toBeNull()
    expect(screen.queryByText('Writes to the network')).toBeNull()
  })

  it('shows met and MAY requirements on request', async () => {
    render(<ProductDetails product={product} requirements={requirements} inStack={false} onToggleStack={() => {}} onClose={() => {}} />)
    expect(screen.queryByText('Represents any network aspect')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 met, 1 MAY and 1 framework-wide requirements' }))
    expect(screen.getByText('Represents any network aspect')).toBeTruthy()
    expect(screen.getByText('Includes intended-state logic')).toBeTruthy()
    const frameworkWide = screen.getByRole('list', { name: 'Framework-wide requirements' })
    expect(within(frameworkWide).getByText('Uses version control')).toBeTruthy()
  })

  it('says when a claim is not assessed yet', () => {
    const unassessed = { ...product, claims: [{ ...product.claims[0], assessed: false, verdicts: [] }] }
    render(<ProductDetails product={unassessed} requirements={requirements} inStack={false} onToggleStack={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Not assessed')).toBeTruthy()
    expect(screen.getByText(/Not assessed yet against the framework/)).toBeTruthy()
  })

  it('adds the product to my stack and shows when it is in it', async () => {
    const onToggleStack = vi.fn()
    const { rerender } = render(
      <ProductDetails product={product} requirements={requirements} inStack={false} onToggleStack={onToggleStack} onClose={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to my stack' }))
    expect(onToggleStack).toHaveBeenCalledOnce()
    rerender(<ProductDetails product={product} requirements={requirements} inStack onToggleStack={onToggleStack} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /In my stack/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
