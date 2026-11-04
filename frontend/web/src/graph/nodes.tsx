import { BaseEdge, getBezierPath, Handle, Position, type EdgeProps, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { STATUS_LABELS } from '../api'
import { blockStyle } from './blockStyle'
import type { BlockNode as BlockNodeType, CoverageEdge, ProductNode as ProductNodeType } from './buildGraph'
import { FRAMEWORK_DIAGRAM, INFRASTRUCTURE_ITEMS } from './framework'
import { CheckIcon, PlusIcon } from '../components/icons'
import { Logo } from './Logo'

// Edges attach to the centre of each node, so lines can arrive from any side.
const centreHandles = (
  <>
    <Handle type="target" position={Position.Top} className="centre-handle" isConnectable={false} />
    <Handle type="source" position={Position.Top} className="centre-handle" isConnectable={false} />
  </>
)

// In the framework view (morph 1) a block shows the items of the diagram instead of its tagline.
export function BlockNode({ data }: NodeProps<BlockNodeType>) {
  const style = blockStyle(data.name)
  const morph = data.morph ?? 0
  const items = FRAMEWORK_DIAGRAM[data.name]?.items ?? []
  const count = data.count ?? 0
  return (
    <div
      className={`graph-block${data.faded ? ' faded' : ''}${data.selected ? ' selected' : ''}${morph > 0 ? ' morphing' : ''}`}
      style={{ '--block-color': style.color } as CSSProperties}
    >
      {centreHandles}
      <div className="graph-block-name">{data.name}</div>
      {morph < 0.5 ? (
        style.tagline && (
          <div className="graph-block-tagline" style={{ opacity: 1 - morph * 2 }}>
            {style.tagline}
          </div>
        )
      ) : (
        <div className="graph-block-framework" style={{ opacity: morph * 2 - 1 }}>
          {items.length > 0 && (
            <div className={`framework-items${items.length === 4 ? ' framework-items-grid' : ''}${FRAMEWORK_DIAGRAM[data.name]?.row === 'top' ? ' framework-items-plain' : ''}`}>
              {items.map((item) => (
                <span key={item} className="framework-item">
                  {item}
                </span>
              ))}
            </div>
          )}
          <span className="framework-count">
            {count} {count === 1 ? 'product' : 'products'}
          </span>
        </div>
      )}
    </div>
  )
}

export function InfrastructureNode() {
  return (
    <div className="framework-infrastructure graph-infrastructure">
      <span className="framework-block-name">Infrastructure</span>
      <span className="framework-infrastructure-items">{INFRASTRUCTURE_ITEMS}</span>
    </div>
  )
}

export function ProductNode({ data }: NodeProps<ProductNodeType>) {
  const { product } = data
  return (
    <div
      className={`graph-product status-${product.status}${data.faded ? ' faded' : ''}${data.mine ? ' mine' : ''}`}
      title={data.mine ? `${product.full_name} (in my stack)` : product.full_name}
    >
      {centreHandles}
      <Logo fullName={product.full_name} name={product.name} />
      <span className="graph-product-text">
        <span className="graph-product-name">{product.name}</span>
        {product.status !== 'active' && <span className="graph-product-status">{STATUS_LABELS[product.status]}</span>}
      </span>
      {data.onToggleMine && (
        // nodrag and stopPropagation: the button adds or removes the product without moving it or opening its panel.
        <button
          type="button"
          className={`graph-product-add nodrag${data.mine ? ' added' : ''}`}
          aria-label={data.mine ? `Remove ${product.full_name} from my stack` : `Add ${product.full_name} to my stack`}
          title={data.mine ? 'In my stack. Click to remove' : 'Add to my stack'}
          onClick={(event) => {
            event.stopPropagation()
            data.onToggleMine?.()
          }}
        >
          {data.mine ? <CheckIcon size={10} /> : <PlusIcon size={10} />}
        </button>
      )}
    </div>
  )
}

export function CoverageEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<CoverageEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY })
  const color = blockStyle(data?.block ?? '').color
  return (
    <BaseEdge
      path={path}
      style={{
        stroke: color,
        strokeWidth: data?.extent === 'full' ? 2.2 : 1.6,
        strokeDasharray: data?.extent === 'partial' ? '6 5' : undefined,
        opacity: (data?.faded ? 0.08 : 0.75) * (data?.visibility ?? 1),
      }}
    />
  )
}

export const nodeTypes = { block: BlockNode, product: ProductNode, infrastructure: InfrastructureNode }
export const edgeTypes = { coverage: CoverageEdgeView }
