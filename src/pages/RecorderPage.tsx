import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { BrowserNoticeDialog } from '../components/BrowserNoticeDialog'
import { LocationUnavailableDialog } from '../components/LocationUnavailableDialog'
import { useCamera } from '../hooks/useCamera'
import { useDistanceRecorder } from '../hooks/useDistanceRecorder'
import type { CapturePosition } from '../hooks/useDistanceRecorder'
import { captureVideoFrameAsJpeg, downloadBlobAsFile } from '../lib/capture'
import { addGpsExifToJpeg } from '../lib/exif'
import { buildPhotoFileName } from '../lib/geo'
import { APP_ROUTE_PATHS } from '../routePaths'

/**
 * How far the phone must travel before the next photo is taken. Short intervals
 * suit a narrow street where every tree matters; long ones cover a whole avenue
 * without filling the phone.
 */
const CAPTURE_INTERVAL_OPTIONS_METERS = [10, 25, 50, 100, 200] as const

/** Roughly one tree per photo at walking pace, which is what the survey wants. */
const DEFAULT_CAPTURE_INTERVAL_METERS = 25

/** Consumer GPS is good to roughly 5-10 m outdoors; anything worse is noise. */
const MAXIMUM_ACCEPTABLE_ACCURACY_METERS = 25

const JPEG_QUALITY = 0.9

