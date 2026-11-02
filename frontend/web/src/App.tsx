import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { fetchCatalog } from './api'
import { BlockDetails } from './components/BlockDetails'
import { FilterBar } from './components/FilterBar'
import { FrameworkView } from './components/FrameworkView'
import { ProductDetails } from './components/ProductDetails'
import { countBlockProducts, parseFilters, serializeFilters, type Filters } from './filters'
import type { Focus } from './graph/buildGraph'
import { CatalogGraph, type View } from './graph/CatalogGraph'
import { slugify } from './graph/logos'
import { MadeBy } from './components/MadeBy'
import { MyStack } from './components/MyStack'
import { StackList } from './components/StackList'
import { useMyTools } from './myTools'
import { SubmitForm } from './submit/SubmitForm'

const isSubmitView = () => window.location.hash === '#submit'

// Below this width the framework view is a one-column list instead of a diagram in the graph canvas.
const NARROW = '(max-width: 900px)'

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const onChange = () => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export default function App() {
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog, staleTime: 60_000 })
  const [filters, setFilters] = useState<Filters>(() => parseFilters(window.location.search))
  const [focus, setFocus] = useState<Focus>(null)
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'framework' ? 'framework' : 'graph',
  )
  const [frameworkBlock, setFrameworkBlock] = useState<string | null>(null)
  const narrow = useNarrow()
  const myTools = useMyTools()
  const [pendingProduct, setPendingProduct] = useState(() => new URLSearchParams(window.location.search).get('product'))

  // Open the product named in the page address once the catalog has loaded.
  useEffect(() => {
    if (!pendingProduct || !catalog.data) return
    const product = catalog.data.products.find((item) => slugify(item.full_name) === pendingProduct)
    if (product) {
      setFocus({ kind: 'product', id: product.id })
      setView('graph')
    }
    setPendingProduct(null)
  }, [pendingProduct, catalog.data])
  const [submitView, setSubmitView] = useState(isSubmitView)

  const selectedId = focus?.kind === 'product' ? focus.id : null
  const selected = catalog.data?.products.find((product) => product.id === selectedId) ?? null
  const selectedBlock = catalog.data?.blocks.find((block) => block.name === frameworkBlock) ?? null
  // Marks for products that are no longer in the catalog are ignored.
  const stack = useMemo(
    () => myTools.tools.filter((tool) => catalog.data?.products.some((product) => product.full_name === tool)),
    [myTools.tools, catalog.data],
  )

  useEffect(() => {
    if (pendingProduct) return
    const params = new URLSearchParams(serializeFilters(filters))
    if (view === 'framework') params.set('view', 'framework')
    if (selected) params.set('product', slugify(selected.full_name))
    const search = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
  }, [filters, selected, pendingProduct, view])

  // Escape closes the block panel of the framework view, as it clears the focus in the graph.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFrameworkBlock(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onHash = () => setSubmitView(isSubmitView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Network Automation Product Catalog</h1>
          <p className="subtitle">Products mapped to the building blocks of the Network Automation Framework</p>
        </div>
        <nav>
          {submitView ? (
            <a className="button" href="#">
              ← Back to the catalog
            </a>
          ) : (
            <>
              {catalog.data && <MyStack catalog={catalog.data} tools={stack} onRemove={myTools.toggle} onClear={myTools.clear} />}
              <a className="button" href="#submit">
                Submit a product
              </a>
            </>
          )}
        </nav>
      </header>

      {catalog.isPending && <p className="notice">Loading the catalog…</p>}
      {catalog.isError && (
        <p className="notice notice-error" role="alert">
          The catalog is not available right now. Try again later.
        </p>
      )}

      {catalog.data && submitView && (
        <>
          <SubmitForm catalog={catalog.data} onDone={() => (window.location.hash = '')} />
          <div className="made-by-row">
            <MadeBy />
          </div>
        </>
      )}

      {catalog.data && !submitView && (
        <main>
          <FilterBar
            catalog={catalog.data}
            filters={filters}
            onChange={(next) => {
              setFilters(next)
              setFocus(null)
            }}
          />
          <p className="hint">
            {view === 'graph'
              ? 'Drag to move, scroll to zoom. Click a product or a building block to highlight its links. Click + on a product to add it to the tools you use, then submit your stack.'
              : 'The building blocks as the framework diagram arranges them. Click a block to view its MUST and SHOULD requirements.'}
          </p>
          <div className={`graph-stage${view === 'framework' && narrow ? ' graph-stage-list' : ''}`}>
            <div className="graph-overlay-left">
              <div className="view-toggle" role="group" aria-label="View">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={view === 'graph'}
                  onClick={() => {
                    setView('graph')
                    setFrameworkBlock(null)
                  }}
                >
                  Products
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={view === 'framework'}
                  onClick={() => {
                    setView('framework')
                    setFocus(null)
                  }}
                >
                  Framework only
                </button>
              </div>
              {view === 'graph' && (
                <StackList
                  products={stack.map((tool) => catalog.data.products.find((product) => product.full_name === tool)!)}
                  onOpen={(product) => setFocus({ kind: 'product', id: product.id })}
                  onRemove={myTools.toggle}
                />
              )}
            </div>
            {view === 'graph' && (
              <div className="graph-legend" aria-label="Line legend">
                <span>
                  <svg width="28" height="8" aria-hidden="true">
                    <line x1="0" y1="4" x2="28" y2="4" />
                  </svg>
                  Full coverage
                </span>
                <span>
                  <svg width="28" height="8" aria-hidden="true">
                    <line x1="0" y1="4" x2="28" y2="4" strokeDasharray="6 5" />
                  </svg>
                  Partial coverage
                </span>
              </div>
            )}
            {view === 'framework' && narrow ? (
              <FrameworkView
                catalog={catalog.data}
                filters={filters}
                selectedBlock={frameworkBlock}
                onSelectBlock={setFrameworkBlock}
              />
            ) : (
              <CatalogGraph
                catalog={catalog.data}
                filters={filters}
                focus={focus}
                onFocus={setFocus}
                view={view}
                selectedBlock={frameworkBlock}
                onSelectBlock={setFrameworkBlock}
                myTools={stack}
                onToggleTool={myTools.toggle}
              />
            )}
            {view === 'graph' && selected && (
              <ProductDetails
                product={selected}
                requirements={catalog.data.requirements}
                inStack={stack.includes(selected.full_name)}
                onToggleStack={() => myTools.toggle(selected.full_name)}
                onClose={() => setFocus(null)}
              />
            )}
            {view === 'framework' && selectedBlock && (
              <BlockDetails
                block={selectedBlock}
                requirements={catalog.data.requirements}
                productCount={countBlockProducts(catalog.data, filters, selectedBlock.name)}
                onShowProducts={() => {
                  setFilters({ ...filters, block: selectedBlock.name })
                  setFrameworkBlock(null)
                  setView('graph')
                }}
                onClose={() => setFrameworkBlock(null)}
              />
            )}
          </div>
          <footer className="app-footer">
            <p className="footer-notes">
            Building blocks from the{' '}
            <a href="https://reference.networkautomation.forum/Framework/Framework/" target="_blank" rel="noopener noreferrer">
              Network Automation Framework
            </a>
            . Every fact links to its source.
            <br />
            Product names and logos are trademarks of their respective owners. They are used only to identify the
            products. Their use does not imply endorsement.
            </p>
            <MadeBy />
          </footer>
        </main>
      )}
    </div>
  )
}
