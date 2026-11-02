import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Catalog } from '../api'
import { countBlockProducts, type Filters } from '../filters'
import { blockStyle } from './blockStyle'
import { buildGraph, type Focus, type GraphNode } from './buildGraph'
import { frameworkLayout, type Box } from './framework'
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
}

const MORPH_MS = 550
// Width the block panel (.details) covers on the right of the canvas, with its margins.
const PANEL_SPACE = 432
const FRAME_PADDING = 32

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

// The viewport that fits the diagram into the canvas, left of the block panel when it is open.
function frameworkViewport(canvas: RefObject<HTMLDivElement | null>, bounds: Box, panelOpen: boolean) {
  const rect = canvas.current?.getBoundingClientRect()
  if (!rect) return null
  const width = rect.width - (panelOpen && rect.width > PANEL_SPACE * 2 ? PANEL_SPACE : 0) - 2 * FRAME_PADDING
  const height = rect.height - 2 * FRAME_PADDING
  const zoom = Math.min(width / bounds.width, height / bounds.height)
  return {
    x: FRAME_PADDING + (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: FRAME_PADDING + (height - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom,
  }
}

function Graph({ catalog, filters, focus, onFocus, view, selectedBlock, onSelectBlock, myTools, onToggleTool, canvas }: Props & { canvas: RefObject<HTMLDivElement | null> }) {
  const framework = view === 'framework'
  const graph = useMemo(() => buildGraph(catalog, filters, focus), [catalog, filters, focus])
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
  const { fitBounds, fitView, setViewport } = useReactFlow()

  const fitFramework = useCallback(
    (duration: number) => {
      const viewport = frameworkViewport(canvas, diagram.bounds, selectedBlock !== null)
      if (viewport) setViewport(viewport, { duration })
    },
    [canvas, diagram.bounds, selectedBlock, setViewport],
  )

  // Move the viewport together with the blocks when the view changes, and when the panel opens or closes.
  // Refs, so that a filter change does not run these effects; the block-filter effect refits instead.
  const graphBox = useRef(graphBounds(graph.nodes))
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
      else fitBounds(graphBox.current, { padding: 0.08, duration })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [framework, fitFramework, fitBounds])

  // Refit when the set of blocks changes (all blocks or a single block).
  useEffect(() => {
    if (inFramework.current) return
    const timer = window.setTimeout(() => fitView({ padding: 0.08, duration: 300 }), 50)
    return () => window.clearTimeout(timer)
  }, [filters.block, fitView])

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
    } else if (node.type === 'block') onFocus({ kind: 'block', name: node.data.name })
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
      minZoom={0.1}
      maxZoom={2.5}
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
