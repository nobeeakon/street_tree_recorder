/**
 * The survey database: the label catalogue and one annotation per photo, kept in
 * `localStorage` so a labelling session survives a reload and, more importantly,
 * so a photo re-opened weeks later still shows the labels it was given.
 *
 * ## Why the schema looks like this
 *
 * **Photos are identified by content, not by name.** `photoKey` is a hash of the
 * file's bytes (see [photoLibrary.ts](./photoLibrary.ts)), so the same photo is
 * recognised after it has been renamed, copied to another folder or downloaded
 * again. Re-analysing a picture is therefore just a matter of loading the file:
 * its previous labels come back with it.
 *
 * **Labels are referenced by id, never by name.** The catalogue holds the names;
 * an annotation holds only ids. Renaming "Tree" to "Árbol" updates every photo
 * ever labelled with it, and two labels may share a name without merging. The
 * CSV export resolves the ids to names at export time, so it always reflects the
 * current catalogue.
 *
 * **The photo's own metadata is copied into the annotation.** Coordinates and
 * capture time are read from Exif once, on load, and stored alongside the label
 * ids. That is what makes the CSV exportable without the image files — the store
 * keeps the survey data, not the pictures.
 *
 * Image bytes are deliberately *not* stored: they are large, and the browser
 * cannot hand back a `File` after a reload anyway. The gallery is emptied by a
 * refresh; the labels are not.
 */

/** Bumped whenever the shape below changes in a way older data cannot satisfy. */
export const ANNOTATION_SCHEMA_VERSION = 1

const STORAGE_KEY = 'street-recorder.annotations.v1'

export class AnnotationStoreError extends Error {
  override name = 'AnnotationStoreError'
}

export interface LabelDefinition {
  /** Stable identity; survives renaming, and is what annotations point at. */
  id: string
  name: string
  /** Index into the labeller's palette, so a label keeps its colour when renamed. */
  colorIndex: number
  /** ISO 8601, UTC. */
  createdAt: string
}

export interface PhotoAnnotation {
  /** Content hash of the image file; see the module comment. */
  photoKey: string
  /** The most recent name the file was seen under, for the CSV and the gallery. */
  fileName: string
  fileSizeBytes: number
  latitudeDegrees: number | null
  longitudeDegrees: number | null
  altitudeMeters: number | null
  /** ISO 8601, UTC; the Exif capture instant when the photo carried one. */
  capturedAt: string | null
  /** Ids from the catalogue. Order is the order they were applied in. */
  labelIds: string[]
  /** ISO 8601, UTC; when the labels were last touched. */
  updatedAt: string
  /** ISO 8601, UTC; when this photo was first loaded into the labeller. */
  firstAnalyzedAt: string
}

export interface AnnotationDatabase {
  schemaVersion: number
  labels: LabelDefinition[]
  annotationsByPhotoKey: Record<string, PhotoAnnotation>
}

export function createEmptyAnnotationDatabase(): AnnotationDatabase {
  return { schemaVersion: ANNOTATION_SCHEMA_VERSION, labels: [], annotationsByPhotoKey: {} }
}

// --- Validation ------------------------------------------------------------

