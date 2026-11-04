import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeOnly, DEFAULT_FILTERS } from '../filters'
import { sampleCatalog as allProducts } from '../graph/fixtures'
import { FrameworkView } from './FrameworkView'

afterEach(cleanup)

const sampleCatalog = activeOnly(allProducts)

const rowOf = (name: string) => screen.getByRole('button', { name: new RegExp(name) }).parentElement

describe('FrameworkView', () => {
  it('arranges the blocks in the rows of the framework diagram and shows no products', () => {
    render(<FrameworkView catalog={sampleCatalog} filters={DEFAULT_FILTERS} selectedBlock={null} onSelectBlock={() => {}} />)
    expect(rowOf('Presentation')?.classList.contains('framework-row-top')).toBe(true)
    for (const name of ['Observability', 'Orchestrator', 'Intent']) expect(rowOf(name)?.classList.contains('framework-row-middle')).toBe(true)
    for (const name of ['Collector', 'Executor']) expect(rowOf(name)?.classList.contains('framework-row-bottom')).toBe(true)
    expect(screen.queryByText('Publisher a')).toBeNull()
  })

  it('shows how many products cover each block', () => {
    render(<FrameworkView catalog={sampleCatalog} filters={DEFAULT_FILTERS} selectedBlock={null} onSelectBlock={() => {}} />)
    expect(within(screen.getByRole('button', { name: /Collector/ })).getByText('1 product')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /Executor/ })).getByText('0 products')).toBeTruthy()
  })

  it('puts a block that is not in the diagram in an extra row', () => {
    const catalog = { ...sampleCatalog, blocks: [...sampleCatalog.blocks, { name: 'Other', description: '', definition_url: '' }] }
    render(<FrameworkView catalog={catalog} filters={DEFAULT_FILTERS} selectedBlock={null} onSelectBlock={() => {}} />)
    expect(rowOf('Other')?.classList.contains('framework-row-other')).toBe(true)
  })

  it('reports the block that is clicked', async () => {
    const onSelectBlock = vi.fn()
    render(<FrameworkView catalog={sampleCatalog} filters={DEFAULT_FILTERS} selectedBlock={null} onSelectBlock={onSelectBlock} />)
    await userEvent.click(screen.getByRole('button', { name: /Intent/ }))
    expect(onSelectBlock).toHaveBeenCalledWith('Intent')
  })
})
