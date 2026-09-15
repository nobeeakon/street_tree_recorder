import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import './App.css'
import { PageLoadingFallback } from './components/PageLoadingFallback'
import { HomePage } from './pages/HomePage'
import { RecorderPage } from './pages/RecorderPage'
import { APP_ROUTE_PATHS } from './routePaths'

/**
 * Every page of the app, in one table. Only the matched one is mounted, which
 * is what keeps the labelling page from asking for the camera and the recorder
 * from holding a gallery in memory.
 *
 * Hash history rather than browser history: GitHub Pages is a static host with
 * no rewrite rule, so `/etiquetar` would come back as a 404 while `#/etiquetar`
 * is never sent to the server at all. Deep links, reloads and the back button
 * all work with no server configuration.
 *
 * Declarative routing rather than a data router, because every page here owns
 * its own state and none of them load anything: the loader and action machinery
 * would add ~50 kB to a bundle a phone downloads over mobile data.
 */

// Split out of the main bundle: the labelling page carries the EXIF reader, the
// gallery and the store, and the phone doing the recording has no use for any
// of it. The chunk is fetched the first time its route is visited.
const LabelerPage = lazy(async () => ({
  default: (await import('./pages/LabelerPage')).LabelerPage,
}))

function App() {
  return (
    <HashRouter>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route path={APP_ROUTE_PATHS.home} element={<HomePage />} />
          <Route path={APP_ROUTE_PATHS.recorder} element={<RecorderPage />} />
          <Route path={APP_ROUTE_PATHS.labeler} element={<LabelerPage />} />
          {/* An old or mistyped fragment lands on the home page, not a blank one. */}
          <Route path="*" element={<Navigate to={APP_ROUTE_PATHS.home} replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}

export default App