/*
 * `localStorage` is plain text the user (or another tab, or an older build of
 * this app) can have written anything into, so nothing read back is trusted.
 * Each field is checked, and anything that fails is dropped rather than allowed
 * to crash a render deep inside the gallery.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseLabelDefinition(value: unknown): LabelDefinition | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asNonEmptyString(value.id)
  const name = asNonEmptyString(value.name)
  if (!id || !name) {
    return null
  }

  return {
    id,
    name,
    colorIndex: asFiniteNumberOrNull(value.colorIndex) ?? 0,
    createdAt: asNonEmptyString(value.createdAt) ?? new Date().toISOString(),
  }
}

function parsePhotoAnnotation(value: unknown, knownLabelIds: ReadonlySet<string>): PhotoAnnotation | null {
  if (!isRecord(value)) {
    return null
  }

  const photoKey = asNonEmptyString(value.photoKey)
  if (!photoKey) {
    return null
  }

  const storedLabelIds = Array.isArray(value.labelIds) ? value.labelIds : []
  const updatedAt = asNonEmptyString(value.updatedAt) ?? new Date().toISOString()

  return {
    photoKey,
    fileName: asNonEmptyString(value.fileName) ?? photoKey,
    fileSizeBytes: asFiniteNumberOrNull(value.fileSizeBytes) ?? 0,
    latitudeDegrees: asFiniteNumberOrNull(value.latitudeDegrees),
    longitudeDegrees: asFiniteNumberOrNull(value.longitudeDegrees),
    altitudeMeters: asFiniteNumberOrNull(value.altitudeMeters),
    capturedAt: asNonEmptyString(value.capturedAt),
    // Ids whose label has been deleted are dropped here, which is what keeps a
    // stale id from showing up as a blank chip in the UI or the CSV.
    labelIds: storedLabelIds.filter(
      (labelId): labelId is string => typeof labelId === 'string' && knownLabelIds.has(labelId),
    ),
    updatedAt,
    firstAnalyzedAt: asNonEmptyString(value.firstAnalyzedAt) ?? updatedAt,
  }
}

function parseAnnotationDatabase(value: unknown): AnnotationDatabase {
  if (!isRecord(value)) {
    throw new AnnotationStoreError('Los datos guardados no tienen el formato esperado.')
  }

  const schemaVersion = asFiniteNumberOrNull(value.schemaVersion)
  if (schemaVersion !== ANNOTATION_SCHEMA_VERSION) {
    throw new AnnotationStoreError(
      `Los datos guardados son de otra versión del esquema (${String(value.schemaVersion)}, se esperaba ${ANNOTATION_SCHEMA_VERSION}).`,
    )
  }

  const labels = (Array.isArray(value.labels) ? value.labels : [])
    .map(parseLabelDefinition)
    .filter((label): label is LabelDefinition => label !== null)
  const knownLabelIds = new Set(labels.map(label => label.id))

  const annotationsByPhotoKey: Record<string, PhotoAnnotation> = {}
  const storedAnnotations = isRecord(value.annotationsByPhotoKey) ? value.annotationsByPhotoKey : {}
  for (const storedAnnotation of Object.values(storedAnnotations)) {
    const annotation = parsePhotoAnnotation(storedAnnotation, knownLabelIds)
    if (annotation) {
      annotationsByPhotoKey[annotation.photoKey] = annotation
    }
  }

  return { schemaVersion: ANNOTATION_SCHEMA_VERSION, labels, annotationsByPhotoKey }
}

// --- Persistence -----------------------------------------------------------

/**
 * Reads the database back. An empty or absent entry is a first run, not a
 * failure; unreadable contents throw, so the caller can tell the user their data
 * could not be opened instead of silently starting from scratch on top of it.
 */
export function loadAnnotationDatabase(): AnnotationDatabase {
  let serialisedDatabase: string | null
  try {
    serialisedDatabase = window.localStorage.getItem(STORAGE_KEY)
  } catch (storageError) {
    // Thrown by browsers that block storage entirely (some private modes).
    throw new AnnotationStoreError(
      `El navegador no permite leer el almacenamiento local: ${storageError instanceof Error ? storageError.message : 'motivo desconocido'}.`,
    )
  }

  if (serialisedDatabase === null || serialisedDatabase === '') {
    return createEmptyAnnotationDatabase()
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(serialisedDatabase)
  } catch (parseError) {
    throw new AnnotationStoreError(
      `Los datos guardados no son JSON válido: ${parseError instanceof Error ? parseError.message : 'motivo desconocido'}.`,
    )
  }

  return parseAnnotationDatabase(parsedJson)
}

export function saveAnnotationDatabase(database: AnnotationDatabase): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
  } catch (storageError) {
    const isQuotaExceeded = storageError instanceof DOMException && storageError.name === 'QuotaExceededError'
    throw new AnnotationStoreError(
      isQuotaExceeded
        ? 'No queda espacio en el almacenamiento local. Exporta el CSV y borra los datos para seguir.'
        : `No se han podido guardar los datos: ${storageError instanceof Error ? storageError.message : 'motivo desconocido'}.`,
    )
  }
}

export function clearAnnotationDatabase(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (storageError) {
    throw new AnnotationStoreError(
      `No se han podido borrar los datos: ${storageError instanceof Error ? storageError.message : 'motivo desconocido'}.`,
    )
  }
}

// --- Pure operations -------------------------------------------------------

/*
 * Every mutation returns a new database rather than editing one in place: React
 * state updates depend on the identity change, and it keeps the persistence
 * layer a single "save whatever came out" call.
 */

function createIdentifier(): string {
  // randomUUID needs a secure context, which the app always has in practice
  // (HTTPS or localhost); the fallback keeps a plain-http preview working.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `label-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function findLabelByName(
  database: AnnotationDatabase,
  labelName: string,
): LabelDefinition | undefined {
  const normalisedName = labelName.trim().toLocaleLowerCase()
  return database.labels.find(label => label.name.toLocaleLowerCase() === normalisedName)
}

