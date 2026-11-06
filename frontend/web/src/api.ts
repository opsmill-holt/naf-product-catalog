// Types and calls for the catalog web service (specs/005-catalog-web-app/contracts/api.md).

export type Status = 'active' | 'discontinued'
export type Extent = 'full' | 'partial'
export type LicenseModel = 'open_source' | 'open_core' | 'commercial'

export interface Source {
  title: string
  url: string
}

export type Level = 'must' | 'should' | 'may'
export type VerdictValue = 'met' | 'partly_met' | 'not_met' | 'not_shown'

// A requirement of the Network Automation Framework (specs/008-naf-requirements).
export interface Requirement {
  identifier: string
  level: Level
  position: number
  summary: string
  statement: string
  reference_url: string
  block: string | null // null: applies to every building block
}

export interface Verdict {
  requirement: string
  verdict: VerdictValue
  note: string | null
  sources: Source[]
}

export interface Claim {
  block: string
  extent: Extent // computed by the service from the verdicts
  assessed: boolean
  note: string | null
  sources: Source[]
  verdicts: Verdict[]
}

export interface Product {
  id: string
  name: string
  full_name: string
  publisher: string
  description: string
  homepage_url: string
  license_model: LicenseModel | null
  status: Status
  status_date: string | null
  sources: {
    publisher: Source[]
    description: Source[]
    license_model: Source[]
    status: Source[]
  }
  claims: Claim[]
}

export interface Block {
  name: string
  description: string
  definition_url: string
}

export interface Publisher {
  name: string
  homepage_url: string
}

export interface Catalog {
  blocks: Block[]
  publishers: Publisher[]
  requirements: Requirement[]
  products: Product[]
}

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch('/api/catalog')
  if (!response.ok) {
    throw new Error('The catalog is not available right now. Try again later.')
  }
  return response.json()
}

export interface SubmissionResult {
  ok: boolean
  reference?: string
  analysisId?: string // set when the service runs the stack review on a submitted stack
  message?: string
}

export interface Analysis {
  // missing: the service no longer has it (it keeps reviews for an hour, and forgets them on restart)
  status: 'pending' | 'done' | 'failed' | 'missing'
  text: string | null
}

export async function fetchAnalysis(id: string): Promise<Analysis> {
  const response = await fetch(`/api/analyses/${encodeURIComponent(id)}`)
  if (response.status === 404) return { status: 'missing', text: null }
  if (!response.ok) return { status: 'failed', text: null }
  return response.json()
}

export function submitProduct(body: unknown): Promise<SubmissionResult> {
  return post('/api/submissions', body)
}

// The products one visitor uses, by full name, with optional details about who sends them.
export interface StackSubmission {
  products: string[]
  no_tool_blocks: string[] // blocks the visitor says they have no tool for
  name?: string
  email?: string
  organization?: string
}

export function submitStack(body: StackSubmission): Promise<SubmissionResult> {
  return post('/api/stacks', body)
}

// A visitor's suggestion that a product's facts are wrong or out of date.
export type SuggestionTopic = 'description' | 'homepage' | 'publisher' | 'license_model' | 'status' | 'coverage' | 'other'

export interface SuggestionChange {
  topic: SuggestionTopic
  block?: string // for coverage
  correction: string
  source_url?: string
}

export interface SuggestionSubmission {
  product: string // full name
  changes: SuggestionChange[] // at least 1, at most 10
  name?: string
  email?: string
}

export function submitSuggestion(body: SuggestionSubmission): Promise<SubmissionResult> {
  return post('/api/suggestions', body)
}

async function post(path: string, body: unknown): Promise<SubmissionResult> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (response.ok) {
    return { ok: true, reference: data.reference, analysisId: data.analysis_id }
  }
  const detail = data.detail
  const message = Array.isArray(detail)
    ? detail.map((item: { msg?: string }) => item.msg).join(' ')
    : typeof detail === 'string'
      ? detail
      : 'Your submission was not saved. Please try again.'
  return { ok: false, message }
}

export const LICENSE_LABELS: Record<LicenseModel, string> = {
  open_source: 'Open source',
  open_core: 'Open core',
  commercial: 'Commercial',
}
