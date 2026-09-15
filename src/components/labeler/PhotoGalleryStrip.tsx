import { useEffect, useRef } from 'react'
import type { LabelDefinition, PhotoAnnotation } from '../../lib/annotationStore'
import { labelColorAt } from '../../lib/labelColors'
import type { LoadedPhoto } from '../../lib/photoLibrary'

/**
 * Every photo loaded in the session, in capture order, as a strip under the
 * viewer.
 *
 * Each thumbnail carries the colours of its labels, so an unlabelled stretch of
 * the walk — or one already covered in an earlier session — is visible without
 * stepping through the photos one by one.
 */
export interface PhotoGalleryStripProps {
  photos: readonly LoadedPhoto[]
  annotationsByPhotoKey: Readonly<Record<string, PhotoAnnotation>>
  labels: readonly LabelDefinition[]
  selectedPhotoIndex: number
  onSelectPhotoAtIndex: (photoIndex: number) => void
}

/** How many label dots a thumbnail shows before collapsing into a "+n". */
const MAXIMUM_VISIBLE_LABEL_DOTS = 4

export function PhotoGalleryStrip({
  photos,
  annotationsByPhotoKey,
  labels,
  selectedPhotoIndex,
  onSelectPhotoAtIndex,
}: PhotoGalleryStripProps) {
  const selectedThumbnailRef = useRef<HTMLButtonElement | null>(null)
  const labelsById = new Map(labels.map(label => [label.id, label]))

  useEffect(() => {
    // Arrow keys move the selection past the edge of the strip, so the strip has
    // to follow. 'nearest' keeps it from scrolling when the thumbnail is already
    // in view, which would otherwise jump on every click.
    selectedThumbnailRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedPhotoIndex])

  if (photos.length === 0) {
    return null
  }

  return (
    <section className="gallery" aria-label="Galería de fotos cargadas">
      <ol className="gallery__strip">
        {photos.map((photo, photoIndex) => {
          const isSelected = photoIndex === selectedPhotoIndex
          const appliedLabels = (annotationsByPhotoKey[photo.photoKey]?.labelIds ?? [])
            .map(labelId => labelsById.get(labelId))
            .filter((label): label is LabelDefinition => label !== undefined)
          const hiddenLabelCount = appliedLabels.length - MAXIMUM_VISIBLE_LABEL_DOTS

          return (
            <li key={photo.photoKey} className="gallery__item">
              <button
                ref={isSelected ? selectedThumbnailRef : null}
                type="button"
                className={`thumbnail ${isSelected ? 'thumbnail--selected' : ''}`}
                aria-current={isSelected}
                onClick={() => onSelectPhotoAtIndex(photoIndex)}
                title={`${photo.fileName}${appliedLabels.length > 0 ? ` — ${appliedLabels.map(label => label.name).join(', ')}` : ''}`}
              >
                <img className="thumbnail__image" src={photo.objectUrl} alt="" loading="lazy" />
                <span className="thumbnail__index">{photoIndex + 1}</span>
                {appliedLabels.length > 0 && (
                  <span className="thumbnail__dots">
                    {appliedLabels.slice(0, MAXIMUM_VISIBLE_LABEL_DOTS).map(label => (
                      <span
                        key={label.id}
                        className="thumbnail__dot"
                        style={{ backgroundColor: labelColorAt(label.colorIndex) }}
                      />
                    ))}
                    {hiddenLabelCount > 0 && <span className="thumbnail__more">+{hiddenLabelCount}</span>}
                  </span>
                )}
                <span className="visually-hidden">
                  {photo.fileName}
                  {appliedLabels.length > 0
                    ? `, etiquetas: ${appliedLabels.map(label => label.name).join(', ')}`
                    : ', sin etiquetas'}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
