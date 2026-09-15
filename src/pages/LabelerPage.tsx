import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Link } from 'react-router'
import './LabelerPage.css'
import { LabelManagerPanel } from '../components/labeler/LabelManagerPanel'
import { PhotoGalleryStrip } from '../components/labeler/PhotoGalleryStrip'
import { PhotoViewer } from '../components/labeler/PhotoViewer'
import { useAnnotationStore } from '../hooks/useAnnotationStore'
import { usePhotoGallery } from '../hooks/usePhotoGallery'
import { buildAnnotationsCsv, buildAnnotationsCsvFileName } from '../lib/annotationCsv'
import { downloadBlobAsFile } from '../lib/capture'
import { toPhotoRegistration } from '../lib/photoLibrary'
import { APP_ROUTE_PATHS } from '../routePaths'

/**
 * The desk half of the survey: go through the photos taken on a walk, tag each
 * one, and export the result.
 *
 * Two pieces of state sit side by side here and are deliberately not merged.
 * The gallery holds the photos of *this* session and dies with the tab, because
 * a browser cannot keep a `File` across a reload. The store holds the labels and
 * one row per photo ever analysed, and outlives everything — which is what makes
 * re-opening a picture bring its old labels back.
 *
 * Built for a computer: a mouse, a keyboard with arrow keys, and a screen big
 * enough to judge a tree on.
 */

/** Only the first nine labels get a digit shortcut; there are only nine keys. */
const MAXIMUM_KEYBOARD_SHORTCUT_LABELS = 9

