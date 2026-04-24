export function normalizeSizeInput(value: string): string {
  let next = value.toUpperCase().replace(/\*/g, ' X ').replace(/\s*[X]\s*/g, ' X ')
  next = next.replace(/\s{2,}/g, ' ')

  const parts = next.split(' X ')
  if (parts.length > 2) {
    next = `${parts[0]} X ${parts.slice(1).join('')}`
  }

  return next.trimStart()
}

export function applySizeSeparator(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /\bX\b/.test(trimmed)) return value
  return `${trimmed} X `
}

export function parseSizeInches(size: string): [number, number] | null {
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return [width, height]
}

export function deriveSqft(size: string, fallback?: string): number | null {
  if (!size.trim()) {
    return null
  }
  const parsed = parseSizeInches(size)
  if (parsed) {
    const [width, height] = parsed
    return roundSqft((width * height) / 144)
  }
  if (fallback && fallback.trim()) {
    const num = Number(fallback)
    return Number.isFinite(num) ? roundSqft(num) : null
  }
  return null
}

export function deriveSqftString(size: string, fallback?: string): string {
  const sqft = deriveSqft(size, fallback)
  return sqft == null ? '' : String(sqft)
}

export function isSizeLikeLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value.includes('size') || value.includes('dimension') || value.includes('measurement')
}

function roundSqft(value: number): number {
  return Math.round(value * 100) / 100
}
