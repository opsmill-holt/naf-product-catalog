// Filter state and how it is stored in the page address. src/graph/buildGraph.ts applies it.

import type { Catalog, Extent } from './api'

export interface Filters {
  extents: Extent[]
  block: string | null
}

export const ALL_EXTENTS: Extent[] = ['full', 'partial']

export const DEFAULT_FILTERS: Filters = { extents: ['full', 'partial'], block: null }

// The web app shows only products that are still sold. Infrahub keeps the status of the others, with
// its sources; the submission form uses the whole catalog.
export function activeOnly(catalog: Catalog): Catalog {
  return { ...catalog, products: catalog.products.filter((product) => product.status === 'active') }
}

function pick<T extends string>(value: string | null, allowed: T[], fallback: T[]): T[] {
  if (!value) return fallback
  const chosen = allowed.filter((item) => value.split(',').includes(item))
  return chosen.length ? chosen : fallback
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item))

export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  return {
    extents: pick(params.get('extent'), ALL_EXTENTS, DEFAULT_FILTERS.extents),
    block: params.get('block') || null,
  }
}

export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams()
  if (!sameSet(filters.extents, DEFAULT_FILTERS.extents)) {
    params.set('extent', ALL_EXTENTS.filter((extent) => filters.extents.includes(extent)).join(','))
  }
  if (filters.block) params.set('block', filters.block)
  return params.toString()
}

// Products that cover a block with one of the selected extents.
export function countBlockProducts(catalog: Catalog, filters: Filters, block: string): number {
  return catalog.products.filter(
    (product) =>
      product.claims.some((claim) => claim.block === block && filters.extents.includes(claim.extent)),
  ).length
}
