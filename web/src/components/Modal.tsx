import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  containerClassName?: string
  panelClassName?: string
  overlayClassName?: string
  overlayStyle?: CSSProperties
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
}

export default function Modal({
  open,
  onClose,
  children,
  containerClassName = '',
  panelClassName = '',
  overlayClassName = '',
  overlayStyle,
  closeOnOverlayClick = true,
  closeOnEscape = true,
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeOnEscape, onClose])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className={`fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-4 ${containerClassName}`.trim()}>
      <div
        className={`absolute inset-0 ${overlayClassName}`.trim()}
        style={overlayStyle ?? { background: 'rgba(15, 23, 42, 0.46)' }}
        onClick={closeOnOverlayClick ? onClose : undefined}
      />
      <div
        className={`relative w-full max-h-[calc(100svh-24px)] overflow-y-auto sm:max-h-[calc(100svh-32px)] ${panelClassName}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
