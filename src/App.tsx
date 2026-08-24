import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'
import { useCamera } from './hooks/useCamera'
import { useDistanceRecorder } from './hooks/useDistanceRecorder'
import type { CapturePosition } from './hooks/useDistanceRecorder'
import { useIsPortraitOrientation } from './hooks/useIsPortraitOrientation'
import { captureVideoFrameAsJpeg, downloadBlobAsFile } from './lib/capture'
import { buildPhotoFileName } from './lib/geo'

const DEFAULT_CAPTURE_INTERVAL_METERS = 100
const MINIMUM_CAPTURE_INTERVAL_METERS = 10
const MAXIMUM_CAPTURE_INTERVAL_METERS = 5000

/** Consumer GPS is good to roughly 5-10 m outdoors; anything worse is noise. */
const MAXIMUM_ACCEPTABLE_ACCURACY_METERS = 25

const JPEG_QUALITY = 0.9

function App() {
  const { videoElementRef, isCameraReady, cameraErrorMessage, startCamera } = useCamera()
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isPortraitOrientation = useIsPortraitOrientation()
  const [captureIntervalMeters, setCaptureIntervalMeters] = useState(
    DEFAULT_CAPTURE_INTERVAL_METERS,
  )

  const capturePositionAsPhoto = useCallback(
    async (position: CapturePosition) => {
      const jpegBlob = await captureVideoFrameAsJpeg(
        videoElementRef.current,
        captureCanvasRef.current,
        JPEG_QUALITY,
      )
      downloadBlobAsFile(jpegBlob, buildPhotoFileName(position.coordinates, position.capturedAt))
    },
    [videoElementRef],
  )

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
    startRecording,
    stopRecording,
  } = useDistanceRecorder(recorderOptions)

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    } else {
      void startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  const handleIntervalChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsedInterval = Number.parseInt(event.target.value, 10)
    if (Number.isNaN(parsedInterval)) {
      return
    }
    setCaptureIntervalMeters(
      Math.min(
        MAXIMUM_CAPTURE_INTERVAL_METERS,
        Math.max(MINIMUM_CAPTURE_INTERVAL_METERS, parsedInterval),
      ),
    )
  }, [])

  const progressFraction =
    metersSinceLastPhoto === null
      ? 0
      : Math.min(1, metersSinceLastPhoto / captureIntervalMeters)

  return (
    <main className="app">
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

      <section className="controls">
        {isPortraitOrientation && (
          <p className="hint" role="note">
            <span aria-hidden="true">↻</span> Gira el teléfono en horizontal: las fotos se hacen
            con el móvil apaisado.
          </p>
        )}

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

        <label className="interval">
          <span className="interval__label">Hacer una foto cada</span>
          <input
            className="interval__input"
            type="number"
            inputMode="numeric"
            min={MINIMUM_CAPTURE_INTERVAL_METERS}
            max={MAXIMUM_CAPTURE_INTERVAL_METERS}
            step={10}
            value={captureIntervalMeters}
            onChange={handleIntervalChange}
            disabled={isRecording}
          />
          <span className="interval__label">metros</span>
        </label>

        <button
          type="button"
          className={`button ${isRecording ? 'button--stop' : 'button--start'}`}
          onClick={handleToggleRecording}
          disabled={!isCameraReady}
        >
          {isRecording ? 'Detener grabación' : 'Empezar grabación'}
        </button>
      </section>

      {/* Off-screen scratch surface used to encode each frame as a JPEG. */}
      <canvas ref={captureCanvasRef} className="capture-canvas" />
    </main>
  )
}

export default App
