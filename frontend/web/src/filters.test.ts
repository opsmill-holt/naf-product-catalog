import { describe, expect, it } from 'vitest'
import { activeOnly, countBlockProducts, DEFAULT_FILTERS, parseFilters, serializeFilters } from './filters'
import { sampleCatalog } from './graph/fixtures'

describe('filters', () => {



  it('reads and writes the page address', () => {
    const search = serializeFilters({ extents: ['full'], block: 'Intent' })
    expect(search).toBe('extent=full&block=Intent')
    expect(parseFilters(search)).toEqual({ extents: ['full'], block: 'Intent' })
  })

  it('ignores the status filter of older links', () => {
    expect(parseFilters('status=active%2Cdiscontinued&block=Intent')).toEqual({ ...DEFAULT_FILTERS, block: 'Intent' })
  })

  it('keeps only active products for the web app', () => {
    expect(activeOnly(sampleCatalog).products.map((product) => product.id)).toEqual(['a', 'c', 'd'])
  })

  it('leaves default filters out of the page address', () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe('')
    expect(parseFilters('')).toEqual(DEFAULT_FILTERS)
  })

  it('ignores unknown values in the page address', () => {
    expect(parseFilters('status=bogus&extent=nope')).toEqual(DEFAULT_FILTERS)
  })

  it('counts the products that cover a block with the selected extents', () => {
    const active = activeOnly(sampleCatalog)
    expect(countBlockProducts(active, DEFAULT_FILTERS, 'Collector')).toBe(1)
    expect(countBlockProducts(active, { ...DEFAULT_FILTERS, extents: ['partial'] }, 'Observability')).toBe(1)
    expect(countBlockProducts(active, { ...DEFAULT_FILTERS, extents: ['full'] }, 'Observability')).toBe(0)
  })
})