export function LabelerPage() {
  const store = useAnnotationStore()
  const gallery = usePhotoGallery()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  const {
    photos,
    selectedPhoto,
    selectedPhotoIndex,
    addFiles,
    goToPreviousPhoto,
    goToNextPhoto,
    selectPhotoAtIndex,
    removeAllPhotos,
  } = gallery
  const { labels, registerPhotos, toggleLabelOnPhoto } = store

  /**
   * Loading is two steps on purpose: the gallery reads the files, and whatever
   * it accepted is then recorded in the store. A photo that fails to read never
   * reaches the database.
   */
  const handleAddFiles = useCallback(
    async (files: readonly File[]) => {
      const addedPhotos = await addFiles(files)
      if (addedPhotos.length > 0) {
        registerPhotos(addedPhotos.map(toPhotoRegistration))
      }
    },
    [addFiles, registerPhotos],
  )

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? [])
      // Clearing the input lets the same folder be picked again after a reset.
      event.target.value = ''
      void handleAddFiles(selectedFiles)
    },
    [handleAddFiles],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      setIsDraggingFiles(false)
      void handleAddFiles(Array.from(event.dataTransfer.files))
    },
    [handleAddFiles],
  )

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    // Without this the browser navigates to the dropped file instead.
    event.preventDefault()
    setIsDraggingFiles(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    // Leaving for a child element fires this too; only the real exit counts.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingFiles(false)
    }
  }, [])

  const handleExportCsv = useCallback(() => {
    const csvContent = buildAnnotationsCsv(store.database)
    const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
    downloadBlobAsFile(csvBlob, buildAnnotationsCsvFileName(new Date()))
  }, [store.database])

  const handleClearAllData = useCallback(() => {
    const confirmationMessage =
      `Se borrarán ${store.labels.length} ${store.labels.length === 1 ? 'etiqueta' : 'etiquetas'} y ` +
      `los datos de ${store.storedPhotoCount} ${store.storedPhotoCount === 1 ? 'foto' : 'fotos'} de este navegador. ` +
      'Esto no se puede deshacer: exporta el CSV antes si quieres conservarlo. ¿Seguir?'

    if (window.confirm(confirmationMessage)) {
      store.clearAllStoredData()
      removeAllPhotos()
    }
  }, [removeAllPhotos, store])

  /**
   * Keyboard first: arrows to walk the gallery, digits to tag. Going through a
   * few hundred photos with the mouse alone would be miserable.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      // Typing a label name must not also tag the photo behind the panel.
      const eventTarget = event.target
      if (
        eventTarget instanceof HTMLElement &&
        (eventTarget.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(eventTarget.tagName))
      ) {
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToPreviousPhoto()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToNextPhoto()
        return
      }

      if (!selectedPhoto || !/^[1-9]$/.test(event.key)) {
        return
      }
      const shortcutLabel = labels[Number(event.key) - 1]
      if (shortcutLabel) {
        event.preventDefault()
        toggleLabelOnPhoto(selectedPhoto.photoKey, shortcutLabel.id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToNextPhoto, goToPreviousPhoto, labels, selectedPhoto, toggleLabelOnPhoto])

  const handleToggleLabelOnSelectedPhoto = useCallback(
    (labelId: string) => {
      if (selectedPhoto) {
        toggleLabelOnPhoto(selectedPhoto.photoKey, labelId)
      }
    },
    [selectedPhoto, toggleLabelOnPhoto],
  )

  const { loadingProgress } = gallery

  return (
    <main
      className={`labeler ${isDraggingFiles ? 'labeler--dropping' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="labeler__header">
        <div className="labeler__identity">
          <h1 className="labeler__title">Etiquetar fotos</h1>
          <nav className="labeler__navigation">
            <Link className="page-link" to={APP_ROUTE_PATHS.recorder}>
              ← Volver a grabar
            </Link>
            <Link className="page-link" to={APP_ROUTE_PATHS.about}>
              Acerca de
            </Link>
          </nav>
        </div>

        <div className="labeler__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            onChange={handleFileInputChange}
          />
          <button
            type="button"
            className="button button--compact button--start"
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingProgress !== null}
          >
            {loadingProgress === null ? 'Añadir fotos' : 'Leyendo…'}
          </button>
          <button
            type="button"
            className="button button--compact button--secondary"
            onClick={handleExportCsv}
            disabled={store.storedPhotoCount === 0}
            title="Descarga coordenadas y etiquetas de todas las fotos guardadas"
          >
            Exportar CSV
          </button>
          <button
            type="button"
            className="button button--compact button--secondary"
            onClick={removeAllPhotos}
            disabled={photos.length === 0}
            title="Vacía la galería de esta sesión; las etiquetas guardadas no se tocan"
          >
            Vaciar galería
          </button>
          <button
            type="button"
            className="button button--compact button--stop"
            onClick={handleClearAllData}
            disabled={store.storedPhotoCount === 0 && store.labels.length === 0}
          >
            Borrar todos los datos
          </button>
        </div>
      </header>

      <p className="labeler__summary">
        {photos.length} {photos.length === 1 ? 'foto en la galería' : 'fotos en la galería'} ·{' '}
        {store.storedPhotoCount} {store.storedPhotoCount === 1 ? 'foto guardada' : 'fotos guardadas'} ·{' '}
        {store.labels.length} {store.labels.length === 1 ? 'etiqueta' : 'etiquetas'}
        {labels.length > MAXIMUM_KEYBOARD_SHORTCUT_LABELS &&
          ` (atajos de teclado para las ${MAXIMUM_KEYBOARD_SHORTCUT_LABELS} primeras)`}
        {' · '}
        <span className="labeler__summary-hint">← → para moverte, 1-9 para etiquetar</span>
      </p>

      {loadingProgress !== null && (
        <p className="labeler__progress" role="status">
          Leyendo fotos: {loadingProgress.loadedCount} / {loadingProgress.totalCount}
        </p>
      )}

      {store.storeErrorMessage && (
        <div className="error banner" role="alert">
          <span className="banner__text">{store.storeErrorMessage}</span>
          <button type="button" className="icon-button" onClick={store.dismissStoreError}>
            <span aria-hidden="true">✕</span>
            <span className="visually-hidden">Descartar el aviso</span>
          </button>
        </div>
      )}

      {gallery.galleryNoticeMessage && (
        <div className="hint banner" role="status">
          <span className="banner__text">{gallery.galleryNoticeMessage}</span>
          <button type="button" className="icon-button" onClick={gallery.dismissGalleryNotice}>
            <span aria-hidden="true">✕</span>
            <span className="visually-hidden">Descartar el aviso</span>
          </button>
        </div>
      )}

      <div className="labeler__workspace">
        <PhotoViewer
          photo={selectedPhoto}
          annotation={selectedPhoto ? store.annotationsByPhotoKey[selectedPhoto.photoKey] : undefined}
          labels={labels}
          photoNumber={selectedPhotoIndex + 1}
          photoCount={photos.length}
          onToggleLabel={handleToggleLabelOnSelectedPhoto}
          onGoToPreviousPhoto={goToPreviousPhoto}
          onGoToNextPhoto={goToNextPhoto}
        />

        <LabelManagerPanel
          labels={labels}
          countPhotosWithLabel={store.countPhotosWithLabel}
          onAddLabel={store.addLabel}
          onRenameLabel={store.renameLabel}
          onDeleteLabel={store.deleteLabel}
        />
      </div>

      <PhotoGalleryStrip
        photos={photos}
        annotationsByPhotoKey={store.annotationsByPhotoKey}
        labels={labels}
        selectedPhotoIndex={selectedPhotoIndex}
        onSelectPhotoAtIndex={selectPhotoAtIndex}
      />

      <p className="labeler__footnote">
        Las fotos se leen en este ordenador y no salen de él. Las etiquetas y las coordenadas se
        guardan en este navegador, así que al volver a abrir una foto ya analizada aparecerán sus
        etiquetas. La galería, en cambio, se vacía al recargar la página.
      </p>

      {isDraggingFiles && <div className="labeler__drop-overlay">Suelta las fotos aquí</div>}
    </main>
  )
}
