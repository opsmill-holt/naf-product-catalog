import { describe, expect, it } from 'vitest'
import { activeOnly, DEFAULT_FILTERS } from '../filters'
import { buildGraph } from './buildGraph'
import { sampleCatalog as allProducts } from './fixtures'

// The app builds the graph from the active products only.
const sampleCatalog = activeOnly(allProducts)

const ids = (items: { id: string }[]) => items.map((item) => item.id).sort()

describe('buildGraph', () => {
  it('draws one edge per visible claim, solid for full and dashed for partial', () => {
    const { nodes, edges } = buildGraph(sampleCatalog, DEFAULT_FILTERS, null)
    expect(ids(nodes.filter((node) => node.type === 'product'))).toEqual(['a', 'c'])
    expect(ids(edges)).toEqual(['a->Collector', 'a->Observability', 'c->Intent'])
    expect(edges.find((edge) => edge.id === 'a->Collector')?.data?.extent).toBe('full')
    expect(edges.find((edge) => edge.id === 'a->Observability')?.data?.extent).toBe('partial')
  })

  it('always shows every building block', () => {
    const { nodes } = buildGraph(sampleCatalog, DEFAULT_FILTERS, null)
    expect(nodes.filter((node) => node.type === 'block')).toHaveLength(6)
  })

  it('leaves out products with no visible claim', () => {
    const { nodes } = buildGraph(sampleCatalog, { ...DEFAULT_FILTERS, extents: ['full'] }, null)
    expect(ids(nodes.filter((node) => node.type === 'product'))).toEqual(['a', 'c'])
    const onlyPartial = buildGraph(sampleCatalog, { extents: ['partial'], block: null }, null)
    expect(ids(onlyPartial.nodes.filter((node) => node.type === 'product'))).toEqual(['a'])
  })

  it('shows a single block with only its products', () => {
    const { nodes, edges } = buildGraph(sampleCatalog, { ...DEFAULT_FILTERS, block: 'Collector' }, null)
    expect(ids(nodes)).toEqual(['a', 'block:Collector'])
    expect(ids(edges)).toEqual(['a->Collector'])
  })

  it('fades everything outside a focused product', () => {
    const { nodes, edges } = buildGraph(sampleCatalog, DEFAULT_FILTERS, { kind: 'product', id: 'a' })
    const bright = nodes.filter((node) => !node.data.faded).map((node) => node.id).sort()
    expect(bright).toEqual(['a', 'block:Collector', 'block:Observability'])
    expect(edges.filter((edge) => edge.data?.faded).map((edge) => edge.id)).toEqual(['c->Intent'])
  })

  it('fades everything outside a focused block', () => {
    const { nodes } = buildGraph(sampleCatalog, DEFAULT_FILTERS, { kind: 'block', name: 'Intent' })
    const bright = nodes.filter((node) => !node.data.faded).map((node) => node.id).sort()
    expect(bright).toEqual(['block:Intent', 'c'])
  })

  it('keeps the products matching the search bright, with the blocks they cover, ignoring case', () => {
    const { nodes, edges, matches } = buildGraph(sampleCatalog, DEFAULT_FILTERS, null, '  PUBLISHER C ')
    expect(matches).toBe(1)
    const bright = nodes.filter((node) => !node.data.faded).map((node) => node.id).sort()
    expect(bright).toEqual(['block:Intent', 'c'])
    expect(edges.filter((edge) => !edge.data?.faded).map((edge) => edge.id)).toEqual(['c->Intent'])
  })

  it('also keeps a block bright when its name matches the search', () => {
    const { nodes, matches } = buildGraph(sampleCatalog, DEFAULT_FILTERS, null, 'executor')
    expect(matches).toBe(0)
    expect(nodes.filter((node) => !node.data.faded).map((node) => node.id)).toEqual(['block:Executor'])
  })

  it('fades nothing for an empty search', () => {
    const { nodes, matches } = buildGraph(sampleCatalog, DEFAULT_FILTERS, null, '   ')
    expect(matches).toBe(0)
    expect(nodes.every((node) => !node.data.faded)).toBe(true)
  })
})

