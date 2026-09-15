import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPhotoFromFile, releasePhoto, sortPhotosByCaptureTime } from '../lib/photoLibrary'
import type { LoadedPhoto } from '../lib/photoLibrary'

/**
 * The photos loaded into the labelling session, and the cursor moving through
 * them.
 *
 * Photos live in memory only — the browser cannot hand a `File` back after a
 * reload — so this hook owns their blob URLs and is responsible for revoking
 * every one of them. What survives a reload is the annotations, which are the
 * store's business, not this hook's.
 */
export interface PhotoLoadingProgress {
  loadedCount: number
  totalCount: number
}

export interface PhotoGalleryController {
  photos: readonly LoadedPhoto[]
  selectedPhotoIndex: number
  selectedPhoto: LoadedPhoto | null
  /** Non-null only while files are being read. */
  loadingProgress: PhotoLoadingProgress | null
  galleryNoticeMessage: string | null
  dismissGalleryNotice: () => void
  /** Reads the files and returns only the ones that were actually added. */
  addFiles: (files: readonly File[]) => Promise<readonly LoadedPhoto[]>
  selectPhotoAtIndex: (photoIndex: number) => void
  goToPreviousPhoto: () => void
  goToNextPhoto: () => void
  removeAllPhotos: () => void
}

/** Extensions the file picker may return with an empty MIME type on some systems. */
const IMAGE_FILE_EXTENSION_PATTERN = /\.(jpe?g|png|webp|heic|heif|avif|gif|tiff?)$/i

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_FILE_EXTENSION_PATTERN.test(file.name)
}

function buildLoadSummary(
  addedCount: number,
  duplicateCount: number,
  skippedCount: number,
  failureMessages: readonly string[],
): string | null {
  const parts: string[] = []
  if (addedCount > 0) {
    parts.push(`${addedCount} ${addedCount === 1 ? 'foto añadida' : 'fotos añadidas'}`)
  }
  if (duplicateCount > 0) {
    parts.push(`${duplicateCount} ${duplicateCount === 1 ? 'repetida' : 'repetidas'} (ya estaban en la galería)`)
  }
  if (skippedCount > 0) {
    parts.push(`${skippedCount} ${skippedCount === 1 ? 'archivo omitido' : 'archivos omitidos'} por no ser imágenes`)
  }
  if (failureMessages.length > 0) {
    parts.push(`${failureMessages.length} con errores: ${failureMessages.join(' ')}`)
  }
  return parts.length === 0 ? null : `${parts.join(' · ')}.`
}

