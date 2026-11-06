// The review of the visitor's last submitted stack. The service prepares it in the background, so the
// page asks for it every few seconds, whether or not the submit dialog is open. The review's ID is kept
// in local storage, so a reload keeps waiting for it (the service keeps reviews for an hour); a finished
// review is kept there too, so it can be opened again after a reload.

import { useCallback, useEffect, useState } from 'react'
import { fetchAnalysis } from './api'

const KEY = 'catalog.stackReview'
const POLL_MS = 3000
const GIVE_UP_MS = 180_000 // the service stops a review after 150 seconds

export interface StackReview {
  id: string
  startedAt: number
  status: 'pending' | 'done' | 'failed'
  text: string | null
  seen: boolean // the visitor has opened the review, or been told that it failed
}

function load(): StackReview | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
    if (value && typeof value.id === 'string' && typeof value.startedAt === 'number') {
      const done = value.status === 'done' && typeof value.text === 'string'
      return { id: value.id, startedAt: value.startedAt, status: done ? 'done' : 'pending', text: done ? value.text : null, seen: Boolean(value.seen) }
    }
  } catch {
    // Storage blocked or unreadable: there is no review to resume.
  }
  return null
}

function store(review: StackReview | null) {
  try {
    if (review) window.localStorage.setItem(KEY, JSON.stringify(review))
    else window.localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the review is followed until a reload.
  }
}

export function useStackReview() {
  const [review, setReview] = useState<StackReview | null>(load)

  const update = useCallback((next: StackReview | null) => {
    store(next)
    setReview(next)
  }, [])

  const id = review?.id
  const startedAt = review?.startedAt
  const pending = review?.status === 'pending'
  useEffect(() => {
    if (!id || !startedAt || !pending) return
    let stopped = false
    let timer = 0
    const poll = async () => {
      const answer = await fetchAnalysis(id).catch(() => null)
      if (stopped) return
      setReview((current) => {
        if (!current || current.id !== id) return current
        // A review the service no longer has is dropped without a message: it is from an earlier visit.
        if (answer?.status === 'missing') {
          store(null)
          return null
        }
        const timedOut = Date.now() - startedAt > GIVE_UP_MS
        if (answer?.status === 'done') {
          const done = { ...current, status: 'done' as const, text: answer.text }
          store(done)
          return done
        }
        if (answer?.status === 'failed' || timedOut) return { ...current, status: 'failed' }
        return current
      })
      timer = window.setTimeout(poll, POLL_MS)
    }
    timer = window.setTimeout(poll, POLL_MS)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [id, startedAt, pending])

  const start = useCallback(
    (reviewId: string) => update({ id: reviewId, startedAt: Date.now(), status: 'pending', text: null, seen: false }),
    [update],
  )
  const markSeen = useCallback(() => {
    setReview((current) => {
      if (!current) return current
      const next = { ...current, seen: true }
      // A failed review has nothing left to show once the visitor knows.
      store(current.status === 'failed' ? null : next)
      return current.status === 'failed' ? null : next
    })
  }, [])
  const dismiss = useCallback(() => update(null), [update])

  return { review, start, markSeen, dismiss }
}

// Saves the review as a text file, with a first line that says where it comes from.
export function downloadReview(text: string, today = new Date()) {
  const date = today.toISOString().slice(0, 10)
  const body = `Stack review from the Network Automation Product Catalog, ${date}\n\n${text}\n`
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `stack-review-${date}.txt`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
