import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EXPORT_EVERYTHING_FILTER, filterAnnotationsByLabels } from '../../lib/annotationCsv'
import type { AnnotationLabelFilter, LabelFilterMatchMode } from '../../lib/annotationCsv'
import type { LabelDefinition, PhotoAnnotation } from '../../lib/annotationStore'
import { labelColorAt } from '../../lib/labelColors'

/**
 * The step between "Exportar CSV" and the file landing in Downloads.
 *
 * It exists for two things the old one-click download could not do. The first is
 * to say where the file can be *looked at*: a column of coordinates means
 * nothing until it is on a map, and geojson.io reads this CSV as it stands —
 * which nobody would guess from a download button. The second is to narrow the
 * export to a few labels, because a survey of a whole neighbourhood is usually
 * handed over one problem at a time.
 */

/** Reads a CSV with `latitude`/`longitude` columns straight into a map. */
export const GEOJSON_IO_URL = 'https://geojson.io/'

export interface ExportCsvDialogProps {
  isOpen: boolean
  labels: readonly LabelDefinition[]
  /** Every photo on record, which is what an unfiltered export contains. */
  annotations: readonly PhotoAnnotation[]
  /** Writes the file; the dialog closes itself afterwards. */
  onExport: (filter: AnnotationLabelFilter) => void
  onClose: () => void
}

