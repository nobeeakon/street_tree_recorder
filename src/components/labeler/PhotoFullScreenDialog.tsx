import { useEffect, useRef } from 'react'
import type { LabelDefinition, PhotoAnnotation } from '../../lib/annotationStore'
import type { LoadedPhoto } from '../../lib/photoLibrary'
import { LabelChips } from './LabelChips'

/**
 * The photo on the whole screen, with the same label buttons and the same
 * stepping as the page behind it.
 *
 * Judging a tree from a photo sometimes needs every pixel the screen has — a
 * thin trunk, a barely visible wound — and the workspace gives a third of its
 * width to the label catalogue. This is that same work, without the furniture:
 * nothing here can be done that cannot be done on the page.
 *
 * The page's own arrow and digit shortcuts keep working while this is open,
 * because they listen on the window and the dialog's keys bubble up to it. That
 * is deliberate: stepping and tagging must not change meaning depending on which
 * view is in front.
 */
export interface PhotoFullScreenDialogProps {
  isOpen: boolean
  photo: LoadedPhoto | null
  annotation: PhotoAnnotation | undefined
  labels: readonly LabelDefinition[]
  /** 1-based position in the gallery, for the "3 / 120" readout. */
  photoNumber: number
  photoCount: number
  onToggleLabel: (labelId: string) => void
  onGoToPreviousPhoto: () => void
  onGoToNextPhoto: () => void
  onClose: () => void
}

export function PhotoFullScreenDialog({
  isOpen,
  photo,
  annotation,
  labels,
  photoNumber,
  photoCount,
  onToggleLabel,
  onGoToPreviousPhoto,
  onGoToNextPhoto,
  onClose,
}: PhotoFullScreenDialogProps) {
  const dialogElementRef = useRef<HTMLDialogElement | null>(null)
  const appliedLabelIds = new Set(annotation?.labelIds ?? [])

  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    // `photo` is part of the condition, not just `isOpen`: emptying the gallery
    // while this is open would otherwise leave a full screen of nothing.
    const shouldBeOpen = isOpen && photo !== null
    if (shouldBeOpen && !dialogElement.open) {
      // showModal() rather than the `open` attribute: only the modal form gets
      // the backdrop, the focus trap and dismissal with Esc.
      dialogElement.showModal()
    } else if (!shouldBeOpen && dialogElement.open) {
      dialogElement.close()
    }
  }, [isOpen, photo])

  /**
   * Esc closes the dialog without React being told, so the element's own `close`
   * event is what keeps the parent's flag honest.
   */
  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    dialogElement.addEventListener('close', onClose)
    return () => dialogElement.removeEventListener('close', onClose)
  }, [onClose])

  return (
    <dialog ref={dialogElementRef} className="full-screen" aria-label="Foto a pantalla completa">
      {photo && (
        <>
          <header className="full-screen__bar">
            <p className="full-screen__file-name" title={photo.fileName}>
              {photo.fileName}
            </p>
            <p className="full-screen__position" aria-live="polite">
              {photoNumber} / {photoCount}
            </p>
            <button
              type="button"
              className="full-screen__close"
              onClick={onClose}
              title="Salir de pantalla completa (Esc)"
            >
              <span aria-hidden="true">✕</span>
              <span className="visually-hidden">Salir de pantalla completa</span>
            </button>
          </header>

          {labels.length > 0 && (
            <div className="full-screen__labels">
              <LabelChips
                labels={labels}
                appliedLabelIds={appliedLabelIds}
                onToggleLabel={onToggleLabel}
              />
            </div>
          )}

          <div className="full-screen__stage">
            <button
              type="button"
              className="viewer__step viewer__step--previous"
              onClick={onGoToPreviousPhoto}
              disabled={photoNumber <= 1}
              title="Foto anterior (←)"
            >
              <span aria-hidden="true">‹</span>
              <span className="visually-hidden">Foto anterior</span>
            </button>

            <img className="full-screen__image" src={photo.objectUrl} alt={photo.fileName} />

            <button
              type="button"
              className="viewer__step viewer__step--next"
              onClick={onGoToNextPhoto}
              disabled={photoNumber >= photoCount}
              title="Foto siguiente (→)"
            >
              <span aria-hidden="true">›</span>
              <span className="visually-hidden">Foto siguiente</span>
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
