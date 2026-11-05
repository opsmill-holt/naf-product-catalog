// Closes a window on top of the page with Escape, without also closing what is behind it (the product
// panel and the graph focus listen for Escape too). The listener runs in the capture phase, before
// theirs, and stops the event there.

import { useEffect } from 'react'

export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onEscape()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onEscape])
}
