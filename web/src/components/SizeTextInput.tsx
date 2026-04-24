import type { CSSProperties, KeyboardEvent } from 'react'
import { applySizeSeparator, normalizeSizeInput } from '../utils/sizeFormat'

export default function SizeTextInput({
  value,
  onChange,
  className = 'input',
  placeholder = 'e.g. 6 X 6.5',
  style,
  onEnter,
}: {
  value: string
  onChange: (next: string) => void
  className?: string
  placeholder?: string
  style?: CSSProperties
  onEnter?: () => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (['x', 'X', '*', ' '].includes(event.key)) {
      event.preventDefault()
      onChange(applySizeSeparator(value))
      return
    }
    if (event.key === 'Enter' && onEnter) {
      onEnter()
    }
  }

  return (
    <input
      type="text"
      className={className}
      style={style}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(normalizeSizeInput(event.target.value))}
      onKeyDown={handleKeyDown}
    />
  )
}
