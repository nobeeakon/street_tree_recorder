import { useEffect, useRef } from 'react'
import type { LabelDefinition, PhotoAnnotation } from '../../lib/annotationStore'
import { labelColorAt } from '../../lib/labelColors'
import type { LoadedPhoto } from '../../lib/photoLibrary'

/**
 * Every photo loaded in the session, as a grid of cards inside a dialog.
 *
 * It is opened on demand rather than living under the viewer: stepping through a
 * walk is done with the arrow keys, and a permanent strip spent screen height —
 * the scarcest thing on this page — on something consulted only when jumping
 * somewhere specific. Opened, it gets the whole window instead of a sliver.
 *
 * Each card carries the colours of its labels, so an unlabelled stretch of the
 * walk — or one already covered in an earlier session — is visible at a glance.
 */
export interface PhotoGalleryDialogProps {
  isOpen: boolean
  photos: readonly LoadedPhoto[]
  annotationsByPhotoKey: Readonly<Record<string, PhotoAnnotation>>
  labels: readonly LabelDefinition[]
  selectedPhotoIndex: number
  /** Picking a card selects that photo; the dialog closes on its own afterwards. */
  onSelectPhotoAtIndex: (photoIndex: number) => void
  onClose: () => void
}

/** How many label dots a card shows before collapsing the rest into a "+n". */
const MAXIMUM_VISIBLE_LABEL_DOTS = 4

export function PhotoGalleryDialog({
  isOpen,
  photos,
  annotationsByPhotoKey,
  labels,
  selectedPhotoIndex,
  onSelectPhotoAtIndex,
  onClose,
}: PhotoGalleryDialogProps) {
  const dialogElementRef = useRef<HTMLDialogElement | null>(null)
  const selectedCardRef = useRef<HTMLButtonElement | null>(null)
  const labelsById = new Map(labels.map(label => [label.id, label]))

  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    if (isOpen && !dialogElement.open) {
      // showModal() rather than the `open` attribute: only the modal form gets
      // the backdrop, the focus trap and dismissal with Esc.
      dialogElement.showModal()
      // A gallery of a few hundred photos opens wherever the eye left off, not
      // at the top. 'instant' because the dialog has only just appeared.
      selectedCardRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    } else if (!isOpen && dialogElement.open) {
      dialogElement.close()
    }
  }, [isOpen])

  /**
   * Esc and the backdrop close the dialog without React being told, so the
   * element's own `close` event is what keeps the parent's flag honest.
   */
  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    dialogElement.addEventListener('close', onClose)
    return () => dialogElement.removeEventListener('close', onClose)
  }, [onClose])

  const handleSelectPhoto = (photoIndex: number) => {
    onSelectPhotoAtIndex(photoIndex)
    onClose()
  }

  return (
    <dialog
      ref={dialogElementRef}
      className="gallery-dialog"
      aria-labelledby="gallery-dialog-title"
    >
      <header className="gallery-dialog__header">
        <h2 className="gallery-dialog__title" id="gallery-dialog-title">
          Galería de la sesión
        </h2>
        <p className="gallery-dialog__count">
          {photos.length} {photos.length === 1 ? 'foto' : 'fotos'}
        </p>
        <button
          type="button"
          className="icon-button gallery-dialog__close"
          onClick={onClose}
          title="Cerrar la galería (Esc)"
        >
          <span aria-hidden="true">✕</span>
          <span className="visually-hidden">Cerrar la galería</span>
        </button>
      </header>

      {photos.length === 0 ? (
        <p className="gallery-dialog__empty">
          Todavía no has agregado fotos a esta sesión.
        </p>
      ) : (
        <ol className="gallery-dialog__grid">
          {photos.map((photo, photoIndex) => {
            const isSelected = photoIndex === selectedPhotoIndex
            const appliedLabels = (annotationsByPhotoKey[photo.photoKey]?.labelIds ?? [])
              .map(labelId => labelsById.get(labelId))
              .filter((label): label is LabelDefinition => label !== undefined)
            const hiddenLabelCount = appliedLabels.length - MAXIMUM_VISIBLE_LABEL_DOTS
            const appliedLabelNames = appliedLabels.map(label => label.name).join(', ')

            return (
              <li key={photo.photoKey}>
                <button
                  ref={isSelected ? selectedCardRef : null}
                  type="button"
                  className={`photo-card ${isSelected ? 'photo-card--selected' : ''}`}
                  aria-current={isSelected}
                  onClick={() => handleSelectPhoto(photoIndex)}
                  title={`${photo.fileName}${appliedLabels.length > 0 ? ` — ${appliedLabelNames}` : ''}`}
                >
                  <span className="photo-card__frame">
                    <img
                      className="photo-card__image"
                      src={photo.objectUrl}
                      alt=""
                      loading="lazy"
                    />
                    <span className="photo-card__index">{photoIndex + 1}</span>
                    {appliedLabels.length > 0 && (
                      <span className="photo-card__dots">
                        {appliedLabels.slice(0, MAXIMUM_VISIBLE_LABEL_DOTS).map(label => (
                          <span
                            key={label.id}
                            className="photo-card__dot"
                            style={{ backgroundColor: labelColorAt(label.colorIndex) }}
                          />
                        ))}
                        {hiddenLabelCount > 0 && (
                          <span className="photo-card__more">+{hiddenLabelCount}</span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="photo-card__name">{photo.fileName}</span>
                  <span className="visually-hidden">
                    {appliedLabels.length > 0
                      ? `Etiquetas: ${appliedLabelNames}`
                      : 'Sin etiquetas'}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </dialog>
  )
}
