import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Catalog } from '../api'
import { countBlockProducts, type Filters } from '../filters'
import { blockStyle } from './blockStyle'
import { buildGraph, type Focus, type GraphNode } from './buildGraph'
import { frameworkLayout, type Box } from './framework'
import type { Arrange } from './layout'
import { graphBounds, morphGraph } from './morph'
import { edgeTypes, nodeTypes } from './nodes'

export type View = 'graph' | 'framework'

interface Props {
  catalog: Catalog
  filters: Filters
  focus: Focus
  onFocus: (focus: Focus) => void
  view: View
  selectedBlock: string | null
  onSelectBlock: (name: string | null) => void
  myTools: string[]
  onToggleTool: (fullName: string) => void
  search: string
  arrange: Arrange
  onBlockClick: (name: string) => void // in the graph view, the same as the block's filter chip
}

const MORPH_MS = 550
// Width the block panel (.details) covers on the right of the canvas, with its margins.
const PANEL_SPACE = 432
const FRAME_PADDING = 32
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2.5

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Moves from the current progress to the target (0 graph, 1 framework) over MORPH_MS.
function useMorphProgress(target: number) {
  const [progress, setProgress] = useState(target)
  const current = useRef(target)
  useEffect(() => {
    const start = current.current
    if (start === target) return
    const duration = reducedMotion() ? 0 : MORPH_MS
    const began = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = duration ? Math.min(1, (now - began) / duration) : 1
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      current.current = start + (target - start) * eased
      setProgress(current.current)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return progress
}

// Height at the top of the canvas covered by the toolbar (view buttons, arrangement, search), which
// wraps onto more rows on narrow screens.
function toolbarSpace(rect: DOMRect, canvas: HTMLDivElement) {
  const toolbar = canvas.parentElement?.querySelector('.graph-toolbar')
  return toolbar ? Math.max(0, toolbar.getBoundingClientRect().bottom - rect.top) : 0
}

// The viewport that fits bounds into the canvas below the toolbar, and left of the block panel when
// panelOpen is set.
function fitViewport(canvas: RefObject<HTMLDivElement | null>, bounds: Box, panelOpen = false) {
  const element = canvas.current
  const rect = element?.getBoundingClientRect()
  if (!element || !rect) return null
  const top = toolbarSpace(rect, element)
  const width = rect.width - (panelOpen && rect.width > PANEL_SPACE * 2 ? PANEL_SPACE : 0) - 2 * FRAME_PADDING
  const height = rect.height - 2 * FRAME_PADDING - top
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(width / bounds.width, height / bounds.height)))
  return {
    x: FRAME_PADDING + (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: FRAME_PADDING + top + (height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  }
}

function Graph({ catalog, filters, focus, onFocus, view, selectedBlock, onSelectBlock, myTools, onToggleTool, search, arrange, onBlockClick, canvas }: Props & { canvas: RefObject<HTMLDivElement | null> }) {
  const framework = view === 'framework'
  const graph = useMemo(() => buildGraph(catalog, filters, focus, search, arrange), [catalog, filters, focus, search, arrange])
  const diagram = useMemo(() => frameworkLayout(catalog.blocks.map((block) => block.name)), [catalog])
  const counts = useMemo(
    () => Object.fromEntries(catalog.blocks.map((block) => [block.name, countBlockProducts(catalog, filters, block.name)])),
    [catalog, filters],
  )
  const progress = useMorphProgress(framework ? 1 : 0)
  const morphed = useMemo(
    () => morphGraph(graph, diagram, progress, { counts, selectedBlock }),
    [graph, diagram, progress, counts, selectedBlock],
  )
  const { edges } = morphed
  const nodes = useMemo(
    () =>
      morphed.nodes.map((node) => {
        if (node.type !== 'product') return node
        const { full_name } = node.data.product
        return { ...node, data: { ...node.data, mine: myTools.includes(full_name), onToggleMine: () => onToggleTool(full_name) } }
      }),
    [morphed.nodes, myTools, onToggleTool],
  )
  const { setViewport } = useReactFlow()

  const fitFramework = useCallback(
    (duration: number) => {
      const viewport = fitViewport(canvas, diagram.bounds, selectedBlock !== null)
      if (viewport) setViewport(viewport, { duration })
    },
    [canvas, diagram.bounds, selectedBlock, setViewport],
  )
  // The graph's bounds, for fitting the graph view; kept in a ref so the fit effects run only when
  // the view, the block filter or the arrangement changes.
  const graphBox = useRef(graphBounds(graph.nodes))
  const fitGraph = useCallback(
    (duration: number) => {
      const viewport = fitViewport(canvas, graphBox.current)
      if (viewport) setViewport(viewport, { duration })
    },
    [canvas, setViewport],
  )

  // Move the viewport together with the blocks when the view changes, and when the panel opens or closes.
  // Refs, so that a filter change does not run these effects; the block-filter effect refits instead.
  const inFramework = useRef(framework)
  useLayoutEffect(() => {
    graphBox.current = graphBounds(graph.nodes)
    inFramework.current = framework
  })
  const firstRun = useRef(true)
  useEffect(() => {
    const duration = firstRun.current || reducedMotion() ? 0 : MORPH_MS
    firstRun.current = false
    const timer = window.setTimeout(() => {
      if (framework) fitFramework(duration)
      else fitGraph(duration)
    }, 50)
    return () => window.clearTimeout(timer)
  }, [framework, fitFramework, fitGraph])

  // Refit when the set of blocks changes (all blocks or a single block), or the arrangement does.
  useEffect(() => {
    if (inFramework.current) return
    const timer = window.setTimeout(() => fitGraph(300), 50)
    return () => window.clearTimeout(timer)
  }, [filters.block, arrange, fitGraph])

  useEffect(() => {
    if (!framework) return
    const onResize = () => fitFramework(0)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [framework, fitFramework])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFocus])

  const onNodeClick = (_: unknown, node: GraphNode) => {
    if (framework) {
      if (node.type === 'block') onSelectBlock(node.data.name)
    } else if (node.type === 'block') onBlockClick(node.data.name)
    else if (node.type === 'product') onFocus({ kind: 'product', id: node.id })
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => (framework ? onSelectBlock(null) : onFocus(null))}
      fitView={!framework}
      fitViewOptions={{ padding: 0.08 }}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      panOnDrag={!framework}
      zoomOnScroll={!framework}
      zoomOnPinch={!framework}
      zoomOnDoubleClick={!framework}
      nodesConnectable={false}
      edgesFocusable={false}
      proOptions={{ hideAttribution: false }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#2b3548" />
      {!framework && <Controls showInteractive={false} position="bottom-left" />}
      {!framework && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(node) => (node.type === 'block' ? blockStyle(String(node.data.name)).color : '#4b5563')}
          maskColor="rgba(5, 7, 13, 0.7)"
        />
      )}
    </ReactFlow>
  )
}

export function CatalogGraph(props: Props) {
  const canvas = useRef<HTMLDivElement>(null)
  return (
    <div ref={canvas} className={`graph-canvas${props.view === 'framework' ? ' graph-canvas-framework' : ''}`} aria-label="Catalog graph">
      <ReactFlowProvider>
        <Graph {...props} canvas={canvas} />
      </ReactFlowProvider>
    </div>
  )
}
