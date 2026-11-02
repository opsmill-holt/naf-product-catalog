// The products a visitor marks as tools they use. Kept in the browser's local storage by full name,
// so the marks survive a reload; nothing is sent until the visitor submits their stack.

import { useCallback, useState } from 'react'

const KEY = 'catalog.myTools'

function load(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function store(tools: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(tools))
  } catch {
    // Storage can be blocked, for example in a private window; the marks then last until a reload.
  }
}

export function useMyTools() {
  const [tools, setTools] = useState<string[]>(load)
  const update = useCallback((next: (current: string[]) => string[]) => {
    setTools((current) => {
      const value = next(current)
      store(value)
      return value
    })
  }, [])
  const toggle = useCallback(
    (fullName: string) =>
      update((current) => (current.includes(fullName) ? current.filter((item) => item !== fullName) : [...current, fullName])),
    [update],
  )
  const clear = useCallback(() => update(() => []), [update])
  return { tools, toggle, clear }
}
