// Positions for the graph, in one of two arrangements. Positions are node centres.
//
// groups: blocks sit where the Network Automation Framework diagram puts them. Products are grouped
//   by the set of blocks they cover, and each group is a grid of aligned cards: a block's own
//   products on its outer side, products of several blocks between those blocks. Groups that would
//   overlap are moved as a whole, so cards stay lined up.
// columns: one column per block, in framework order, with each product listed under the first block
//   it covers; products that cover several blocks come first, so their lines are short.

import { byFrameworkOrder } from './blockStyle'

export interface Point {
  x: number
  y: number
}

export interface ProductLink {
  id: string
  blocks: string[]
  name?: string // orders the cards inside a group; the id when left out
}

export type Arrange = 'groups' | 'columns'

export const BLOCK_SIZE = { width: 280, height: 110 }
export const PRODUCT_SIZE = { width: 200, height: 56 }

const GAP = 16
const CELL = { width: PRODUCT_SIZE.width + GAP, height: PRODUCT_SIZE.height + GAP }
const GROUP_GAP = 40 // between groups, and between a group and a block
const SNAP = 8

// The framework diagram: Presentation on top, three blocks in the middle, two below.
const BLOCK_POSITIONS: Record<string, Point> = {
  Presentation: { x: 0, y: -900 },
  Observability: { x: -1000, y: 0 },
  Orchestrator: { x: 0, y: 0 },
  Intent: { x: 1000, y: 0 },
  Collector: { x: -500, y: 900 },
  Executor: { x: 500, y: 900 },
}

// The side of a block where its own products go: away from the middle of the diagram.
type Side = 'above' | 'below' | 'left' | 'right'
const OWN_SIDE: Record<string, Side> = {
  Presentation: 'above',
  Observability: 'left',
  Orchestrator: 'below',
  Intent: 'right',
  Collector: 'below',
  Executor: 'below',
}

function placeBlocks(blockNames: string[]): Record<string, Point> {
  const positions: Record<string, Point> = {}
  const unknown = blockNames.filter((name) => !BLOCK_POSITIONS[name])
  for (const name of blockNames) {
    if (BLOCK_POSITIONS[name]) positions[name] = { ...BLOCK_POSITIONS[name] }
  }
  unknown.forEach((name, index) => {
    positions[name] = { x: (index - (unknown.length - 1) / 2) * 900, y: 1800 }
  })
  return positions
}

interface Box {
  x: number // centre
  y: number
  width: number
  height: number
}

interface Group {
  members: string[] // product ids, in order
  cols: number
  box: Box
  fixed?: boolean
}

const snap = (value: number) => Math.round(value / SNAP) * SNAP

function gridSize(count: number, cols: number) {
  const rows = Math.ceil(count / cols)
  return { width: cols * CELL.width - GAP, height: rows * CELL.height - GAP }
}

// How far a and b overlap, with room for GROUP_GAP, or null when they are apart.
function overlap(a: Box, b: Box) {
  const dx = (a.width + b.width) / 2 + GROUP_GAP - Math.abs(a.x - b.x)
  const dy = (a.height + b.height) / 2 + GROUP_GAP - Math.abs(a.y - b.y)
  return dx > 0 && dy > 0 ? { dx, dy } : null
}

