// The tools in the visitor's stack, in the top-left corner of the graph. Clicking a name opens the
// product; × removes it. The header collapses the list.

import { useState } from 'react'
import type { Product } from '../api'
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
                <span>{product.name}</span>
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
