/**
 * Turning the live camera preview into a JPEG file on the device.
 *
 * A browser cannot write into the phone's photo gallery, so each frame is handed
 * to the browser's download machinery instead. On Chrome the first automatic
 * download raises a one-time "allow multiple downloads" prompt for the site;
 * after that every capture lands in Downloads silently.
 */

export class FrameCaptureError extends Error {
  override name = 'FrameCaptureError'
}

/**
 * Draws the current video frame onto the canvas and encodes it as a JPEG.
 * The canvas is resized to the camera's native resolution so nothing is scaled.
 */
export function captureVideoFrameAsJpeg(
  videoElement: HTMLVideoElement | null,
  canvasElement: HTMLCanvasElement | null,
  jpegQuality: number,
): Promise<Blob> {
  if (!videoElement || !canvasElement) {
    throw new FrameCaptureError('La vista previa de la cámara todavía no está lista.')
  }

  const frameWidth = videoElement.videoWidth
  const frameHeight = videoElement.videoHeight
  if (frameWidth === 0 || frameHeight === 0) {
    throw new FrameCaptureError('La cámara todavía no ha producido ningún fotograma.')
  }

  canvasElement.width = frameWidth
  canvasElement.height = frameHeight

  const drawingContext = canvasElement.getContext('2d')
  if (!drawingContext) {
    throw new FrameCaptureError('No se ha podido obtener el contexto de dibujo 2D del canvas.')
  }
  drawingContext.drawImage(videoElement, 0, 0, frameWidth, frameHeight)

  return new Promise<Blob>((resolve, reject) => {
    canvasElement.toBlob(
      encodedBlob => {
        if (encodedBlob) {
          resolve(encodedBlob)
        } else {
          reject(new FrameCaptureError('El navegador no ha podido codificar el fotograma como JPEG.'))
        }
      },
      'image/jpeg',
      jpegQuality,
    )
  })
}

/** How long to keep a blob URL alive before freeing it; downloads start immediately. */
const BLOB_URL_LIFETIME_MILLISECONDS = 10_000

/** Saves a blob to the device's download folder under the given file name. */
export function downloadBlobAsFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const downloadAnchor = document.createElement('a')
  downloadAnchor.href = objectUrl
  downloadAnchor.download = fileName
  downloadAnchor.rel = 'noopener'

  document.body.append(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()

  // Revoking straight away can cancel an in-flight download, so release the
  // memory on a delay instead of immediately.
  setTimeout(() => URL.revokeObjectURL(objectUrl), BLOB_URL_LIFETIME_MILLISECONDS)
}