export function ExportCsvDialog({
  isOpen,
  labels,
  annotations,
  onExport,
  onClose,
}: ExportCsvDialogProps) {
  const dialogElementRef = useRef<HTMLDialogElement | null>(null)
  const [checkedLabelIds, setCheckedLabelIds] = useState<ReadonlySet<string>>(new Set())
  const [matchMode, setMatchMode] = useState<LabelFilterMatchMode>('any')

  /**
   * Taken from the catalogue rather than from the checked set, so a label
   * deleted while the dialog was closed drops out of the filter on its own and
   * the ids stay in catalogue order — the order the chips are read in.
   */
  const selectedLabelIds = useMemo(
    () => labels.filter(label => checkedLabelIds.has(label.id)).map(label => label.id),
    [checkedLabelIds, labels],
  )

  const filter = useMemo<AnnotationLabelFilter>(
    () => (selectedLabelIds.length === 0 ? EXPORT_EVERYTHING_FILTER : { selectedLabelIds, matchMode }),
    [matchMode, selectedLabelIds],
  )

  const matchingAnnotations = useMemo(
    () => filterAnnotationsByLabels(annotations, filter),
    [annotations, filter],
  )

  /** How many photos carry each label, so the chips say what they are worth. */
  const photoCountByLabelId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const annotation of annotations) {
      for (const labelId of annotation.labelIds) {
        counts.set(labelId, (counts.get(labelId) ?? 0) + 1)
      }
    }
    return counts
  }, [annotations])

  /* Rows without coordinates are perfectly valid survey data, but they are the
     ones that will be missing from the map — worth saying before the trip to
     geojson.io rather than after it. */
  const photosWithoutCoordinatesCount = matchingAnnotations.filter(
    annotation => annotation.latitudeDegrees === null || annotation.longitudeDegrees === null,
  ).length

  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    if (isOpen && !dialogElement.open) {
      // showModal() rather than the `open` attribute: only the modal form gets
      // the backdrop, the focus trap and dismissal with Esc.
      dialogElement.showModal()
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

  const toggleLabelInFilter = useCallback((labelId: string) => {
    setCheckedLabelIds(currentlyChecked => {
      const nextChecked = new Set(currentlyChecked)
      if (!nextChecked.delete(labelId)) {
        nextChecked.add(labelId)
      }
      return nextChecked
    })
  }, [])

  const clearFilter = useCallback(() => setCheckedLabelIds(new Set()), [])

  const handleExport = useCallback(() => {
    onExport(filter)
    onClose()
  }, [filter, onClose, onExport])

  const isFiltered = selectedLabelIds.length > 0

  return (
    <dialog ref={dialogElementRef} className="export-dialog" aria-labelledby="export-dialog-title">
      <header className="export-dialog__header">
        <h2 className="export-dialog__title" id="export-dialog-title">
          Exportar CSV
        </h2>
        <button
          type="button"
          className="icon-button export-dialog__close"
          onClick={onClose}
          title="Cerrar (Esc)"
        >
          <span aria-hidden="true">✕</span>
          <span className="visually-hidden">Cerrar</span>
        </button>
      </header>

      <p className="hint export-dialog__map-hint">
        <span aria-hidden="true">🗺️</span>
        <span>
          Para ver los puntos en un mapa, abre{' '}
          <a
            className="page-link"
            href={GEOJSON_IO_URL}
            target="_blank"
            rel="noreferrer"
            // Opening a new tab from a dialog is a surprise unless it is announced.
            title="Se abre en una pestaña nueva"
          >
            geojson.io
          </a>{' '}
          y pulsa <strong>«Import»</strong> para cargar el archivo descargado.
        </span>
      </p>

      <fieldset className="export-dialog__filter">
        <legend className="export-dialog__legend">Filtrar por etiquetas</legend>

        {labels.length === 0 ? (
          <p className="export-dialog__note">
            Todavía no hay etiquetas: se exportarán todas las fotos guardadas.
          </p>
        ) : (
          <>
            <p className="export-dialog__note">
              Sin marcar nada se exportan <strong>todas</strong> las fotos guardadas.
            </p>

            <div className="chips" role="group" aria-label="Etiquetas que se exportan">
              {labels.map(label => {
                const isChecked = checkedLabelIds.has(label.id)
                const labelColor = labelColorAt(label.colorIndex)
                const photoCount = photoCountByLabelId.get(label.id) ?? 0
                return (
                  <label
                    key={label.id}
                    className={`chip ${isChecked ? 'chip--applied' : ''}`}
                    style={
                      isChecked
                        ? { backgroundColor: labelColor, borderColor: labelColor }
                        : { borderColor: labelColor }
                    }
                    title={`${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'} con “${label.name}”`}
                  >
                    {/* The native checkbox stays in the DOM for the keyboard and
                        for screen readers; the chip around it is the visible one. */}
                    <input
                      type="checkbox"
                      className="visually-hidden"
                      checked={isChecked}
                      onChange={() => toggleLabelInFilter(label.id)}
                    />
                    <span className="chip__state" aria-hidden="true">
                      {isChecked ? '✓' : ''}
                    </span>
                    <span className="chip__name">{label.name}</span>
                    <span className="chip__shortcut">{photoCount}</span>
                  </label>
                )
              })}
            </div>

            {/* Only a second label makes the question meaningful. The shared
                `name` is what groups the radios; an explicit role="radiogroup"
                would expect role="radio" children. */}
            {selectedLabelIds.length > 1 && (
              <div className="export-dialog__modes">
                <label className="export-dialog__mode">
                  <input
                    type="radio"
                    name="export-match-mode"
                    checked={matchMode === 'any'}
                    onChange={() => setMatchMode('any')}
                  />
                  Con <strong>alguna</strong> de las marcadas
                </label>
                <label className="export-dialog__mode">
                  <input
                    type="radio"
                    name="export-match-mode"
                    checked={matchMode === 'all'}
                    onChange={() => setMatchMode('all')}
                  />
                  Con <strong>todas</strong> las marcadas
                </label>
              </div>
            )}
          </>
        )}
      </fieldset>

      {photosWithoutCoordinatesCount > 0 && (
        <p className="export-dialog__warning" role="status">
          {photosWithoutCoordinatesCount}{' '}
          {photosWithoutCoordinatesCount === 1
            ? 'de las fotos que se exportan no tiene coordenadas y no aparecerá'
            : 'de las fotos que se exportan no tienen coordenadas y no aparecerán'}{' '}
          en el mapa.
        </p>
      )}

      <footer className="export-dialog__footer">
        {isFiltered && (
          <button type="button" className="button button--compact button--secondary" onClick={clearFilter}>
            Quitar filtro
          </button>
        )}
        <button
          type="button"
          className="button button--compact button--start export-dialog__download"
          onClick={handleExport}
          disabled={matchingAnnotations.length === 0}
          title={
            matchingAnnotations.length === 0
              ? 'Ninguna foto coincide con el filtro'
              : 'Descarga el CSV con las fotos que coinciden'
          }
        >
          Descargar CSV
        </button>
      </footer>
    </dialog>
  )
}
