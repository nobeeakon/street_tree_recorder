import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { LabelDefinition } from '../../lib/annotationStore'
import { labelColorAt } from '../../lib/labelColors'

/**
 * The label catalogue: the vocabulary of the survey, shared by every photo and
 * kept between sessions.
 *
 * Renaming edits the catalogue entry, so every photo ever labelled with it
 * follows automatically — the annotations only ever hold label ids.
 */
export interface LabelManagerPanelProps {
  labels: readonly LabelDefinition[]
  countPhotosWithLabel: (labelId: string) => number
  onAddLabel: (labelName: string) => void
  onRenameLabel: (labelId: string, newName: string) => void
  onDeleteLabel: (labelId: string) => void
}

export function LabelManagerPanel({
  labels,
  countPhotosWithLabel,
  onAddLabel,
  onRenameLabel,
  onDeleteLabel,
}: LabelManagerPanelProps) {
  const [newLabelName, setNewLabelName] = useState('')
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [editingLabelName, setEditingLabelName] = useState('')

  const handleAddLabel = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (newLabelName.trim() === '') {
        return
      }
      onAddLabel(newLabelName)
      setNewLabelName('')
    },
    [newLabelName, onAddLabel],
  )

  const handleSubmitRename = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (editingLabelId !== null && editingLabelName.trim() !== '') {
        onRenameLabel(editingLabelId, editingLabelName)
      }
      setEditingLabelId(null)
    },
    [editingLabelId, editingLabelName, onRenameLabel],
  )

  const handleDeleteLabel = useCallback(
    (label: LabelDefinition) => {
      const usageCount = countPhotosWithLabel(label.id)
      // Deleting a label rewrites history — it disappears from photos labelled
      // in earlier sessions too — so the count goes in the question.
      const confirmationMessage =
        usageCount === 0
          ? `¿Borrar la etiqueta “${label.name}”?`
          : `“${label.name}” está en ${usageCount} ${usageCount === 1 ? 'foto' : 'fotos'}. Al borrarla desaparecerá de ${usageCount === 1 ? 'esa foto' : 'esas fotos'} y del CSV. ¿Continuar?`

      if (window.confirm(confirmationMessage)) {
        onDeleteLabel(label.id)
      }
    },
    [countPhotosWithLabel, onDeleteLabel],
  )

  return (
    <section className="labels-panel" aria-labelledby="labels-panel-title">
      <h2 className="labels-panel__title" id="labels-panel-title">
        Etiquetas
      </h2>

      <form className="labels-panel__add" onSubmit={handleAddLabel}>
        <input
          type="text"
          className="text-input"
          value={newLabelName}
          onChange={event => setNewLabelName(event.target.value)}
          placeholder="Nueva etiqueta"
          aria-label="Nombre de la nueva etiqueta"
          maxLength={60}
        />
        <button type="submit" className="button button--compact" disabled={newLabelName.trim() === ''}>
          Agregar
        </button>
      </form>

      {labels.length === 0 ? (
        <p className="labels-panel__empty">
          Aún no hay etiquetas. Crea las que necesites: se guardan en este navegador y estarán
          disponibles la próxima vez.
        </p>
      ) : (
        <ul className="labels-panel__list">
          {labels.map((label, labelIndex) => (
            <li key={label.id} className="label-row">
              {editingLabelId === label.id ? (
                <form className="label-row__rename" onSubmit={handleSubmitRename}>
                  <input
                    type="text"
                    className="text-input"
                    value={editingLabelName}
                    onChange={event => setEditingLabelName(event.target.value)}
                    aria-label={`Nuevo nombre para ${label.name}`}
                    maxLength={60}
                    autoFocus
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        setEditingLabelId(null)
                      }
                    }}
                  />
                  <button type="submit" className="button button--compact">
                    Guardar
                  </button>
                  <button
                    type="button"
                    className="button button--compact button--secondary"
                    onClick={() => setEditingLabelId(null)}
                  >
                    Cancelar
                  </button>
                </form>
              ) : (
                <>
                  <span
                    className="label-row__swatch"
                    style={{ backgroundColor: labelColorAt(label.colorIndex) }}
                    aria-hidden="true"
                  />
                  <span className="label-row__name">{label.name}</span>
                  {/* Only the first nine get a shortcut; there are only nine digit keys. */}
                  {labelIndex < 9 && (
                    <kbd className="label-row__shortcut" title="Atajo de teclado">
                      {labelIndex + 1}
                    </kbd>
                  )}
                  <span className="label-row__count" title="Fotos con esta etiqueta">
                    {countPhotosWithLabel(label.id)}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    title={`Renombrar ${label.name}`}
                    onClick={() => {
                      setEditingLabelId(label.id)
                      setEditingLabelName(label.name)
                    }}
                  >
                    <span aria-hidden="true">✎</span>
                    <span className="visually-hidden">Renombrar {label.name}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    title={`Borrar ${label.name}`}
                    onClick={() => handleDeleteLabel(label)}
                  >
                    <span aria-hidden="true">🗑</span>
                    <span className="visually-hidden">Borrar {label.name}</span>
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
