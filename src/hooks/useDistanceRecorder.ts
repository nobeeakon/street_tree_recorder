import { useCallback, useEffect, useRef, useState } from 'react'
import { distanceInMetersBetween } from '../lib/geo'
import type { GeographicCoordinates } from '../lib/geo'

/**
 * Watches the device position and fires a capture every time the phone has
 * travelled a set distance from where the last photo was taken.
 */

export interface CapturePosition {
  coordinates: GeographicCoordinates
  accuracyMeters: number
  /** Metres above sea level, or null when the device cannot work out an altitude. */
  altitudeMeters: number | null
  capturedAt: Date
}

export interface DistanceRecorderOptions {
  captureIntervalMeters: number
  /** Fixes worse than this are ignored; a bad fix can jump far enough to fake a capture. */
  maximumAcceptableAccuracyMeters: number
  onCapturePosition: (position: CapturePosition) => Promise<void>
}

/**
 * Why the recording cannot get a position. Kept apart from `errorMessage` — a
 * failure to save one photo is a note at the bottom of the screen, but a walk
 * with no GPS at all takes no photos whatsoever, and that has to interrupt.
 */
export type LocationProblemKind =
  /** The browser has no Geolocation API, so nothing will ever fix this. */
  | 'geolocation-unsupported'
  /** The user, or the operating system, refused access to the position. */
  | 'permission-denied'
  /** The watch is running but no usable fix has arrived yet. */
  | 'no-signal'
  /** Anything the browser reports that does not fall in the cases above. */
  | 'unknown-error'

export interface LocationProblem {
  kind: LocationProblemKind
  /** The browser's own wording; only worth showing for `unknown-error`. */
  browserMessage: string | null
}

export interface DistanceRecorder {
  isRecording: boolean
  photoCount: number
  metersSinceLastPhoto: number | null
  positionAccuracyMeters: number | null
  statusMessage: string
  errorMessage: string | null
  /** Non-null while the recording has no position to work with. */
  locationProblem: LocationProblem | null
  startRecording: () => Promise<void>
  stopRecording: () => void
  dismissLocationProblem: () => void
}

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // Never reuse a cached fix: a stale position would misreport the distance travelled.
  maximumAge: 0,
  timeout: 30_000,
}

/**
 * The Screen Wake Lock API is not in every TypeScript DOM lib, and the app works
 * without it, so it is reached through a narrow structural type.
 */
interface WakeLockSentinelLike {
  release: () => Promise<void>
}
interface WakeLockApiLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

function getWakeLockApi(): WakeLockApiLike | undefined {
  return (navigator as unknown as { wakeLock?: WakeLockApiLike }).wakeLock
}

