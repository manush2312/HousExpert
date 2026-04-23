import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronsUpDown, Search } from 'lucide-react'

export interface SearchableOption {
  value: string
  label: string
  keywords?: string[]
}

interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  options: SearchableOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
  style?: CSSProperties
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search options…',
  emptyMessage = 'No matches found',
  disabled = false,
  className = '',
  style,
}: SearchableSelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const selectedOption = options.find((option) => option.value === value) ?? null

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return options

    return options.filter((option) => {
      const haystack = [option.label, ...(option.keywords ?? [])].join(' ').toLowerCase()
      return haystack.includes(normalized)
    })
  }, [options, query])

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return

      const width = Math.max(rect.width, 220)
      const viewportPadding = 12
      const gap = 8
      const menuMaxHeight = 320
      const belowSpace = window.innerHeight - rect.bottom - viewportPadding - gap
      const aboveSpace = rect.top - viewportPadding - gap
      const openAbove = belowSpace < 220 && aboveSpace > belowSpace
      const availableHeight = Math.max(
        160,
        Math.min(menuMaxHeight, openAbove ? aboveSpace : belowSpace),
      )
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
      )

      setMenuStyle({
        position: 'fixed',
        top: openAbove ? 'auto' : rect.bottom + gap,
        bottom: openAbove ? window.innerHeight - rect.top + gap : 'auto',
        left,
        width,
        maxHeight: availableHeight,
      })
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !(target instanceof Element && target.closest('.searchable-select-menu'))) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`input searchable-select-trigger ${!selectedOption ? 'searchable-select-empty' : ''} ${className}`.trim()}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selectedOption?.label || placeholder}</span>
        <ChevronsUpDown size={14} className="searchable-select-trigger-icon" />
      </button>

      {open && createPortal(
        <div className="searchable-select-menu" style={menuStyle}>
          <div className="searchable-select-search">
            <Search size={14} className="searchable-select-search-icon" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="searchable-select-search-input"
            />
          </div>

          <div className="searchable-select-options" role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="searchable-select-empty-state">{emptyMessage}</div>
            ) : (
              filteredOptions.map((option) => {
                const active = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                    className={`searchable-select-option ${active ? 'searchable-select-option-active' : ''}`.trim()}
                  >
                    <span className="truncate">{option.label}</span>
                    {active && <Check size={13} className="searchable-select-option-check" />}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
