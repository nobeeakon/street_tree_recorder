/**
 * Turning the files picked in the labelling page into something the gallery can
 * show and the store can key on.
 *
 * Each file is read once and used twice: hashed, to get the identity the
 * annotations hang off, and parsed for Exif, to recover the position the
 * recorder wrote into it.
 */

import { readExifMetadataFromImage } from './exifReader'
import type { PhotoRegistration } from './annotationStore'
import type { GeographicCoordinates } from './geo'

export class PhotoLoadError extends Error {
  override name = 'PhotoLoadError'
}

/** A photo held in memory for this session, alongside what its bytes said about it. */
export interface LoadedPhoto {
  /** Content hash: the same picture always produces the same key. */
  photoKey: string
  fileName: string
  fileSizeBytes: number
  /** Blob URL for the <img>; must be revoked when the photo leaves the gallery. */
  objectUrl: string
  coordinates: GeographicCoordinates | null
  altitudeMeters: number | null
  accuracyMeters: number | null
  capturedAt: Date | null
  /** Set when the file loaded but told us less than expected, e.g. no GPS. */
  metadataWarning: string | null
}

/**
 * Half a SHA-256 — 16 bytes, 32 hex characters. Long enough that a collision
 * across a survey of a few million photos is not worth thinking about, short
 * enough to keep the stored database readable.
 */
const PHOTO_KEY_HEX_LENGTH = 32

function toHexString(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The identity of a photo, derived from its contents so that renaming a file,
 * copying it or downloading it twice all lead back to the same annotation.
 *
 * `crypto.subtle` needs a secure context. The app is served over HTTPS (or
 * localhost), but a plain-http preview would otherwise lose every previous
 * label, so there is a fallback on the file's own attributes — weaker, since it
 * breaks on rename, but better than treating each load as a new photo.
 */
async function computePhotoKey(fileBytes: Uint8Array<ArrayBuffer>, file: File): Promise<string> {
  if (!crypto.subtle) {
    return `name:${file.name}:${file.size}:${file.lastModified}`
  }

  const digestBuffer = await crypto.subtle.digest('SHA-256', fileBytes)
  return `sha256:${toHexString(new Uint8Array(digestBuffer)).slice(0, PHOTO_KEY_HEX_LENGTH)}`
}

function describeMissingMetadata(hasCoordinates: boolean, hasCaptureTime: boolean): string | null {
  if (!hasCoordinates && !hasCaptureTime) {
    return 'Sin coordenadas ni fecha en los metadatos EXIF.'
  }
  if (!hasCoordinates) {
    return 'Sin coordenadas en los metadatos EXIF.'
  }
  if (!hasCaptureTime) {
    return 'Sin fecha de captura en los metadatos EXIF.'
  }
  return null
}

/**
 * Reads one file into a `LoadedPhoto`. The Exif parse is best-effort: a photo
 * with broken metadata still belongs in the gallery, it just cannot contribute
 * coordinates to the export.
 */
export async function loadPhotoFromFile(file: File): Promise<LoadedPhoto> {
  // The concrete ArrayBuffer type matters: crypto.subtle rejects a view that
  // might sit on a SharedArrayBuffer.
  let fileBytes: Uint8Array<ArrayBuffer>
  try {
    fileBytes = new Uint8Array(await file.arrayBuffer())
  } catch (readError) {
    throw new PhotoLoadError(
      `No se pudo leer “${file.name}”: ${readError instanceof Error ? readError.message : 'motivo desconocido'}.`,
    )
  }

  const photoKey = await computePhotoKey(fileBytes, file)

  let coordinates: GeographicCoordinates | null = null
  let altitudeMeters: number | null = null
  let accuracyMeters: number | null = null
  let capturedAt: Date | null = null
  let metadataWarning: string | null = null

  try {
    const exifMetadata = readExifMetadataFromImage(fileBytes)
    coordinates = exifMetadata.coordinates
    altitudeMeters = exifMetadata.altitudeMeters
    accuracyMeters = exifMetadata.accuracyMeters
    capturedAt = exifMetadata.capturedAt
    metadataWarning = describeMissingMetadata(coordinates !== null, capturedAt !== null)
  } catch (exifError) {
    metadataWarning = `Metadatos EXIF ilegibles: ${exifError instanceof Error ? exifError.message : 'motivo desconocido'}`
  }

  return {
    photoKey,
    fileName: file.name,
    fileSizeBytes: file.size,
    objectUrl: URL.createObjectURL(file),
    coordinates,
    altitudeMeters,
    accuracyMeters,
    capturedAt,
    metadataWarning,
  }
}

export function toPhotoRegistration(photo: LoadedPhoto): PhotoRegistration {
  return {
    photoKey: photo.photoKey,
    fileName: photo.fileName,
    fileSizeBytes: photo.fileSizeBytes,
    latitudeDegrees: photo.coordinates?.latitudeDegrees ?? null,
    longitudeDegrees: photo.coordinates?.longitudeDegrees ?? null,
    altitudeMeters: photo.altitudeMeters,
    capturedAt: photo.capturedAt?.toISOString() ?? null,
  }
}

export function releasePhoto(photo: LoadedPhoto): void {
  URL.revokeObjectURL(photo.objectUrl)
}

/** Photos sort by capture time so the gallery follows the walk, not the file picker. */
export function sortPhotosByCaptureTime(photos: readonly LoadedPhoto[]): LoadedPhoto[] {
  return [...photos].sort((first, second) => {
    const firstTime = first.capturedAt?.getTime() ?? Number.POSITIVE_INFINITY
    const secondTime = second.capturedAt?.getTime() ?? Number.POSITIVE_INFINITY
    // Undated photos fall to the end, where they stay in file-name order.
    return firstTime === secondTime ? first.fileName.localeCompare(second.fileName) : firstTime - secondTime
  })
}
