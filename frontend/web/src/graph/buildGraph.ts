// Turns the catalog, the filters and the current focus into graph nodes and edges.

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

export function buildGraph(catalog: Catalog, filters: Filters, focus: Focus) {
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

  const visible = catalog.products
    .filter((product) => filters.statuses.includes(product.status))
    .map((product) => ({
      product,
      claims: product.claims.filter(
        (claim) => visibleBlocks.has(claim.block) && filters.extents.includes(claim.extent),
      ),
    }))
    .filter((entry) => entry.claims.length > 0)

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
  const faded = (id: string) => focus !== null && !bright.has(id)

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
      const edgeFaded =
        focus?.kind === 'product'
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

  return { nodes, edges }
}
