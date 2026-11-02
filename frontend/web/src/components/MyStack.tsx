// The products the visitor marked as tools they use, and the step that sends them to the maintainers.
// Name, email and organization are optional; the service stores the stack on an Infrahub branch with
// a proposed change (frontend/api/catalog_web/stacks.py).

import { useState, type FormEvent } from 'react'
import { submitStack, type SubmissionResult } from '../api'

interface Props {
  tools: string[] // full names, all in the catalog
  onRemove: (fullName: string) => void
  onClear: () => void
}

export function MyStack({ tools, onRemove, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState({ name: '', email: '', organization: '' })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SubmissionResult | null>(null)

  if (!tools.length && !open) return null

  const close = () => {
    setOpen(false)
    setResult(null)
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    const outcome = await submitStack({ products: tools, ...details }).catch(
      (): SubmissionResult => ({ ok: false, message: 'Your stack was not sent. Please try again.' }),
    )
    setSending(false)
    setResult(outcome)
    if (outcome.ok) {
      onClear()
      setDetails({ name: '', email: '', organization: '' })
    }
  }

  const field = (key: keyof typeof details, label: string, type = 'text') => (
    <label className="stack-field">
      <span>{label} (optional)</span>
      <input
        type={type}
        value={details[key]}
        maxLength={key === 'email' ? 254 : 100}
        onChange={(event) => setDetails({ ...details, [key]: event.target.value })}
      />
    </label>
  )

  return (
    <>
      {tools.length > 0 && (
        <div className="stack-bar" role="region" aria-label="My stack">
          <span>
            {tools.length} {tools.length === 1 ? 'tool' : 'tools'} in my stack
          </span>
          <button type="button" className="primary-button" onClick={() => setOpen(true)}>
            Submit my stack
          </button>
          <button type="button" className="link-button" onClick={onClear}>
            Clear
          </button>
        </div>
      )}

      {open && (
        <div className="stack-overlay" onClick={close}>
          <div className="stack-dialog" role="dialog" aria-modal="true" aria-labelledby="stack-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="details-close" onClick={close} aria-label="Close">
              ×
            </button>
            <h2 id="stack-title">Submit my stack</h2>
            {result?.ok ? (
              <>
                <p role="status">
                  Thank you. Your stack was sent as {result.reference}. The catalog maintainers review it before it is stored.
                </p>
                <button type="button" className="button" onClick={close}>
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={send}>
                <ul className="stack-list" aria-label="Tools in my stack">
                  {tools.map((tool) => (
                    <li key={tool}>
                      <span>{tool}</span>
                      <button type="button" className="link-button" onClick={() => onRemove(tool)} aria-label={`Remove ${tool}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                {field('name', 'Name')}
                {field('email', 'Email', 'email')}
                {field('organization', 'Organization')}
                <p className="stack-note">Only the catalog maintainers can view your stack and these details.</p>
                {result && !result.ok && (
                  <p className="notice notice-error" role="alert">
                    {result.message}
                  </p>
                )}
                <button type="submit" className="primary-button" disabled={sending || !tools.length}>
                  {sending ? 'Sending…' : 'Submit'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
