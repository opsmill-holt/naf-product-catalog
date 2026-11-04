import type { CSSProperties } from 'react'
import { LICENSE_LABELS, type Product, type Requirement, type Source } from '../api'
import { blockStyle } from '../graph/blockStyle'
import { Logo } from '../graph/Logo'
import { CheckIcon, PlusIcon } from './icons'
import { Requirements } from './Requirements'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SourceLinks({ sources }: { sources: Source[] }) {
  if (!sources.length) return null
  return (
    <span className="source-pills">
      {sources.map((source) => (
        <a key={source.url} className="source-pill" href={source.url} target="_blank" rel="noopener noreferrer nofollow" title={source.title}>
          {hostOf(source.url)}
        </a>
      ))}
    </span>
  )
}

interface Props {
  product: Product
  requirements: Requirement[]
  inStack: boolean
  onToggleStack: () => void
  onClose: () => void
}

export function ProductDetails({ product, requirements, inStack, onToggleStack, onClose }: Props) {
  const claims = [...product.claims].sort((a, b) =>
    a.extent === b.extent ? a.block.localeCompare(b.block) : a.extent === 'full' ? -1 : 1,
  )
  return (
    <aside className="details" aria-label={`Details for ${product.full_name}`}>
      <button type="button" className="details-close" onClick={onClose} aria-label="Close details">
        ×
      </button>
      <header className="details-header">
        <Logo fullName={product.full_name} name={product.name} size="large" />
        <div className="details-title">
          <h2>{product.name}</h2>
          <p className="details-publisher">
            by {product.publisher} <SourceLinks sources={product.sources.publisher} />
          </p>
        </div>
      </header>

      <div className="badges">
        <span className={`badge badge-license${product.license_model ? '' : ' badge-muted'}`}>
          {product.license_model ? LICENSE_LABELS[product.license_model] : 'License not stated'}
        </span>
        <a className="badge badge-link" href={product.homepage_url} target="_blank" rel="noopener noreferrer nofollow">
          Home page ↗
        </a>
      </div>
      {product.sources.license_model.length > 0 && (
        <p className="details-row-sources">
          <span>
            License: <SourceLinks sources={product.sources.license_model} />
          </span>
        </p>
      )}

      <button type="button" className={`stack-toggle${inStack ? ' stack-toggle-on' : ''}`} aria-pressed={inStack} onClick={onToggleStack}>
        {inStack ? <CheckIcon /> : <PlusIcon />}
        <span>{inStack ? 'In my stack' : 'Add to my stack'}</span>
        {inStack && <span className="stack-toggle-hint">Remove</span>}
      </button>

      <section className="details-section">
        <h3>What it does</h3>
        <p className="details-description">{product.description}</p>
        <SourceLinks sources={product.sources.description} />
      </section>

      <section className="details-section">
        <h3>Building blocks covered</h3>
        <ul className="coverage-list">
          {claims.map((claim) => (
            <li
              key={claim.block}
              className={`coverage-item coverage-${claim.extent}`}
              style={{ '--block-color': blockStyle(claim.block).color } as CSSProperties}
            >
              <div className="coverage-head">
                <span className="coverage-block">{claim.block}</span>
                <span className="coverage-extent">
                  {claim.extent === 'full' ? 'Full' : claim.assessed ? 'Partial' : 'Not assessed'}
                </span>
              </div>
              {claim.note && <p className="coverage-note">{claim.note}</p>}
              <SourceLinks sources={claim.sources} />
              <Requirements claim={claim} requirements={requirements} />
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
