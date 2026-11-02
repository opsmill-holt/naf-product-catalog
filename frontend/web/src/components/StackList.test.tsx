import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { product } from '../graph/fixtures'
import { StackList } from './StackList'

afterEach(cleanup)

const products = [product('a', 'active', [['Collector', 'full'], ['Observability', 'partial']]), product('c', 'active', [])]

describe('StackList', () => {
  it('shows nothing when the stack is empty', () => {
    const { container } = render(<StackList products={[]} onOpen={() => {}} onRemove={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists the tools in the stack, opens one and removes one', async () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    render(<StackList products={products} onOpen={onOpen} onRemove={onRemove} />)
    expect(screen.getByRole('button', { name: /My stack \(2\)/ })).toBeTruthy()
    await userEvent.click(screen.getByTitle('Publisher c'))
    expect(onOpen).toHaveBeenCalledWith(products[1])
    await userEvent.click(screen.getByRole('button', { name: 'Remove Publisher a from my stack' }))
    expect(onRemove).toHaveBeenCalledWith('Publisher a')
  })

  it('collapses the list', async () => {
    render(<StackList products={products} onOpen={() => {}} onRemove={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /My stack/ }))
    expect(screen.queryByTitle('Publisher a')).toBeNull()
  })

  it('shows a dot for each block a tool covers, in framework order, filled for full coverage', () => {
    render(<StackList products={products} onOpen={() => {}} onRemove={() => {}} />)
    const dots = screen.getByTitle('Publisher a').querySelectorAll('.block-dot')
    expect([...dots].map((dot) => dot.getAttribute('aria-label'))).toEqual(['Observability, partial coverage', 'Collector, full coverage'])
    expect(dots[1].classList.contains('block-dot-full')).toBe(true)
  })
})
