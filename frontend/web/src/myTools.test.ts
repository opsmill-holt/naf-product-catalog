import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMyTools } from './myTools'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useMyTools', () => {
  it('keeps the marks in local storage, so they survive a reload', () => {
    const first = renderHook(() => useMyTools())
    act(() => first.result.current.toggle('Example Corp Tool'))
    expect(first.result.current.tools).toEqual(['Example Corp Tool'])
    const reloaded = renderHook(() => useMyTools())
    expect(reloaded.result.current.tools).toEqual(['Example Corp Tool'])
    act(() => reloaded.result.current.toggle('Example Corp Tool'))
    expect(reloaded.result.current.tools).toEqual([])
  })

  it('works without storage, for example in a private window', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useMyTools())
    act(() => result.current.toggle('Example Corp Tool'))
    expect(result.current.tools).toEqual(['Example Corp Tool'])
  })

  it('ignores stored data that is not a list of names', () => {
    window.localStorage.setItem('catalog.myTools', '{"broken": true}')
    expect(renderHook(() => useMyTools()).result.current.tools).toEqual([])
  })
})