export function usePhotoGallery(): PhotoGalleryController {
  const [photos, setPhotos] = useState<readonly LoadedPhoto[]>([])
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(-1)
  const [loadingProgress, setLoadingProgress] = useState<PhotoLoadingProgress | null>(null)
  const [galleryNoticeMessage, setGalleryNoticeMessage] = useState<string | null>(null)

  // Blob URLs are not garbage collected on their own, so the unmount cleanup
  // needs the current list — and an effect depending on `photos` would revoke
  // URLs that are still on screen every time one is added. Every write to
  // `photos` below updates this ref in the same breath.
  const photosRef = useRef<readonly LoadedPhoto[]>([])

  /** Guards against a second batch starting while the first is still reading. */
  const isLoadingRef = useRef(false)

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) {
        releasePhoto(photo)
      }
    }
  }, [])

  const addFiles = useCallback(async (files: readonly File[]): Promise<readonly LoadedPhoto[]> => {
    // Files can also arrive by drag and drop, which the disabled "add" button
    // does not cover; two overlapping reads would each miss the other's photos
    // when checking for duplicates.
    if (isLoadingRef.current) {
      setGalleryNoticeMessage('Espera a que termine la carga en curso antes de añadir más fotos.')
      return []
    }

    const imageFiles = files.filter(isImageFile)
    const skippedCount = files.length - imageFiles.length

    if (imageFiles.length === 0) {
      setGalleryNoticeMessage(buildLoadSummary(0, 0, skippedCount, []))
      return []
    }

    isLoadingRef.current = true
    setLoadingProgress({ loadedCount: 0, totalCount: imageFiles.length })

    const knownPhotoKeys = new Set(photosRef.current.map(photo => photo.photoKey))
    const addedPhotos: LoadedPhoto[] = []
    const failureMessages: string[] = []
    let duplicateCount = 0

    // Sequential rather than parallel: each file is held in memory whole while
    // it is hashed, and a folder of a few hundred photos would otherwise all be
    // resident at once.
    for (const [fileIndex, file] of imageFiles.entries()) {
      try {
        const photo = await loadPhotoFromFile(file)
        if (knownPhotoKeys.has(photo.photoKey)) {
          // The same picture under another name: release the second copy's URL
          // and keep the first, whose annotation is already on screen.
          releasePhoto(photo)
          duplicateCount += 1
        } else {
          knownPhotoKeys.add(photo.photoKey)
          addedPhotos.push(photo)
        }
      } catch (loadError) {
        failureMessages.push(loadError instanceof Error ? loadError.message : `No se ha podido leer «${file.name}».`)
      }
      setLoadingProgress({ loadedCount: fileIndex + 1, totalCount: imageFiles.length })
    }

    isLoadingRef.current = false
    setLoadingProgress(null)
    setGalleryNoticeMessage(buildLoadSummary(addedPhotos.length, duplicateCount, skippedCount, failureMessages))

    if (addedPhotos.length > 0) {
      const previousPhotoCount = photosRef.current.length
      const nextPhotos = sortPhotosByCaptureTime([...photosRef.current, ...addedPhotos])
      photosRef.current = nextPhotos
      setPhotos(nextPhotos)

      // Land on the first of the photos just added, which is where the work is.
      const firstAddedIndex = nextPhotos.findIndex(photo => photo.photoKey === addedPhotos[0].photoKey)
      setSelectedPhotoIndex(previousPhotoCount === 0 ? 0 : Math.max(0, firstAddedIndex))
    }

    return addedPhotos
  }, [])

  const selectPhotoAtIndex = useCallback((photoIndex: number) => {
    setSelectedPhotoIndex(currentIndex => {
      const photoCount = photosRef.current.length
      if (photoCount === 0) {
        return -1
      }
      // Clamped rather than wrapped: reaching the end of the walk should feel
      // like the end of the walk, not a loop back to the first photo.
      const clampedIndex = Math.min(Math.max(photoIndex, 0), photoCount - 1)
      return clampedIndex === currentIndex ? currentIndex : clampedIndex
    })
  }, [])

  const goToPreviousPhoto = useCallback(() => {
    setSelectedPhotoIndex(currentIndex => Math.max(0, currentIndex - 1))
  }, [])

  const goToNextPhoto = useCallback(() => {
    setSelectedPhotoIndex(currentIndex => Math.min(photosRef.current.length - 1, currentIndex + 1))
  }, [])

  const removeAllPhotos = useCallback(() => {
    for (const photo of photosRef.current) {
      releasePhoto(photo)
    }
    photosRef.current = []
    setPhotos([])
    setSelectedPhotoIndex(-1)
    setGalleryNoticeMessage(null)
  }, [])

  const selectedPhoto = selectedPhotoIndex >= 0 ? (photos[selectedPhotoIndex] ?? null) : null

  const dismissGalleryNotice = useCallback(() => setGalleryNoticeMessage(null), [])

  return {
    photos,
    selectedPhotoIndex,
    selectedPhoto,
    loadingProgress,
    galleryNoticeMessage,
    dismissGalleryNotice,
    addFiles,
    selectPhotoAtIndex,
    goToPreviousPhoto,
    goToNextPhoto,
    removeAllPhotos,
  }
}
