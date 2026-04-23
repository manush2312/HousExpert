import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  disabled = false,
  className = '',
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseDate(value) ?? new Date()))

  const selectedDate = useMemo(() => parseDate(value), [value])

  useEffect(() => {
    if (!value) return
    const parsed = parseDate(value)
    if (parsed) setViewMonth(startOfMonth(parsed))
  }, [value])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const days = useMemo(() => buildCalendarDays(viewMonth), [viewMonth])

  const handleSelect = (date: Date) => {
    onChange(toDateKey(date))
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="date-picker">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`input date-picker-trigger ${!value ? 'date-picker-empty' : ''} ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{selectedDate ? formatDisplayDate(selectedDate) : placeholder}</span>
        <CalendarDays size={15} className="date-picker-trigger-icon" />
      </button>

      {open && (
        <div className="date-picker-popover" role="dialog" aria-label="Choose date">
          <div className="date-picker-header">
            <button
              type="button"
              className="date-picker-nav"
              onClick={() => setViewMonth((current) => addMonths(current, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="date-picker-title">
              {viewMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </div>
            <button
              type="button"
              className="date-picker-nav"
              onClick={() => setViewMonth((current) => addMonths(current, 1))}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="date-picker-weekdays">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="date-picker-grid">
            {days.map((day) => {
              const isSelected = selectedDate ? isSameDay(day.date, selectedDate) : false
              const isToday = isSameDay(day.date, new Date())
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => handleSelect(day.date)}
                  className={[
                    'date-picker-day',
                    day.isCurrentMonth ? '' : 'date-picker-day-muted',
                    isSelected ? 'date-picker-day-selected' : '',
                    isToday ? 'date-picker-day-today' : '',
                  ].join(' ').trim()}
                >
                  {day.date.getDate()}
                </button>
              )
            })}
          </div>

          <div className="date-picker-footer">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const today = new Date()
                setViewMonth(startOfMonth(today))
                handleSelect(today)
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function buildCalendarDays(viewMonth: Date) {
  const first = startOfMonth(viewMonth)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      key: toDateKey(date),
      date,
      isCurrentMonth: date.getMonth() === viewMonth.getMonth(),
    }
  })
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}
