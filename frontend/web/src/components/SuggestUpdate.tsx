// The dialog where a visitor says that a product's facts are wrong or out of date. The service stores
// it as an update suggestion for the maintainers (frontend/api/catalog_web/suggestions.py); the
// catalog itself does not change.

import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { submitSuggestion, type Product, type SubmissionResult, type SuggestionTopic } from '../api'
import { byFrameworkOrder } from '../graph/blockStyle'
import { useEscape } from '../useEscape'
import { WaitingDots } from './icons'

const TOPICS: { value: SuggestionTopic; label: string }[] = [
  { value: 'description', label: 'Description' },
  { value: 'homepage', label: 'Home page' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'license_model', label: 'License model' },
  { value: 'status', label: 'Status, for example no longer sold' },
  { value: 'coverage', label: 'Coverage of a building block' },
  { value: 'other', label: 'Something else' },
]

interface Props {
  product: Product
  blocks: string[]
  onClose: () => void
}

export function SuggestUpdate({ product, blocks, onClose }: Props) {
  const [topic, setTopic] = useState<SuggestionTopic>('description')
  const [block, setBlock] = useState('')
  const [form, setForm] = useState({ correction: '', source_url: '', name: '', email: '' })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SubmissionResult | null>(null)
  useEscape(onClose)

  // The product's own blocks first, then the others.
  const covered = product.claims.map((claim) => claim.block)
  const blockOptions = [...blocks].sort((a, b) => Number(covered.includes(b)) - Number(covered.includes(a)) || byFrameworkOrder(a, b))

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    const outcome = await submitSuggestion({
      product: product.full_name,
      topic,
      ...(topic === 'coverage' ? { block } : {}),
      ...form,
    }).catch((): SubmissionResult => ({ ok: false, message: 'Your suggestion was not sent. Please try again.' }))
    setSending(false)
    setResult(outcome)
  }

  const field = (key: 'source_url' | 'name' | 'email', label: string, type: string) => (
    <label className="stack-field">
      <span>{label}</span>
      <input
        type={type}
        value={form[key]}
        maxLength={key === 'source_url' ? 500 : key === 'email' ? 254 : 100}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  )

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
            <label className="stack-field">
              <span>What needs updating?</span>
              <select value={topic} onChange={(event) => setTopic(event.target.value as SuggestionTopic)}>
                {TOPICS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {topic === 'coverage' && (
              <label className="stack-field">
                <span>Which building block?</span>
                <select value={block} required onChange={(event) => setBlock(event.target.value)}>
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
                rows={4}
                maxLength={2000}
                value={form.correction}
                onChange={(event) => setForm({ ...form, correction: event.target.value })}
              />
            </label>
            {field('source_url', 'Link to a source that shows it (optional, but it helps us check)', 'url')}
            {field('name', 'Name (optional)', 'text')}
            {field('email', 'Email (optional, if we may ask you about it)', 'email')}
            <p className="stack-note">Only the catalog maintainers can view your suggestion and these details.</p>
            {result && !result.ok && (
              <p className="notice notice-error" role="alert">
                {result.message}
              </p>
            )}
            <button type="submit" className="primary-button" disabled={sending || !form.correction.trim() || (topic === 'coverage' && !block)}>
              {sending ? (
                <>
                  Sending
                  <WaitingDots />
                </>
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
