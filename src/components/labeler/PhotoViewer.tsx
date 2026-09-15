import type { LabelDefinition, PhotoAnnotation } from '../../lib/annotationStore'
import { formatCoordinates, formatIsoTimestamp, formatLocalDateTime } from '../../lib/formatDisplay'
import type { LoadedPhoto } from '../../lib/photoLibrary'
import { LabelChips } from './LabelChips'

/**
 * The photo under analysis: the labels being applied to it, the picture itself,
 * and what its Exif said.
 *
 * The label buttons sit *above* the photo rather than under it: they are the one
 * thing on this page that is clicked hundreds of times, and below a portrait
 * photo they ended up far from the eye and easy to mistake for a read-out of the
 * labels already applied.
 *
 * The labels shown are whatever the store holds for this photo — which is how a
 * picture opened again weeks later arrives with its previous labels already
 * ticked, rather than as a blank slate.
 */
export interface PhotoViewerProps {
  photo: LoadedPhoto | null
  annotation: PhotoAnnotation | undefined
  labels: readonly LabelDefinition[]
  /** 1-based position in the gallery, for the "3 / 120" readout. */
  photoNumber: number
  photoCount: number
  onToggleLabel: (labelId: string) => void
  onGoToPreviousPhoto: () => void
  onGoToNextPhoto: () => void
  onOpenFullScreen: () => void
}

export function PhotoViewer({
  photo,
  annotation,
  labels,
  photoNumber,
  photoCount,
  onToggleLabel,
  onGoToPreviousPhoto,
  onGoToNextPhoto,
  onOpenFullScreen,
}: PhotoViewerProps) {
  if (!photo) {
    return (
      <section className="viewer viewer--empty">
        <p className="viewer__empty-message">
          Selecciona fotos para empezar. Se leen en tu computadora: no se sube nada a ningún lado.
        </p>
      </section>
    )
  }

  const appliedLabelIds = new Set(annotation?.labelIds ?? [])
  const appliedLabelCount = appliedLabelIds.size
  // A photo that already carries labels: worth saying when they were saved,
  // because the ticks above were not necessarily put there a moment ago.
  const hasPreviousLabels = appliedLabelCount > 0

  return (
    <section className="viewer" aria-label="Foto seleccionada">
      <div className="label-bar">
        <div className="label-bar__heading">
          <h2 className="label-bar__title">Etiquetar esta foto</h2>
          <p className="label-bar__hint">
            {labels.length === 0
              ? 'Todavía no hay etiquetas'
              : `Haz clic en una etiqueta o usa las teclas 1-9 · ${appliedLabelCount} aplicada${
                  appliedLabelCount === 1 ? '' : 's'
                }`}
          </p>
        </div>

        {labels.length === 0 ? (
          <p className="label-bar__empty">Crea alguna etiqueta en el panel de la derecha.</p>
        ) : (
          <LabelChips
            labels={labels}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={onToggleLabel}
          />
        )}
      </div>

      <div className="viewer__stage">
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

        <img className="viewer__image" src={photo.objectUrl} alt={photo.fileName} />

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

        <button
          type="button"
          className="viewer__expand"
          onClick={onOpenFullScreen}
          title="Ver la foto a pantalla completa"
        >
          <span aria-hidden="true">⤢</span> Pantalla completa
        </button>

        <p className="viewer__position" aria-live="polite">
          {photoNumber} / {photoCount}
        </p>
      </div>

      {/*
        One line, not a table. The file name and the coordinates are checked in
        passing while the eye is on the photo, so they are set small and muted;
        the terms stay in the markup for screen readers and in `title` for a
        pointer, which is cheaper than spending a row of the page on them.
      */}
      <div className="viewer__details">
        <div className="viewer__identity">
          <span className="viewer__file-name" title={photo.fileName}>
            {photo.fileName}
          </span>
          <dl className="viewer__metadata">
            <div className="viewer__metadata-item">
              <dt className="visually-hidden">Coordenadas</dt>
              <dd title="Coordenadas">{formatCoordinates(photo.coordinates)}</dd>
            </div>
            <div className="viewer__metadata-item">
              <dt className="visually-hidden">Captura</dt>
              <dd title="Fecha de captura">{formatLocalDateTime(photo.capturedAt)}</dd>
            </div>
            {photo.accuracyMeters !== null && (
              <div className="viewer__metadata-item">
                <dt className="visually-hidden">Precisión GPS</dt>
                <dd title="Precisión del GPS">±{Math.round(photo.accuracyMeters)} m</dd>
              </div>
            )}
            {hasPreviousLabels && annotation && (
              <div className="viewer__metadata-item">
                <dt className="visually-hidden">Etiquetas guardadas</dt>
                <dd title="Cuándo se guardaron las etiquetas">
                  guardado {formatIsoTimestamp(annotation.updatedAt)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {photo.metadataWarning && (
          <p className="hint hint--warning" role="note">
            <span aria-hidden="true">⚠</span> {photo.metadataWarning} La foto se puede etiquetar
            igualmente, pero saldrá sin posición en el CSV.
          </p>
        )}
      </div>
    </section>
  )
}
