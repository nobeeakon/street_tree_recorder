import { useEffect, useRef } from 'react'
import type { LocationProblem, LocationProblemKind } from '../hooks/useDistanceRecorder'

/**
 * What the recorder says when it cannot get a position.
 *
 * A walk without GPS takes no photos at all, so this is not a note at the edge
 * of the screen: the phone is in a pocket or in a hand pointed at the street,
 * and a line of red text under the controls goes unread until the walk is over
 * and nothing has been saved. A modal stops the walk instead, and carries the
 * one action that fixes each case.
 */

interface ProblemCopy {
  title: string
  body: string
  /** Absent when retrying cannot possibly help. */
  retryLabel: string | null
}

const PROBLEM_COPY: Record<LocationProblemKind, ProblemCopy> = {
  'geolocation-unsupported': {
    title: 'Este navegador no tiene GPS',
    body:
      'No ofrece la API de geolocalización, así que no se puede medir la distancia recorrida. ' +
      'Abre la app en Chrome desde el teléfono para grabar el recorrido.',
    retryLabel: null,
  },
  'permission-denied': {
    title: 'Sin permiso de ubicación',
    body:
      'La grabación necesita el GPS para saber cuándo disparar la cámara. Permite el acceso a ' +
      'la ubicación en los ajustes del navegador (el candado junto a la dirección) y vuelve a empezar.',
    retryLabel: 'Reintentar',
  },
  'no-signal': {
    title: 'Todavía sin señal GPS',
    body:
      'El teléfono aún no consigue una posición. Bajo techo o entre edificios altos puede tardar: ' +
      'sal a cielo abierto y espera unos segundos. La grabación sigue esperando el primer punto.',
    retryLabel: null,
  },
  'unknown-error': {
    title: 'No se pudo obtener la ubicación',
    body: 'El navegador rechazó la petición de posición y la grabación no puede continuar.',
    retryLabel: 'Reintentar',
  },
}

export interface LocationUnavailableDialogProps {
  /** Null closes the dialog; a value opens it. */
  problem: LocationProblem | null
  /** Drives the wording of the dismiss button: waiting reads differently from stopped. */
  isRecording: boolean
  /** Starts the recording over, permissions and all. */
  onRetry: () => void
  /** Closes the dialog and leaves the recording exactly as it is. */
  onDismiss: () => void
}

export function LocationUnavailableDialog({
  problem,
  isRecording,
  onRetry,
  onDismiss,
}: LocationUnavailableDialogProps) {
  const dialogElementRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    if (problem && !dialogElement.open) {
      // showModal() rather than the `open` attribute: only the modal form gets
      // the backdrop, the focus trap and dismissal with Esc.
      dialogElement.showModal()
    } else if (!problem && dialogElement.open) {
      // Reached when a fix finally arrives: the GPS has answered the dialog.
      dialogElement.close()
    }
  }, [problem])

  /**
   * Esc and the backdrop close the dialog without React being told, so the
   * element's own `close` event is what keeps the parent's state honest.
   */
  useEffect(() => {
    const dialogElement = dialogElementRef.current
    if (!dialogElement) {
      return
    }

    dialogElement.addEventListener('close', onDismiss)
    return () => dialogElement.removeEventListener('close', onDismiss)
  }, [onDismiss])

  // The element stays mounted so that opening and closing is one call on it;
  // only the wording depends on which problem is current.
  const copy = problem ? PROBLEM_COPY[problem.kind] : null

  return (
    <dialog
      ref={dialogElementRef}
      className="notice notice--location"
      aria-labelledby="location-problem-title"
    >
      <h2 className="notice__title" id="location-problem-title">
        {copy?.title}
      </h2>
      <p className="notice__body">
        {copy?.body}
        {/* The browser's own wording is the only clue left when the error is
            one we have no name for. */}
        {problem?.browserMessage && (
          <>
            {' '}
            <span className="notice__detail">({problem.browserMessage})</span>
          </>
        )}
      </p>

      <div className="notice__actions">
        <button type="button" className="button button--secondary" onClick={onDismiss}>
          {isRecording ? 'Seguir esperando' : 'Entendido'}
        </button>
        {copy?.retryLabel && (
          <button type="button" className="button button--start" onClick={onRetry}>
            {copy.retryLabel}
          </button>
        )}
      </div>
    </dialog>
  )
}
