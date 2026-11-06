// The dialog where a visitor says that a product's facts are wrong or out of date. One suggestion can
// list several changes, each with its own source. The service stores them as update suggestions for
// the maintainers (frontend/api/catalog_web/suggestions.py); the catalog itself does not change.

import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { submitSuggestion, type Product, type SubmissionResult, type SuggestionTopic } from '../api'
import { byFrameworkOrder } from '../graph/blockStyle'
import { useEscape } from '../useEscape'
import { CloseIcon, PlusIcon, WaitingDots } from './icons'

const TOPICS: { value: SuggestionTopic; label: string }[] = [
  { value: 'description', label: 'Description' },
  { value: 'homepage', label: 'Home page' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'license_model', label: 'License model' },
  { value: 'status', label: 'Status, for example no longer sold' },
  { value: 'coverage', label: 'Coverage of a building block' },
  { value: 'other', label: 'Something else' },
]

const MAX_CHANGES = 10

interface Change {
  key: number
  topic: SuggestionTopic
  block: string
  correction: string
  source_url: string
}

let nextKey = 0
const newChange = (): Change => ({ key: nextKey++, topic: 'description', block: '', correction: '', source_url: '' })

interface Props {
  product: Product
  blocks: string[]
  onClose: () => void
}

export function SuggestUpdate({ product, blocks, onClose }: Props) {
  const [changes, setChanges] = useState<Change[]>(() => [newChange()])
  const [contact, setContact] = useState({ name: '', email: '' })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SubmissionResult | null>(null)
  useEscape(onClose)

  // The product's own blocks first, then the others.
  const covered = product.claims.map((claim) => claim.block)
  const blockOptions = [...blocks].sort((a, b) => Number(covered.includes(b)) - Number(covered.includes(a)) || byFrameworkOrder(a, b))

  const update = (key: number, patch: Partial<Change>) =>
    setChanges((current) => current.map((change) => (change.key === key ? { ...change, ...patch } : change)))
  const complete = changes.every((change) => change.correction.trim() && (change.topic !== 'coverage' || change.block))

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    const outcome = await submitSuggestion({
      product: product.full_name,
      changes: changes.map(({ topic, block, correction, source_url }) => ({
        topic,
        ...(topic === 'coverage' ? { block } : {}),
        correction,
        source_url,
      })),
      ...contact,
    }).catch((): SubmissionResult => ({ ok: false, message: 'Your suggestion was not sent. Please try again.' }))
    setSending(false)
    setResult(outcome)
  }

  // Rendered on the page body: the product panel's blur would otherwise keep the overlay inside it.
  return createPortal(
    <div className="stack-overlay" onClick={onClose}>
      <div className="stack-dialog" role="dialog" aria-modal="true" aria-labelledby="suggest-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="details-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 id="suggest-title">Suggest an update</h2>
        <p className="suggest-product">{product.full_name}</p>
        {result?.ok ? (
          <>
            <p role="status">
              Thank you. Your suggestion was sent as {result.reference}. A maintainer checks it before the catalog changes.
            </p>
            <button type="button" className="button" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={send}>
            {changes.map((change, index) => (
              <fieldset key={change.key} className="suggest-change" aria-label={`Change ${index + 1}`}>
                {changes.length > 1 && (
                  <div className="suggest-change-head">
                    <span>Change {index + 1}</span>
                    <button
                      type="button"
                      className="suggest-change-remove"
                      aria-label={`Remove change ${index + 1}`}
                      onClick={() => setChanges((current) => current.filter((item) => item.key !== change.key))}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                )}
                <label className="stack-field">
                  <span>What needs updating?</span>
                  <select value={change.topic} onChange={(event) => update(change.key, { topic: event.target.value as SuggestionTopic })}>
                    {TOPICS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {change.topic === 'coverage' && (
                  <label className="stack-field">
                    <span>Which building block?</span>
                    <select value={change.block} required onChange={(event) => update(change.key, { block: event.target.value })}>
                      <option value="">Choose a block</option>
                      {blockOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                          {covered.includes(name) ? '' : ' (not covered now)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="stack-field">
                  <span>What should it say instead?</span>
                  <textarea
                    required
                    rows={3}
                    maxLength={2000}
                    value={change.correction}
                    onChange={(event) => update(change.key, { correction: event.target.value })}
                  />
                </label>
                <label className="stack-field">
                  <span>Link to a source that shows it (optional, but it helps us check)</span>
                  <input
                    type="url"
                    maxLength={500}
                    value={change.source_url}
                    onChange={(event) => update(change.key, { source_url: event.target.value })}
                  />
                </label>
              </fieldset>
            ))}
            {changes.length < MAX_CHANGES && (
              <button type="button" className="suggest-add" onClick={() => setChanges((current) => [...current, newChange()])}>
                <PlusIcon />
                Add another change
              </button>
            )}
            <label className="stack-field">
              <span>Name (optional)</span>
              <input type="text" maxLength={100} value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
            </label>
            <label className="stack-field">
              <span>Email (optional, if we may ask you about it)</span>
              <input type="email" maxLength={254} value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
            </label>
            <p className="stack-note">Only the catalog maintainers can view your suggestion and these details.</p>
            {result && !result.ok && (
              <p className="notice notice-error" role="alert">
                {result.message}
              </p>
            )}
            <button type="submit" className="primary-button" disabled={sending || !complete}>
              {sending ? (
                <>
                  Sending
                  <WaitingDots />
                </>
              ) : changes.length > 1 ? (
                `Send ${changes.length} changes`
              ) : (
                'Send suggestion'
              )}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
