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
  capturedAt: Date
}

export interface DistanceRecorderOptions {
  captureIntervalMeters: number
  /** Fixes worse than this are ignored; a bad fix can jump far enough to fake a capture. */
  maximumAcceptableAccuracyMeters: number
  onCapturePosition: (position: CapturePosition) => Promise<void>
}

export interface DistanceRecorder {
  isRecording: boolean
  photoCount: number
  metersSinceLastPhoto: number | null
  positionAccuracyMeters: number | null
  statusMessage: string
  errorMessage: string | null
  startRecording: () => Promise<void>
  stopRecording: () => void
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

  const geolocationWatchIdRef = useRef<number | null>(null)
  const lastCapturedCoordinatesRef = useRef<GeographicCoordinates | null>(null)
  const isCaptureInFlightRef = useRef(false)
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
          setErrorMessage(
            'Permiso de ubicación denegado. La grabación necesita GPS para saber cuándo disparar.',
          )
          stopRecording()
          break
        case error.POSITION_UNAVAILABLE:
          setStatusMessage('Todavía sin señal GPS — esperando una posición…')
          break
        case error.TIMEOUT:
          setStatusMessage('El GPS tarda en responder — seguimos esperando…')
          break
        default:
          setErrorMessage(`Error de ubicación: ${error.message}`)
      }
    },
    [stopRecording],
  )

  const handlePosition = useCallback((position: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = position.coords
    const { captureIntervalMeters, maximumAcceptableAccuracyMeters } = optionsRef.current

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
          captureError instanceof Error ? captureError.message : 'No se ha podido guardar la foto.',
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
      setErrorMessage(
        'Este navegador no tiene la API de geolocalización, así que no se puede medir la distancia.',
      )
      return
    }

    lastCapturedCoordinatesRef.current = null
    setPhotoCount(0)
    setMetersSinceLastPhoto(null)
    setErrorMessage(null)
    setStatusMessage('Esperando posición GPS…')

    await requestWakeLock()

    geolocationWatchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handlePositionError,
      GEOLOCATION_OPTIONS,
    )
    setIsRecording(true)
  }, [handlePosition, handlePositionError, requestWakeLock])

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
    startRecording,
    stopRecording,
  }
}
