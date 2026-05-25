import type { ButtonHTMLAttributes, ReactNode } from 'react'

type LoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  loadingText?: ReactNode
  leadingIcon?: ReactNode
}

export default function LoadingButton({
  loading = false,
  loadingText,
  leadingIcon,
  disabled,
  children,
  className = 'btn',
  ...props
}: LoadingButtonProps) {
  const content = loading && loadingText !== undefined ? loadingText : children

  return (
    <button
      {...props}
      className={className}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="save-spinner" aria-hidden="true" /> : leadingIcon}
      {content}
    </button>
  )
}