export function useDistanceRecorder(options: DistanceRecorderOptions): DistanceRecorder {
  const [isRecording, setIsRecording] = useState(false)
  const [photoCount, setPhotoCount] = useState(0)
  const [metersSinceLastPhoto, setMetersSinceLastPhoto] = useState<number | null>(null)
  const [positionAccuracyMeters, setPositionAccuracyMeters] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState('Listo.')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [locationProblem, setLocationProblem] = useState<LocationProblem | null>(null)

  const geolocationWatchIdRef = useRef<number | null>(null)
  const lastCapturedCoordinatesRef = useRef<GeographicCoordinates | null>(null)
  const isCaptureInFlightRef = useRef(false)
  // A dropout after the first fix is a hiccup worth only a status line; never
  // having had a fix at all is what the walker needs to be interrupted about.
  const hasReceivedPositionFixRef = useRef(false)
  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null)

  // Latest options are read through a ref so that changing the interval, or
  // passing a new callback identity, never restarts the position watch.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockSentinelRef.current
    wakeLockSentinelRef.current = null
    if (!sentinel) {
      return
    }
    try {
      await sentinel.release()
    } catch (error) {
      console.warn('Could not release the screen wake lock', error)
    }
  }, [])

  const requestWakeLock = useCallback(async () => {
    const wakeLockApi = getWakeLockApi()
    if (!wakeLockApi) {
      return
    }
    try {
      wakeLockSentinelRef.current = await wakeLockApi.request('screen')
    } catch (error) {
      // Recording still works; the screen will just dim on its own.
      console.warn('Could not keep the screen awake', error)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (geolocationWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(geolocationWatchIdRef.current)
      geolocationWatchIdRef.current = null
    }
    void releaseWakeLock()
    setIsRecording(false)
    setStatusMessage('Detenido.')
  }, [releaseWakeLock])

  const handlePositionError = useCallback(
    (error: GeolocationPositionError) => {
      switch (error.code) {
        case error.PERMISSION_DENIED:
          // Without permission the watch will never report anything, so the
          // recording is over rather than merely waiting.
          setLocationProblem({ kind: 'permission-denied', browserMessage: null })
          stopRecording()
          break
        case error.POSITION_UNAVAILABLE:
          setStatusMessage('Todavía sin señal GPS — esperando una posición…')
          // The watch stays alive: the fix may still arrive, indoors or in a
          // tunnel it just will not arrive yet.
          if (!hasReceivedPositionFixRef.current) {
            setLocationProblem({ kind: 'no-signal', browserMessage: null })
          }
          break
        case error.TIMEOUT:
          setStatusMessage('El GPS tarda en responder — seguimos esperando…')
          if (!hasReceivedPositionFixRef.current) {
            setLocationProblem({ kind: 'no-signal', browserMessage: null })
          }
          break
        default:
          setLocationProblem({ kind: 'unknown-error', browserMessage: error.message })
      }
    },
    [stopRecording],
  )

  const handlePosition = useCallback((position: GeolocationPosition) => {
    const { latitude, longitude, accuracy, altitude } = position.coords
    const { captureIntervalMeters, maximumAcceptableAccuracyMeters } = optionsRef.current

    // Any fix at all means there *is* a location: an open dialog about the
    // missing one has been answered by the GPS itself and can go away.
    hasReceivedPositionFixRef.current = true
    setLocationProblem(null)
    setPositionAccuracyMeters(accuracy)

    // A weak fix can wander hundreds of metres while standing still, which would
    // fire a burst of photos of the same spot. Wait for something trustworthy.
    if (accuracy > maximumAcceptableAccuracyMeters) {
      setStatusMessage(`Esperando una posición GPS más precisa (±${Math.round(accuracy)} m)…`)
      return
    }

    const currentCoordinates: GeographicCoordinates = {
      latitudeDegrees: latitude,
      longitudeDegrees: longitude,
    }
    const lastCapturedCoordinates = lastCapturedCoordinatesRef.current

    if (lastCapturedCoordinates) {
      const metersTravelled = distanceInMetersBetween(lastCapturedCoordinates, currentCoordinates)
      setMetersSinceLastPhoto(metersTravelled)
      if (metersTravelled < captureIntervalMeters) {
        setStatusMessage(
          `${Math.round(metersTravelled)} m de ${captureIntervalMeters} m desde la última foto`,
        )
        return
      }
    }

    // Encoding and saving takes a moment; ignore fixes that land in the meantime
    // rather than queueing several photos of the same place.
    if (isCaptureInFlightRef.current) {
      return
    }
    isCaptureInFlightRef.current = true

    void (async () => {
      try {
        await optionsRef.current.onCapturePosition({
          coordinates: currentCoordinates,
          accuracyMeters: accuracy,
          altitudeMeters: altitude,
          capturedAt: new Date(position.timestamp),
        })
        // Only move the anchor once the photo is actually saved, so a failure
        // retries at the next fix instead of silently skipping 100 m.
        lastCapturedCoordinatesRef.current = currentCoordinates
        setMetersSinceLastPhoto(0)
        setPhotoCount(previousCount => previousCount + 1)
        setStatusMessage('Foto guardada.')
        setErrorMessage(null)
      } catch (captureError) {
        setErrorMessage(
          captureError instanceof Error ? captureError.message : 'No se pudo guardar la foto.',
        )
      } finally {
        isCaptureInFlightRef.current = false
      }
    })()
  }, [])

  const startRecording = useCallback(async () => {
    if (geolocationWatchIdRef.current !== null) {
      return
    }
    if (!('geolocation' in navigator)) {
      setLocationProblem({ kind: 'geolocation-unsupported', browserMessage: null })
      return
    }

    lastCapturedCoordinatesRef.current = null
    hasReceivedPositionFixRef.current = false
    setPhotoCount(0)
    setMetersSinceLastPhoto(null)
    setErrorMessage(null)
    setLocationProblem(null)
    setStatusMessage('Esperando posición GPS…')

    await requestWakeLock()

    geolocationWatchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handlePositionError,
      GEOLOCATION_OPTIONS,
    )
    setIsRecording(true)
  }, [handlePosition, handlePositionError, requestWakeLock])

  /**
   * Closes the dialog while leaving the recording as it is: for a lost signal
   * that means carrying on waiting for the fix that has not arrived yet.
   */
  const dismissLocationProblem = useCallback(() => setLocationProblem(null), [])

  // Never leave a watch or a wake lock behind when the app closes. The guard
  // keeps React's development double-mount from reporting a stop that never
  // happened.
  useEffect(() => {
    return () => {
      if (geolocationWatchIdRef.current !== null) {
        stopRecording()
      }
    }
  }, [stopRecording])

  return {
    isRecording,
    photoCount,
    metersSinceLastPhoto,
    positionAccuracyMeters,
    statusMessage,
    errorMessage,
    locationProblem,
    startRecording,
    stopRecording,
    dismissLocationProblem,
  }
}
