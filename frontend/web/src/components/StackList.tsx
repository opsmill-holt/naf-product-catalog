// The tools in the visitor's stack, in the top-left corner of the graph. Each tool has a dot in the
// colour of every block it covers: filled for full coverage, hollow for partial. Clicking a name opens
// the product; × removes it. The header collapses the list.

import { useState, type CSSProperties } from 'react'
import type { Product } from '../api'
import { blockStyle, byFrameworkOrder } from '../graph/blockStyle'
import { Logo } from '../graph/Logo'

interface Props {
  products: Product[]
  onOpen: (product: Product) => void
  onRemove: (fullName: string) => void
}

export function StackList({ products, onOpen, onRemove }: Props) {
  // Starts collapsed on narrow screens, where the list would cover much of the graph.
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 900px)').matches)
  if (!products.length) return null
  return (
    <section className="stack-panel" aria-label="My stack">
      <button type="button" className="stack-panel-header" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>My stack ({products.length})</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="stack-panel-list">
          {products.map((product) => (
            <li key={product.id}>
              <button type="button" className="stack-panel-item" onClick={() => onOpen(product)} title={product.full_name}>
                <Logo fullName={product.full_name} name={product.name} />
                <span className="stack-panel-name">{product.name}</span>
                <span className="stack-panel-blocks">
                  {[...product.claims]
                    .sort((a, b) => byFrameworkOrder(a.block, b.block))
                    .map((claim) => (
                      <span
                        key={claim.block}
                        className={`block-dot block-dot-${claim.extent}`}
                        style={{ '--block-color': blockStyle(claim.block).color } as CSSProperties}
                        title={`${claim.block}, ${claim.extent} coverage`}
                        aria-label={`${claim.block}, ${claim.extent} coverage`}
                      />
                    ))}
                </span>
              </button>
              <button
                type="button"
                className="stack-panel-remove"
                aria-label={`Remove ${product.full_name} from my stack`}
                onClick={() => onRemove(product.full_name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
