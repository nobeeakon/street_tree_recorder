/**
 * Shown while a lazily loaded page's chunk is still on its way.
 *
 * Only reachable by opening such a page's link directly — once the chunk is
 * cached, navigating to it is instant.
 */
export function PageLoadingFallback() {
  return <p className="page-loading">Cargando…</p>
}
