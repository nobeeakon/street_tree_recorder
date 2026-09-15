import { useCallback, useMemo, useRef, useState } from 'react'
import {
  addLabelToDatabase,
  AnnotationStoreError,
  clearAnnotationDatabase,
  countPhotosLabelledWith,
  createEmptyAnnotationDatabase,
  deleteLabelFromDatabase,
  loadAnnotationDatabase,
  registerPhotosInDatabase,
  renameLabelInDatabase,
  saveAnnotationDatabase,
  toggleLabelOnPhotoInDatabase,
} from '../lib/annotationStore'
import type { AnnotationDatabase, LabelDefinition, PhotoAnnotation, PhotoRegistration } from '../lib/annotationStore'
import { nextLabelColorIndex } from '../lib/labelColors'

/**
 * React's view of the annotation database: the state, and one method per
 * mutation the labelling page offers.
 *
 * Every mutation writes through to `localStorage` immediately. Waiting for an
 * idle moment would be cheaper, but the whole point of the store is that a
 * closed tab loses nothing, and the data is small enough that a synchronous
 * write per click is not noticeable.
 *
 * Failures — a rejected write, a duplicate label name — surface through
 * `storeErrorMessage` instead of throwing: they are all conditions the user can
 * see and act on, and none of them should take the page down. A failed mutation
 * leaves the previous state untouched, so what is on screen always matches what
 * is stored.
 */
export interface AnnotationStoreController {
  labels: readonly LabelDefinition[]
  annotationsByPhotoKey: Readonly<Record<string, PhotoAnnotation>>
  /** Photos on record, including ones not currently loaded in the gallery. */
  storedPhotoCount: number
  storeErrorMessage: string | null
  dismissStoreError: () => void
  addLabel: (labelName: string) => void
  renameLabel: (labelId: string, newName: string) => void
  deleteLabel: (labelId: string) => void
  countPhotosWithLabel: (labelId: string) => number
  registerPhotos: (registrations: readonly PhotoRegistration[]) => void
  toggleLabelOnPhoto: (photoKey: string, labelId: string) => void
  clearAllStoredData: () => void
  /** The database itself, for the CSV export. */
  database: AnnotationDatabase
}

function describeStoreFailure(error: unknown): string {
  if (error instanceof AnnotationStoreError) {
    return error.message
  }
  return error instanceof Error ? error.message : 'Error desconocido al guardar los datos.'
}

export function useAnnotationStore(): AnnotationStoreController {
  // The initial read happens once, lazily, and a corrupt store leaves the page
  // usable with an empty database plus a visible explanation of what was lost.
  const [initialState] = useState<{ database: AnnotationDatabase; errorMessage: string | null }>(() => {
    try {
      return { database: loadAnnotationDatabase(), errorMessage: null }
    } catch (loadError) {
      return {
        database: createEmptyAnnotationDatabase(),
        errorMessage: `${describeStoreFailure(loadError)} Se empieza con una base vacía; los datos anteriores siguen en el navegador hasta que guardes algo.`,
      }
    }
  })

  const [database, setDatabase] = useState<AnnotationDatabase>(initialState.database)
  const [storeErrorMessage, setStoreErrorMessage] = useState<string | null>(initialState.errorMessage)

  // The mutations below run from event handlers and have to both write to
  // storage and report failures, neither of which belongs inside a state
  // updater callback — so the current database is read from a ref instead.
  const databaseRef = useRef<AnnotationDatabase>(initialState.database)

  /**
   * Applies a pure mutation, persists the result and adopts it — or keeps the
   * current state and reports why the change did not happen.
   */
  const applyMutation = useCallback((mutate: (current: AnnotationDatabase) => AnnotationDatabase) => {
    try {
      const nextDatabase = mutate(databaseRef.current)
      saveAnnotationDatabase(nextDatabase)
      databaseRef.current = nextDatabase
      setDatabase(nextDatabase)
      setStoreErrorMessage(null)
    } catch (mutationError) {
      setStoreErrorMessage(describeStoreFailure(mutationError))
    }
  }, [])

  const addLabel = useCallback(
    (labelName: string) => {
      applyMutation(current => addLabelToDatabase(current, labelName, nextLabelColorIndex(current.labels.length)))
    },
    [applyMutation],
  )

  const renameLabel = useCallback(
    (labelId: string, newName: string) => {
      applyMutation(current => renameLabelInDatabase(current, labelId, newName))
    },
    [applyMutation],
  )

  const deleteLabel = useCallback(
    (labelId: string) => {
      applyMutation(current => deleteLabelFromDatabase(current, labelId))
    },
    [applyMutation],
  )

  const registerPhotos = useCallback(
    (registrations: readonly PhotoRegistration[]) => {
      applyMutation(current => registerPhotosInDatabase(current, registrations))
    },
    [applyMutation],
  )

  const toggleLabelOnPhoto = useCallback(
    (photoKey: string, labelId: string) => {
      applyMutation(current => toggleLabelOnPhotoInDatabase(current, photoKey, labelId))
    },
    [applyMutation],
  )

  const clearAllStoredData = useCallback(() => {
    try {
      clearAnnotationDatabase()
      const emptyDatabase = createEmptyAnnotationDatabase()
      databaseRef.current = emptyDatabase
      setDatabase(emptyDatabase)
      setStoreErrorMessage(null)
    } catch (clearError) {
      setStoreErrorMessage(describeStoreFailure(clearError))
    }
  }, [])

  const countPhotosWithLabel = useCallback(
    (labelId: string) => countPhotosLabelledWith(database, labelId),
    [database],
  )

  const storedPhotoCount = useMemo(
    () => Object.keys(database.annotationsByPhotoKey).length,
    [database],
  )

  const dismissStoreError = useCallback(() => setStoreErrorMessage(null), [])

  return {
    labels: database.labels,
    annotationsByPhotoKey: database.annotationsByPhotoKey,
    storedPhotoCount,
    storeErrorMessage,
    dismissStoreError,
    addLabel,
    renameLabel,
    deleteLabel,
    countPhotosWithLabel,
    registerPhotos,
    toggleLabelOnPhoto,
    clearAllStoredData,
    database,
  }
}