export function addLabelToDatabase(
  database: AnnotationDatabase,
  labelName: string,
  colorIndex: number,
): AnnotationDatabase {
  const trimmedName = labelName.trim()
  if (trimmedName === '') {
    throw new AnnotationStoreError('La etiqueta necesita un nombre.')
  }
  if (findLabelByName(database, trimmedName)) {
    throw new AnnotationStoreError(`Ya existe una etiqueta llamada «${trimmedName}».`)
  }

  const newLabel: LabelDefinition = {
    id: createIdentifier(),
    name: trimmedName,
    colorIndex,
    createdAt: new Date().toISOString(),
  }

  return { ...database, labels: [...database.labels, newLabel] }
}

export function renameLabelInDatabase(
  database: AnnotationDatabase,
  labelId: string,
  newName: string,
): AnnotationDatabase {
  const trimmedName = newName.trim()
  if (trimmedName === '') {
    throw new AnnotationStoreError('La etiqueta necesita un nombre.')
  }

  const clashingLabel = findLabelByName(database, trimmedName)
  if (clashingLabel && clashingLabel.id !== labelId) {
    throw new AnnotationStoreError(`Ya existe una etiqueta llamada «${trimmedName}».`)
  }

  return {
    ...database,
    labels: database.labels.map(label => (label.id === labelId ? { ...label, name: trimmedName } : label)),
  }
}

/** Removes the label and every reference to it; annotations themselves survive. */
export function deleteLabelFromDatabase(database: AnnotationDatabase, labelId: string): AnnotationDatabase {
  const annotationsByPhotoKey: Record<string, PhotoAnnotation> = {}
  const deletedAt = new Date().toISOString()

  for (const [photoKey, annotation] of Object.entries(database.annotationsByPhotoKey)) {
    annotationsByPhotoKey[photoKey] = annotation.labelIds.includes(labelId)
      ? {
          ...annotation,
          labelIds: annotation.labelIds.filter(id => id !== labelId),
          updatedAt: deletedAt,
        }
      : annotation
  }

  return {
    ...database,
    labels: database.labels.filter(label => label.id !== labelId),
    annotationsByPhotoKey,
  }
}

export function countPhotosLabelledWith(database: AnnotationDatabase, labelId: string): number {
  return Object.values(database.annotationsByPhotoKey).filter(annotation =>
    annotation.labelIds.includes(labelId),
  ).length
}

/** The metadata a freshly loaded file brings with it, before any labelling. */
export interface PhotoRegistration {
  photoKey: string
  fileName: string
  fileSizeBytes: number
  latitudeDegrees: number | null
  longitudeDegrees: number | null
  altitudeMeters: number | null
  capturedAt: string | null
}

/**
 * Records that these photos have been opened for analysis, refreshing the
 * metadata of ones already known while leaving their labels untouched — that is
 * the path a re-analysed picture takes back into the session.
 */
export function registerPhotosInDatabase(
  database: AnnotationDatabase,
  registrations: readonly PhotoRegistration[],
): AnnotationDatabase {
  if (registrations.length === 0) {
    return database
  }

  const registeredAt = new Date().toISOString()
  const annotationsByPhotoKey = { ...database.annotationsByPhotoKey }

  for (const registration of registrations) {
    const existingAnnotation = annotationsByPhotoKey[registration.photoKey]
    annotationsByPhotoKey[registration.photoKey] = {
      ...registration,
      labelIds: existingAnnotation?.labelIds ?? [],
      updatedAt: existingAnnotation?.updatedAt ?? registeredAt,
      firstAnalyzedAt: existingAnnotation?.firstAnalyzedAt ?? registeredAt,
    }
  }

  return { ...database, annotationsByPhotoKey }
}

export function toggleLabelOnPhotoInDatabase(
  database: AnnotationDatabase,
  photoKey: string,
  labelId: string,
): AnnotationDatabase {
  const annotation = database.annotationsByPhotoKey[photoKey]
  if (!annotation) {
    throw new AnnotationStoreError('La foto no está registrada, así que no se le puede etiquetar.')
  }
  if (!database.labels.some(label => label.id === labelId)) {
    throw new AnnotationStoreError('Esa etiqueta ya no existe.')
  }

  const hasLabel = annotation.labelIds.includes(labelId)
  return {
    ...database,
    annotationsByPhotoKey: {
      ...database.annotationsByPhotoKey,
      [photoKey]: {
        ...annotation,
        labelIds: hasLabel
          ? annotation.labelIds.filter(id => id !== labelId)
          : [...annotation.labelIds, labelId],
        updatedAt: new Date().toISOString(),
      },
    },
  }
}