function layoutGroups(blocks: Record<string, Point>, products: ProductLink[]): Record<string, Point> {
  // Group the products by the set of blocks they cover.
  const byKey = new Map<string, { blocks: string[]; members: ProductLink[] }>()
  for (const product of products) {
    const linked = [...new Set(product.blocks.filter((name) => blocks[name]))].sort(byFrameworkOrder)
    if (!linked.length) continue
    const key = linked.join('+')
    if (!byKey.has(key)) byKey.set(key, { blocks: linked, members: [] })
    byKey.get(key)!.members.push(product)
  }

  const groups: Group[] = Object.values(blocks).map((point) => ({
    members: [],
    cols: 0,
    box: { ...point, ...BLOCK_SIZE },
    fixed: true,
  }))
  const keys = [...byKey.keys()].sort()
  for (const key of keys) {
    const { blocks: linked, members } = byKey.get(key)!
    const ordered = [...members].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    const count = ordered.length
    let cols: number
    let centre: Point
    if (linked.length === 1) {
      const block = blocks[linked[0]]
      const side = OWN_SIDE[linked[0]] ?? 'below'
      // Beside a block the grid grows outward: few columns to the left or right, wide above or below.
      cols = side === 'left' || side === 'right' ? Math.min(count, Math.ceil(count / 4)) : Math.min(count, 4)
      const size = gridSize(count, cols)
      const offsetX = (BLOCK_SIZE.width + size.width) / 2 + GROUP_GAP
      const offsetY = (BLOCK_SIZE.height + size.height) / 2 + GROUP_GAP
      centre = {
        x: block.x + (side === 'left' ? -offsetX : side === 'right' ? offsetX : 0),
        y: block.y + (side === 'above' ? -offsetY : side === 'below' ? offsetY : 0),
      }
    } else {
      cols = Math.min(count, Math.max(1, Math.round(Math.sqrt(count * 1.5))))
      centre = {
        x: linked.reduce((sum, name) => sum + blocks[name].x, 0) / linked.length,
        y: linked.reduce((sum, name) => sum + blocks[name].y, 0) / linked.length,
      }
    }
    groups.push({ members: ordered.map((product) => product.id), cols, box: { ...centre, ...gridSize(count, cols) } })
  }

  // Move overlapping groups apart, along the shorter way out. Blocks stay where they are. Fixed
  // passes and a fixed order keep the result the same each time.
  for (let pass = 0; pass < 400; pass++) {
    let moved = false
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i]
        const b = groups[j]
        if (a.fixed && b.fixed) continue
        const hit = overlap(a.box, b.box)
        if (!hit) continue
        moved = true
        const alongX = hit.dx < hit.dy
        const amount = (alongX ? hit.dx : hit.dy) + 1
        const sign = alongX ? (a.box.x <= b.box.x ? -1 : 1) : a.box.y <= b.box.y ? -1 : 1
        const share = a.fixed || b.fixed ? 1 : 0.5
        const key = alongX ? 'x' : 'y'
        if (!a.fixed) a.box[key] += sign * amount * share
        if (!b.fixed) b.box[key] -= sign * amount * share
      }
    }
    if (!moved) break
  }

  const positions: Record<string, Point> = {}
  for (const group of groups) {
    if (group.fixed) continue
    const left = snap(group.box.x - group.box.width / 2)
    const top = snap(group.box.y - group.box.height / 2)
    group.members.forEach((id, index) => {
      positions[id] = {
        x: left + (index % group.cols) * CELL.width + PRODUCT_SIZE.width / 2,
        y: top + Math.floor(index / group.cols) * CELL.height + PRODUCT_SIZE.height / 2,
      }
    })
  }
  return positions
}

const COLUMN_WIDTH = BLOCK_SIZE.width + 60

function layoutColumns(blockNames: string[], products: ProductLink[]) {
  const ordered = [...blockNames].sort(byFrameworkOrder)
  const blocks: Record<string, Point> = {}
  ordered.forEach((name, index) => {
    blocks[name] = { x: (index - (ordered.length - 1) / 2) * COLUMN_WIDTH, y: 0 }
  })
  const columns = new Map<string, ProductLink[]>(ordered.map((name) => [name, []]))
  for (const product of products) {
    const linked = product.blocks.filter((name) => blocks[name]).sort(byFrameworkOrder)
    if (linked.length) columns.get(linked[0])!.push(product)
  }
  const links = (product: ProductLink) => product.blocks.filter((name) => blocks[name]).length
  const positions: Record<string, Point> = {}
  for (const [name, members] of columns) {
    members
      .sort((a, b) => links(b) - links(a) || (a.name ?? a.id).localeCompare(b.name ?? b.id))
      .forEach((product, row) => {
        positions[product.id] = {
          x: blocks[name].x,
          y: BLOCK_SIZE.height / 2 + GROUP_GAP + PRODUCT_SIZE.height / 2 + row * CELL.height,
        }
      })
  }
  return { blocks, products: positions }
}

export function layoutGraph(blockNames: string[], products: ProductLink[], arrange: Arrange = 'groups') {
  if (arrange === 'columns') return layoutColumns(blockNames, products)
  const blocks = placeBlocks(blockNames)
  return { blocks, products: layoutGroups(blocks, products) }
}
