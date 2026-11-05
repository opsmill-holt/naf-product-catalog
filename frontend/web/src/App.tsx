import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { fetchCatalog } from './api'
import { BlockDetails } from './components/BlockDetails'
import { FilterBar } from './components/FilterBar'
import { FrameworkView } from './components/FrameworkView'
import { ProductDetails } from './components/ProductDetails'
import { activeOnly, countBlockProducts, parseFilters, serializeFilters, type Filters } from './filters'
import { matchesSearch, visibleProducts, type Focus } from './graph/buildGraph'
import { CatalogGraph, type View } from './graph/CatalogGraph'
import type { Arrange } from './graph/layout'
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
  // Every view shows only active products; the submission form gets the whole catalog.
  const shown = useMemo(() => (catalog.data ? activeOnly(catalog.data) : undefined), [catalog.data])
  const [filters, setFilters] = useState<Filters>(() => parseFilters(window.location.search))
  const [focus, setFocus] = useState<Focus>(null)
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'framework' ? 'framework' : 'graph',
  )
  const [frameworkBlock, setFrameworkBlock] = useState<string | null>(null)
  const narrow = useNarrow()
  const myTools = useMyTools()
  const [search, setSearch] = useState('')
  const [arrange, setArrange] = useState<Arrange>(() =>
    new URLSearchParams(window.location.search).get('arrange') === 'columns' ? 'columns' : 'groups',
  )
  const [pendingProduct, setPendingProduct] = useState(() => new URLSearchParams(window.location.search).get('product'))

  // Open the product named in the page address once the catalog has loaded.
  useEffect(() => {
    if (!pendingProduct || !shown) return
    const product = shown.products.find((item) => slugify(item.full_name) === pendingProduct)
    if (product) {
      setFocus({ kind: 'product', id: product.id })
      setView('graph')
    }
    setPendingProduct(null)
  }, [pendingProduct, shown])
  const [submitView, setSubmitView] = useState(isSubmitView)

  const selectedId = focus?.kind === 'product' ? focus.id : null
  const selected = shown?.products.find((product) => product.id === selectedId) ?? null
  const selectedBlock = shown?.blocks.find((block) => block.name === frameworkBlock) ?? null
  const matches = useMemo(
    () => (shown && search.trim() ? visibleProducts(shown, filters).filter((entry) => matchesSearch(entry.product, search)).length : 0),
    [shown, filters, search],
  )
  // Marks for products that are no longer in the catalog are ignored.
  const stack = useMemo(
    () => myTools.tools.filter((tool) => shown?.products.some((product) => product.full_name === tool)),
    [myTools.tools, shown],
  )

  useEffect(() => {
    if (pendingProduct) return
    const params = new URLSearchParams(serializeFilters(filters))
    if (view === 'framework') params.set('view', 'framework')
    if (arrange === 'columns') params.set('arrange', 'columns')
    if (selected) params.set('product', slugify(selected.full_name))
    const search = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
  }, [filters, selected, pendingProduct, view, arrange])

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
              {shown && <MyStack catalog={shown} tools={stack} onRemove={myTools.toggle} onClear={myTools.clear} />}
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

      {shown && !submitView && (
        <main>
          <FilterBar
            catalog={shown}
            filters={filters}
            onChange={(next) => {
              setFilters(next)
              setFocus(null)
            }}
          />
          <p className="hint">
            {view === 'graph'
              ? 'Drag to move, scroll to zoom. Click a product to highlight its links, or a building block to show only that block. Type in the search box to find products. Click + on a product to add it to the tools you use, then submit your stack.'
              : 'The building blocks as the framework diagram arranges them. Click a block to view its MUST and SHOULD requirements.'}
          </p>
          <div className={`graph-stage${view === 'framework' && narrow ? ' graph-stage-list' : ''}`}>
            <div className="graph-overlay-left">
              <div className="graph-toolbar">
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
                  <div className="view-toggle arrange-toggle" role="group" aria-label="Arrange products">
                    <span className="arrange-label">Arrange</span>
                    {(['groups', 'columns'] as const).map((option) => (
                      <button key={option} type="button" className="chip" aria-pressed={arrange === option} onClick={() => setArrange(option)}>
                        {option === 'groups' ? 'Groups' : 'Columns'}
                      </button>
                    ))}
                  </div>
                )}
                {view === 'graph' && (
                  <div className="graph-search">
                    <input
                      type="search"
                      placeholder="Search products"
                      aria-label="Search products by name or publisher"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setSearch('')
                      }}
                    />
                    {search.trim() && (
                      <span className="graph-search-count" role="status">
                        {matches === 0 ? 'No matches' : `${matches} ${matches === 1 ? 'match' : 'matches'}`}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {view === 'graph' && (
                <StackList
                  products={stack.map((tool) => shown.products.find((product) => product.full_name === tool)!)}
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
                catalog={shown}
                filters={filters}
                selectedBlock={frameworkBlock}
                onSelectBlock={setFrameworkBlock}
              />
            ) : (
              <CatalogGraph
                catalog={shown}
                filters={filters}
                focus={focus}
                onFocus={setFocus}
                view={view}
                selectedBlock={frameworkBlock}
                onSelectBlock={setFrameworkBlock}
                myTools={stack}
                onToggleTool={myTools.toggle}
                search={view === 'graph' ? search : ''}
                arrange={arrange}
                onBlockClick={(name) => {
                  setFilters({ ...filters, block: filters.block === name ? null : name })
                  setFocus(null)
                }}
              />
            )}
            {view === 'graph' && selected && (
              <ProductDetails
                product={selected}
                requirements={shown.requirements}
                inStack={stack.includes(selected.full_name)}
                onToggleStack={() => myTools.toggle(selected.full_name)}
                onClose={() => setFocus(null)}
                blocks={shown.blocks.map((block) => block.name)}
              />
            )}
            {view === 'framework' && selectedBlock && (
              <BlockDetails
                block={selectedBlock}
                requirements={shown.requirements}
                productCount={countBlockProducts(shown, filters, selectedBlock.name)}
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
