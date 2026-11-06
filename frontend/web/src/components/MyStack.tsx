// The products the visitor marked as tools they use, and the step that sends them to the maintainers.
// Name, email and organization are optional; the service stores the stack on an Infrahub branch with
// a proposed change (frontend/api/catalog_web/stacks.py). When the service reviews the stack, the header
// shows that the review is in progress and a pop-up says when it is ready (src/stackReview.ts).

import { useState, type CSSProperties, type FormEvent } from 'react'
import { submitStack, type Catalog, type SubmissionResult } from '../api'
import { blockStyle, byFrameworkOrder } from '../graph/blockStyle'
import { downloadReview, useStackReview } from '../stackReview'
import { CheckIcon, CloseIcon, WaitingDots } from './icons'

interface Props {
  catalog: Catalog
  tools: string[] // full names, all in the catalog
  onRemove: (fullName: string) => void
  onClear: () => void
}

export function MyStack({ catalog, tools, onRemove, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState({ name: '', email: '', organization: '' })
  const [ticked, setTicked] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SubmissionResult | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const { review, start, markSeen, dismiss } = useStackReview()

  if (!tools.length && !open && !review) return null

  const blocks = catalog.blocks.map((block) => block.name).sort(byFrameworkOrder)
  const covered = new Set(
    catalog.products.filter((product) => tools.includes(product.full_name)).flatMap((product) => product.claims.map((claim) => claim.block)),
  )
  const uncovered = blocks.filter((block) => !covered.has(block))
  // A block stops counting as "no tool" as soon as a chosen product covers it.
  const noTool = ticked.filter((block) => uncovered.includes(block))

  const close = () => {
    setOpen(false)
    setResult(null)
  }

  const openReview = () => {
    setOpen(false)
    setResult(null)
    setReviewOpen(true)
    markSeen()
  }

  // The pop-up appears when the review is finished and the visitor has not opened it yet.
  const finished = review && review.status !== 'pending' && !review.seen

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    const outcome = await submitStack({ products: tools, no_tool_blocks: noTool, ...details }).catch(
      (): SubmissionResult => ({ ok: false, message: 'Your stack was not sent. Please try again.' }),
    )
    setSending(false)
    setResult(outcome)
    if (outcome.ok && outcome.analysisId) start(outcome.analysisId)
    if (outcome.ok) {
      onClear()
      setDetails({ name: '', email: '', organization: '' })
      setTicked([])
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
      {review?.status === 'pending' && (
        <span className="review-pill review-pill-pending">
          <span className="review-pill-main" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>
              OpsMill&rsquo;s AI skill is reviewing your stack
              <WaitingDots />
            </span>
          </span>
          <button type="button" className="review-pill-clear" aria-label="Stop waiting for my stack review" title="Stop waiting" onClick={dismiss}>
            <CloseIcon />
          </button>
        </span>
      )}
      {review?.status === 'done' && (
        <span className="review-pill">
          <button type="button" className="review-pill-main" onClick={openReview}>
            <CheckIcon />
            View my stack review
          </button>
          <button type="button" className="review-pill-clear" aria-label="Clear my stack review" title="Clear review" onClick={dismiss}>
            <CloseIcon />
          </button>
        </span>
      )}
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
                {result.analysisId && (
                  <p className="stack-note">
                    An AI skill developed by OpsMill&rsquo;s Solution Architects is reviewing your stack. You can close this window: a message appears when the review is ready, usually within a minute or
                    two.
                  </p>
                )}
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
                {covered.size > 0 && (
                  <section className="stack-section">
                    <h3>Building blocks your tools cover</h3>
                    <p className="stack-blocks">
                      {blocks
                        .filter((block) => covered.has(block))
                        .map((block) => (
                          <span key={block} className="stack-block" style={{ '--block-color': blockStyle(block).color } as CSSProperties}>
                            {block}
                          </span>
                        ))}
                    </p>
                  </section>
                )}
                {uncovered.length > 0 && (
                  <fieldset className="stack-section stack-gaps">
                    <legend>Building blocks none of your tools cover</legend>
                    <p className="stack-note">
                      Tick each block you have no tool for. Leave a block unticked if you would rather not say, or if your tool for it is not
                      in the catalog.
                    </p>
                    {uncovered.map((block) => (
                      <label key={block} className="stack-gap">
                        <input
                          type="checkbox"
                          checked={noTool.includes(block)}
                          onChange={(event) =>
                            setTicked(event.target.checked ? [...noTool, block] : noTool.filter((item) => item !== block))
                          }
                        />
                        I have no tool for {block}
                      </label>
                    ))}
                  </fieldset>
                )}
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
                  {sending ? (
                    <>
                      Sending
                      <WaitingDots />
                    </>
                  ) : (
                    'Submit'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {finished && !reviewOpen && (
        <div className={`review-toast${review.status === 'failed' ? ' review-toast-failed' : ''}`} role="alert">
          {review.status === 'done' ? (
            <>
              <span>Your stack review is ready.</span>
              <button type="button" className="primary-button" onClick={openReview}>
                View review
              </button>
            </>
          ) : (
            <span>The review of your stack is not available right now. Your stack was still sent.</span>
          )}
          <button type="button" className="review-toast-close" aria-label="Close message" onClick={markSeen}>
            <CloseIcon />
          </button>
        </div>
      )}

      {reviewOpen && review?.status === 'done' && (
        <div className="stack-overlay" onClick={() => setReviewOpen(false)}>
          <div className="stack-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="details-close" onClick={() => setReviewOpen(false)} aria-label="Close">
              ×
            </button>
            <h2 id="review-title">Review of your stack</h2>
            <p className="stack-analysis-text">{review.text}</p>
            <div className="review-actions">
              <span className="review-actions-main">
                <button type="button" className="button" onClick={() => setReviewOpen(false)}>
                  Close
                </button>
                <button type="button" className="button" onClick={() => downloadReview(review.text ?? '')}>
                  Download
                </button>
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setReviewOpen(false)
                  dismiss()
                }}
              >
                Clear this review
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