export function RecorderPage() {
  const { videoElementRef, isCameraReady, cameraErrorMessage, startCamera } = useCamera()
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [captureIntervalMeters, setCaptureIntervalMeters] = useState<number>(
    DEFAULT_CAPTURE_INTERVAL_METERS,
  )
  /**
   * The whole control panel folds away. On a phone held upright it takes a
   * third of the screen away from the viewfinder, which is the part of the
   * page the walk is actually looking at.
   */
  const [areControlsExpanded, setAreControlsExpanded] = useState(true)

  const capturePositionAsPhoto = useCallback(
    async (position: CapturePosition) => {
      const jpegBlob = await captureVideoFrameAsJpeg(
        videoElementRef.current,
        captureCanvasRef.current,
        JPEG_QUALITY,
      )
      // The position goes in the file name *and* inside the file: the name is easy
      // to read, but only the Exif survives renaming the photo or editing it.
      const geotaggedJpegBlob = await addGpsExifToJpeg(jpegBlob, {
        coordinates: position.coordinates,
        capturedAt: position.capturedAt,
        accuracyMeters: position.accuracyMeters,
        altitudeMeters: position.altitudeMeters,
      })
      downloadBlobAsFile(
        geotaggedJpegBlob,
        buildPhotoFileName(position.coordinates, position.capturedAt),
      )
    },
    [videoElementRef],
  )

  // The recorder reads its options through a ref, so switching interval mid-walk
  // applies at the next GPS fix instead of restarting the position watch.
  const recorderOptions = useMemo(
    () => ({
      captureIntervalMeters,
      maximumAcceptableAccuracyMeters: MAXIMUM_ACCEPTABLE_ACCURACY_METERS,
      onCapturePosition: capturePositionAsPhoto,
    }),
    [captureIntervalMeters, capturePositionAsPhoto],
  )

  const {
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
  } = useDistanceRecorder(recorderOptions)

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    } else {
      void startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  const toggleControls = useCallback(
    () => setAreControlsExpanded(currentlyExpanded => !currentlyExpanded),
    [],
  )

  // Retrying means asking for the permission again, which only a fresh watch
  // does. Stopping first covers the errors that leave the old watch running —
  // startRecording() would otherwise see it and return without doing anything.
  const handleRetryLocation = useCallback(() => {
    dismissLocationProblem()
    stopRecording()
    void startRecording()
  }, [dismissLocationProblem, startRecording, stopRecording])

  const progressFraction =
    metersSinceLastPhoto === null
      ? 0
      : Math.min(1, metersSinceLastPhoto / captureIntervalMeters)

  return (
    <main className="app">
      <BrowserNoticeDialog />

      <LocationUnavailableDialog
        problem={locationProblem}
        isRecording={isRecording}
        onRetry={handleRetryLocation}
        onDismiss={dismissLocationProblem}
      />

      <div className="viewfinder">
        <video
          ref={videoElementRef}
          className="viewfinder__video"
          autoPlay
          muted
          playsInline
        />

        {cameraErrorMessage && (
          <div className="viewfinder__overlay">
            <p className="viewfinder__message">{cameraErrorMessage}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void startCamera()}
            >
              Activar cámara
            </button>
          </div>
        )}

        {!cameraErrorMessage && !isCameraReady && (
          <div className="viewfinder__overlay">
            <p className="viewfinder__message">Iniciando la cámara…</p>
          </div>
        )}

        <div className="counter" aria-live="polite">
          <span className="counter__value">{photoCount}</span>
          <span className="counter__label">{photoCount === 1 ? 'foto' : 'fotos'}</span>
        </div>

        {isRecording && <div className="recording-dot" aria-label="Grabando" />}

        {/* The toggle rides on the preview rather than inside the panel it
            folds: a handle attached to the panel would keep the panel's slot
            in the layout, and the point is to give the preview all of it. */}
        <button
          type="button"
          className={`viewfinder__controls-toggle ${
            areControlsExpanded ? '' : 'viewfinder__controls-toggle--alone'
          }`}
          onClick={toggleControls}
          aria-expanded={areControlsExpanded}
          aria-controls="recorder-controls"
        >
          {areControlsExpanded ? 'Ocultar controles' : 'Mostrar controles'}
        </button>
      </div>

      <section
        className={`controls ${areControlsExpanded ? '' : 'controls--collapsed'}`}
        id="recorder-controls"
      >
        <fieldset className="interval">
          <legend className="interval__legend">Una foto cada</legend>
          <div className="interval__options">
            {CAPTURE_INTERVAL_OPTIONS_METERS.map(optionMeters => (
              <label
                key={optionMeters}
                className={`interval__option ${
                  optionMeters === captureIntervalMeters ? 'interval__option--selected' : ''
                }`}
              >
                <input
                  type="radio"
                  name="capture-interval"
                  className="interval__input"
                  value={optionMeters}
                  checked={optionMeters === captureIntervalMeters}
                  onChange={() => setCaptureIntervalMeters(optionMeters)}
                />
                {optionMeters} m
              </label>
            ))}
          </div>
        </fieldset>

        <div className="readout">
          <p className="readout__status">{statusMessage}</p>
          <p className="readout__detail">
            {positionAccuracyMeters === null
              ? 'Precisión GPS desconocida'
              : `GPS ±${Math.round(positionAccuracyMeters)} m`}
            {metersSinceLastPhoto !== null && ` · ${Math.round(metersSinceLastPhoto)} m recorridos`}
          </p>
          <div className="progress" role="presentation">
            <div className="progress__bar" style={{ width: `${progressFraction * 100}%` }} />
          </div>
        </div>

        {errorMessage && <p className="error">{errorMessage}</p>}

        <button
          type="button"
          className={`button ${isRecording ? 'button--stop' : 'button--start'}`}
          onClick={handleToggleRecording}
          disabled={!isCameraReady}
        >
          {isRecording ? 'Detener grabación' : 'Empezar grabación'}
        </button>

        {/* The other pages are not part of the walk — the labeller is meant for
            a computer — so they get a link rather than a place in the walking UI. */}
        <nav className="controls__links">
          <Link className="page-link" to={APP_ROUTE_PATHS.labeler}>
            Etiquetar fotos en la computadora →
          </Link>
          <Link className="page-link" to={APP_ROUTE_PATHS.home}>
            ← Inicio
          </Link>
        </nav>
      </section>

      {/* Off-screen scratch surface used to encode each frame as a JPEG. */}
      <canvas ref={captureCanvasRef} className="capture-canvas" />
    </main>
  )
}
