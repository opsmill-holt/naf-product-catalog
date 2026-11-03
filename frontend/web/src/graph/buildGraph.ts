// Turns the catalog, the filters, the current focus and the search text into graph nodes and edges.

import type { Edge, Node } from '@xyflow/react'
import type { Catalog, Extent, Product } from '../api'
import type { Filters } from '../filters'
import { BLOCK_SIZE, PRODUCT_SIZE, layoutGraph } from './layout'

export type Focus = { kind: 'product'; id: string } | { kind: 'block'; name: string } | null

// morph, count and selected are set only by src/graph/morph.ts, for the framework view.
export type BlockNodeData = { name: string; faded: boolean; morph?: number; count?: number; selected?: boolean }
export type ProductNodeData = { product: Product; faded: boolean; mine?: boolean; onToggleMine?: () => void }
export type CoverageEdgeData = { extent: Extent; block: string; faded: boolean; visibility?: number }

export type BlockNode = Node<BlockNodeData, 'block'>
export type ProductNode = Node<ProductNodeData, 'product'>
export type InfrastructureNode = Node<Record<string, never>, 'infrastructure'>
export type GraphNode = BlockNode | ProductNode | InfrastructureNode
export type CoverageEdge = Edge<CoverageEdgeData>

export const blockNodeId = (name: string) => `block:${name}`

// A product matches the search when its name or publisher contains the text, ignoring case.
export const matchesSearch = (product: Product, search: string) => {
  const text = search.trim().toLowerCase()
  return text !== '' && `${product.full_name} ${product.publisher}`.toLowerCase().includes(text)
}

// The products the filters show, each with the claims that are drawn.
export function visibleProducts(catalog: Catalog, filters: Filters) {
  return catalog.products
    .filter((product) => filters.statuses.includes(product.status))
    .map((product) => ({
      product,
      claims: product.claims.filter(
        (claim) => (!filters.block || claim.block === filters.block) && filters.extents.includes(claim.extent),
      ),
    }))
    .filter((entry) => entry.claims.length > 0)
}

export function buildGraph(catalog: Catalog, filters: Filters, focus: Focus, search = '') {
  const blockNames = catalog.blocks
    .map((block) => block.name)
    .filter((name) => !filters.block || name === filters.block)
  const visibleBlocks = new Set(blockNames)

  // Positions depend only on the visible blocks, so nodes do not move when status or coverage
  // filters change.
  const layout = layoutGraph(
    blockNames,
    catalog.products.map((product) => ({
      id: product.id,
      blocks: product.claims.map((claim) => claim.block).filter((name) => visibleBlocks.has(name)),
    })),
  )

  const visible = visibleProducts(catalog, filters)

  // Which nodes stay bright for the current focus.
  const bright = new Set<string>()
  if (focus?.kind === 'product') {
    bright.add(focus.id)
    visible
      .find((entry) => entry.product.id === focus.id)
      ?.claims.forEach((claim) => bright.add(blockNodeId(claim.block)))
  } else if (focus?.kind === 'block') {
    bright.add(blockNodeId(focus.name))
    visible
      .filter((entry) => entry.claims.some((claim) => claim.block === focus.name))
      .forEach((entry) => bright.add(entry.product.id))
  }
  // While a search is typed, it decides what stays bright: the matching products, the blocks they
  // cover, and a block whose name matches.
  const searching = search.trim() !== ''
  const matching = new Set(visible.filter((entry) => matchesSearch(entry.product, search)).map((entry) => entry.product.id))
  if (searching) {
    bright.clear()
    for (const entry of visible) {
      if (!matching.has(entry.product.id)) continue
      bright.add(entry.product.id)
      entry.claims.forEach((claim) => bright.add(blockNodeId(claim.block)))
    }
    blockNames
      .filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()))
      .forEach((name) => bright.add(blockNodeId(name)))
  }
  const faded = (id: string) => (searching || focus !== null) && !bright.has(id)

  const nodes: GraphNode[] = [
    ...blockNames.map(
      (name): BlockNode => ({
        id: blockNodeId(name),
        type: 'block',
        position: {
          x: layout.blocks[name].x - BLOCK_SIZE.width / 2,
          y: layout.blocks[name].y - BLOCK_SIZE.height / 2,
        },
        data: { name, faded: faded(blockNodeId(name)) },
        width: BLOCK_SIZE.width,
        height: BLOCK_SIZE.height,
        draggable: false,
      }),
    ),
    ...visible.map(
      ({ product }): ProductNode => ({
        id: product.id,
        type: 'product',
        position: {
          x: layout.products[product.id].x - PRODUCT_SIZE.width / 2,
          y: layout.products[product.id].y - PRODUCT_SIZE.height / 2,
        },
        data: { product, faded: faded(product.id) },
        width: PRODUCT_SIZE.width,
        height: PRODUCT_SIZE.height,
      }),
    ),
  ]

  const edges: CoverageEdge[] = visible.flatMap(({ product, claims }) =>
    claims.map((claim) => {
      const edgeFaded = searching
        ? !matching.has(product.id)
        : focus?.kind === 'product'
          ? focus.id !== product.id
          : focus?.kind === 'block'
            ? focus.name !== claim.block
            : false
      return {
        id: `${product.id}->${claim.block}`,
        source: product.id,
        target: blockNodeId(claim.block),
        type: 'coverage',
        data: { extent: claim.extent, block: claim.block, faded: edgeFaded },
      }
    }),
  )

  return { nodes, edges, matches: matching.size }
}
