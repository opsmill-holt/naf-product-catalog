// The products the visitor marked as tools they use, and the step that sends them to the maintainers.
// Name, email and organization are optional; the service stores the stack on an Infrahub branch with
// a proposed change (frontend/api/catalog_web/stacks.py).

import { useState, type CSSProperties, type FormEvent } from 'react'
import { submitStack, type Catalog, type SubmissionResult } from '../api'
import { blockStyle, byFrameworkOrder } from '../graph/blockStyle'

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

  if (!tools.length && !open) return null

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

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setSending(true)
    const outcome = await submitStack({ products: tools, no_tool_blocks: noTool, ...details }).catch(
      (): SubmissionResult => ({ ok: false, message: 'Your stack was not sent. Please try again.' }),
    )
    setSending(false)
    setResult(outcome)
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
