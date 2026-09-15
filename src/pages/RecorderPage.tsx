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
   * The interval picker and the links to the other pages fold away behind one
   * summary row. On a phone held upright they are the difference between a
   * viewfinder that fills the screen and one squeezed into the top half, and
   * they are only touched between walks.
   */
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(true)

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
      // Once the walk starts the settings have been chosen; the screen is worth
      // more as viewfinder than as a panel of things nobody is about to change.
      setIsSettingsExpanded(false)
      void startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  const toggleSettings = useCallback(
    () => setIsSettingsExpanded(currentlyExpanded => !currentlyExpanded),
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
      </div>

      <section className={`controls ${isSettingsExpanded ? '' : 'controls--collapsed'}`}>
        {/* The summary doubles as the reading of the setting it hides, so the
            collapsed panel still answers "how often is this shooting?". */}
        <button
          type="button"
          className="controls__summary"
          onClick={toggleSettings}
          aria-expanded={isSettingsExpanded}
          aria-controls="recorder-settings recorder-links"
        >
          <span className="controls__summary-text">
            Una foto cada <strong>{captureIntervalMeters} m</strong>
          </span>
          <span className="controls__summary-chevron" aria-hidden="true">
            ▲
          </span>
        </button>

        <fieldset className="interval" id="recorder-settings">
          <legend className="interval__legend">Distancia entre fotos</legend>
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
        <nav className="controls__links" id="recorder-links">
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
