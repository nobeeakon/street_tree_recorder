import type { LabelDefinition, PhotoAnnotation } from '../../lib/annotationStore'
import { formatCoordinates, formatIsoTimestamp, formatLocalDateTime } from '../../lib/formatDisplay'
import { labelColorAt } from '../../lib/labelColors'
import type { LoadedPhoto } from '../../lib/photoLibrary'

/**
 * The photo under analysis: the picture itself, what its Exif said, and the
 * labels being applied to it.
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
  // A photo whose labels predate this session: worth pointing out, because the
  // ticks below were not put there a moment ago.
  const hasPreviousLabels = appliedLabelIds.size > 0

  return (
    <section className="viewer" aria-label="Foto seleccionada">
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

        <p className="viewer__position" aria-live="polite">
          {photoNumber} / {photoCount}
        </p>
      </div>

      <div className="viewer__details">
        <h2 className="viewer__file-name" title={photo.fileName}>
          {photo.fileName}
        </h2>
        <dl className="viewer__metadata">
          <div className="viewer__metadata-item">
            <dt>Coordenadas</dt>
            <dd>{formatCoordinates(photo.coordinates)}</dd>
          </div>
          <div className="viewer__metadata-item">
            <dt>Captura</dt>
            <dd>{formatLocalDateTime(photo.capturedAt)}</dd>
          </div>
          {photo.accuracyMeters !== null && (
            <div className="viewer__metadata-item">
              <dt>Precisión GPS</dt>
              <dd>±{Math.round(photo.accuracyMeters)} m</dd>
            </div>
          )}
          {hasPreviousLabels && annotation && (
            <div className="viewer__metadata-item">
              <dt>Etiquetas guardadas</dt>
              <dd>{formatIsoTimestamp(annotation.updatedAt)}</dd>
            </div>
          )}
        </dl>

        {photo.metadataWarning && (
          <p className="hint hint--warning" role="note">
            <span aria-hidden="true">⚠</span> {photo.metadataWarning} La foto se puede etiquetar
            igualmente, pero saldrá sin posición en el CSV.
          </p>
        )}

        {labels.length === 0 ? (
          <p className="viewer__no-labels">Crea alguna etiqueta en el panel de la derecha.</p>
        ) : (
          <div className="chips" role="group" aria-label="Etiquetas de esta foto">
            {labels.map((label, labelIndex) => {
              const isApplied = appliedLabelIds.has(label.id)
              const labelColor = labelColorAt(label.colorIndex)
              return (
                <button
                  key={label.id}
                  type="button"
                  className={`chip ${isApplied ? 'chip--applied' : ''}`}
                  aria-pressed={isApplied}
                  onClick={() => onToggleLabel(label.id)}
                  style={
                    isApplied
                      ? { backgroundColor: labelColor, borderColor: labelColor }
                      : { borderColor: labelColor }
                  }
                  title={labelIndex < 9 ? `${label.name} (tecla ${labelIndex + 1})` : label.name}
                >
                  {label.name}
                  {labelIndex < 9 && <kbd className="chip__shortcut">{labelIndex + 1}</kbd>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
