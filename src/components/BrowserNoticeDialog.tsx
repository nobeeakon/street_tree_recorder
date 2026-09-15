import { useEffect, useRef } from 'react'

/**
 * The notice that greets every launch: unattended saving only works in Chrome,
 * which is something to find out before a walk rather than after one, and the
 * download prompt that interrupts the second photo is easier to accept when it
 * has been announced.
 */
export function BrowserNoticeDialog() {
  const dialogElementRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    // showModal() rather than the `open` attribute: only the modal form gets the
    // backdrop, the focus trap and dismissal with Esc.
    dialogElementRef.current?.showModal()
  }, [])

  return (
    <dialog ref={dialogElementRef} className="notice" aria-labelledby="notice-title">
      <h2 className="notice__title" id="notice-title">
        Antes de empezar
      </h2>
      <p className="notice__body">
        Usa <strong>Chrome</strong>: es el navegador que permite guardar las fotos
        automáticamente. En la segunda foto pedirá permiso para descargar varios archivos —
        acéptalo y a partir de ahí se guardarán solas.
      </p>
      {/* A dialog form closes its dialog on submit, with no JavaScript involved. */}
      <form method="dialog" className="notice__form">
        <button type="submit" className="button button--secondary notice__dismiss">
          Entendido
        </button>
      </form>
    </dialog>
  )
}
