import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Owns the rear-camera MediaStream and its lifecycle: request it on mount,
 * attach it to a <video> element, and stop every track on unmount so the
 * camera indicator goes out.
 */
export interface CameraController {
  videoElementRef: RefObject<HTMLVideoElement | null>
  isCameraReady: boolean
  cameraErrorMessage: string | null
  /** Retry after a denial; must be called from a user gesture on some browsers. */
  startCamera: () => Promise<void>
}

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    // "ideal" rather than "exact" so the app still works on a laptop webcam.
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
}

function describeCameraFailure(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Permiso de cámara denegado. Actívalo en los ajustes del sitio e inténtalo de nuevo.'
      case 'NotFoundError':
        return 'No se ha encontrado ninguna cámara en este dispositivo.'
      case 'NotReadableError':
        return 'La cámara ya la está usando otra aplicación.'
      default:
        return `No se ha podido iniciar la cámara (${error.name}).`
    }
  }
  return error instanceof Error ? error.message : 'No se ha podido iniciar la cámara.'
}

export function useCamera(): CameraController {
  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const isUnmountedRef = useRef(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null)

  const startCamera = useCallback(async () => {
    if (mediaStreamRef.current) {
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraErrorMessage(
        'Este navegador no expone la API de cámara. La página debe servirse por HTTPS (o localhost).',
      )
      return
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)

      // The component may have unmounted while the permission prompt was open;
      // dropping the stream here prevents a camera that stays on forever.
      if (isUnmountedRef.current) {
        for (const track of mediaStream.getTracks()) {
          track.stop()
        }
        return
      }

      mediaStreamRef.current = mediaStream
      const videoElement = videoElementRef.current
      if (videoElement) {
        videoElement.srcObject = mediaStream
        try {
          await videoElement.play()
        } catch (playbackError) {
          // The stream is live even if autoplay was refused, so this is a hint,
          // not a failure worth blocking the UI over.
          console.warn('The camera preview did not autoplay', playbackError)
        }
      }

      setIsCameraReady(true)
      setCameraErrorMessage(null)
    } catch (error) {
      setIsCameraReady(false)
      setCameraErrorMessage(describeCameraFailure(error))
    }
  }, [])

  useEffect(() => {
    isUnmountedRef.current = false
    // Requesting the camera IS synchronising with an external system, and the
    // state updates happen after the permission prompt resolves, not during
    // this render pass.
    // oxlint-disable-next-line react/set-state-in-effect
    void startCamera()

    return () => {
      isUnmountedRef.current = true
      const mediaStream = mediaStreamRef.current
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) {
          track.stop()
        }
        mediaStreamRef.current = null
      }
    }
  }, [startCamera])

  return { videoElementRef, isCameraReady, cameraErrorMessage, startCamera }
}
