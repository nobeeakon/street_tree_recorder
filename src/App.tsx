import { useCallback, useMemo, useRef } from 'react'
import './App.css'
import { useCamera } from './hooks/useCamera'
import { useDistanceRecorder } from './hooks/useDistanceRecorder'
import type { CapturePosition } from './hooks/useDistanceRecorder'
import { useIsPortraitOrientation } from './hooks/useIsPortraitOrientation'
import { captureVideoFrameAsJpeg, downloadBlobAsFile } from './lib/capture'
import { buildPhotoFileName } from './lib/geo'

/** How far the phone must travel before the next photo is taken. */
const CAPTURE_INTERVAL_METERS = 100

/** Consumer GPS is good to roughly 5-10 m outdoors; anything worse is noise. */
const MAXIMUM_ACCEPTABLE_ACCURACY_METERS = 25

const JPEG_QUALITY = 0.9

function App() {
  const { videoElementRef, isCameraReady, cameraErrorMessage, startCamera } = useCamera()
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isPortraitOrientation = useIsPortraitOrientation()

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
      captureIntervalMeters: CAPTURE_INTERVAL_METERS,
      maximumAcceptableAccuracyMeters: MAXIMUM_ACCEPTABLE_ACCURACY_METERS,
      onCapturePosition: capturePositionAsPhoto,
    }),
    [capturePositionAsPhoto],
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

  const progressFraction =
    metersSinceLastPhoto === null
      ? 0
      : Math.min(1, metersSinceLastPhoto / CAPTURE_INTERVAL_METERS)

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

        <button
          type="button"
          className={`button ${isRecording ? 'button--stop' : 'button--start'}`}
          onClick={handleToggleRecording}
          disabled={!isCameraReady}
        >
          {isRecording ? 'Detener grabación' : 'Empezar grabación'}
        </button>

        <p className="browser-note">
          Una foto cada {CAPTURE_INTERVAL_METERS} m. Usa <strong>Chrome</strong>: es el navegador
          que permite guardar las fotos automáticamente.
        </p>
      </section>

      {/* Off-screen scratch surface used to encode each frame as a JPEG. */}
      <canvas ref={captureCanvasRef} className="capture-canvas" />
    </main>
  )
}

export default App
