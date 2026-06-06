export const FURNITURE_MATERIAL_FINISHES = [
  'matte',
  'satin',
  'glossy',
  'laminate',
  'veneer',
  'acrylic',
  'membrane',
] as const

export type FurnitureMaterialFinish = typeof FURNITURE_MATERIAL_FINISHES[number]

export const FURNITURE_MATERIAL_GRAIN_DIRECTIONS = [
  'auto',
  'vertical',
  'horizontal',
  'none',
] as const

export type FurnitureMaterialGrainDirection = typeof FURNITURE_MATERIAL_GRAIN_DIRECTIONS[number]

export const FURNITURE_MATERIAL_TEXTURE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type FurnitureMaterialTextureMimeType = typeof FURNITURE_MATERIAL_TEXTURE_MIME_TYPES[number]
export type FurnitureMaterialTextureSource = 'upload' | 'remote'

export interface FurnitureMaterialTextureRepeat {
  x: number
  y: number
}

export interface FurnitureMaterialTextureImage {
  id: string
  name: string
  source: FurnitureMaterialTextureSource
  src: string
  mimeType?: FurnitureMaterialTextureMimeType
  fileName?: string
  sizeBytes?: number
  width?: number
  height?: number
}

export interface CustomFurnitureMaterial {
  id: string
  name: string
  baseColor: string
  finish: FurnitureMaterialFinish
  grainDirection: FurnitureMaterialGrainDirection
  texture: FurnitureMaterialTextureImage | null
  textureScale: number
  textureRepeat: FurnitureMaterialTextureRepeat
  createdAt: string
  updatedAt: string
}

export type CustomFurnitureMaterialInput =
  Partial<Omit<CustomFurnitureMaterial, 'texture' | 'textureRepeat'>> & {
    texture?: Partial<FurnitureMaterialTextureImage> | null
    textureRepeat?: Partial<FurnitureMaterialTextureRepeat>
  }

export const DEFAULT_CUSTOM_FURNITURE_MATERIAL_COLOR = '#c8a96e'
export const DEFAULT_FURNITURE_MATERIAL_FINISH: FurnitureMaterialFinish = 'laminate'
export const DEFAULT_FURNITURE_MATERIAL_GRAIN_DIRECTION: FurnitureMaterialGrainDirection = 'auto'
export const DEFAULT_FURNITURE_TEXTURE_SCALE = 1
export const DEFAULT_FURNITURE_TEXTURE_REPEAT: FurnitureMaterialTextureRepeat = { x: 1, y: 1 }
export const FURNITURE_TEXTURE_MAX_SIZE_BYTES = 5 * 1024 * 1024
export const FURNITURE_TEXTURE_SCALE_LIMITS = { min: 0.25, max: 4 } as const
export const FURNITURE_TEXTURE_REPEAT_LIMITS = { min: 0.25, max: 12 } as const

export const FURNITURE_MATERIAL_FINISH_LABELS: Record<FurnitureMaterialFinish, string> = {
  matte: 'Matte',
  satin: 'Satin',
  glossy: 'Glossy',
  laminate: 'Laminate',
  veneer: 'Veneer',
  acrylic: 'Acrylic',
  membrane: 'Membrane',
}

export const FURNITURE_MATERIAL_GRAIN_DIRECTION_LABELS: Record<FurnitureMaterialGrainDirection, string> = {
  auto: 'Auto',
  vertical: 'Vertical',
  horizontal: 'Horizontal',
  none: 'No grain',
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

export function createFurnitureMaterialId(prefix = 'mat') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeFurnitureMaterialName(value: string | undefined, fallback = 'Custom material') {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, 80)
}

export function normalizeFurnitureMaterialHexColor(
  value: string | undefined,
  fallback = DEFAULT_CUSTOM_FURNITURE_MATERIAL_COLOR,
) {
  const trimmed = value?.trim()

  if (trimmed && /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (trimmed && /^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((char) => `${char}${char}`).join('')}`.toLowerCase()
  }

  return fallback
}

export function isFurnitureMaterialFinish(value: string | undefined): value is FurnitureMaterialFinish {
  return FURNITURE_MATERIAL_FINISHES.includes(value as FurnitureMaterialFinish)
}

export function isFurnitureMaterialGrainDirection(
  value: string | undefined,
): value is FurnitureMaterialGrainDirection {
  return FURNITURE_MATERIAL_GRAIN_DIRECTIONS.includes(value as FurnitureMaterialGrainDirection)
}

export function isFurnitureMaterialTextureMimeType(
  value: string | undefined,
): value is FurnitureMaterialTextureMimeType {
  return FURNITURE_MATERIAL_TEXTURE_MIME_TYPES.includes(value as FurnitureMaterialTextureMimeType)
}

export function normalizeFurnitureMaterialTexture(
  texture: Partial<FurnitureMaterialTextureImage> | null | undefined,
): FurnitureMaterialTextureImage | null {
  if (!texture?.src?.trim()) return null

  const mimeType = isFurnitureMaterialTextureMimeType(texture.mimeType)
    ? texture.mimeType
    : undefined

  return {
    id: texture.id?.trim() || createFurnitureMaterialId('tex'),
    name: normalizeFurnitureMaterialName(texture.name, texture.fileName || 'Texture'),
    source: texture.source === 'remote' ? 'remote' : 'upload',
    src: texture.src.trim(),
    mimeType,
    fileName: texture.fileName?.trim() || undefined,
    sizeBytes: texture.sizeBytes && texture.sizeBytes > 0 ? Math.round(texture.sizeBytes) : undefined,
    width: texture.width && texture.width > 0 ? Math.round(texture.width) : undefined,
    height: texture.height && texture.height > 0 ? Math.round(texture.height) : undefined,
  }
}

export function normalizeFurnitureTextureRepeat(
  repeat: Partial<FurnitureMaterialTextureRepeat> | undefined,
): FurnitureMaterialTextureRepeat {
  return {
    x: clampNumber(
      repeat?.x,
      FURNITURE_TEXTURE_REPEAT_LIMITS.min,
      FURNITURE_TEXTURE_REPEAT_LIMITS.max,
      DEFAULT_FURNITURE_TEXTURE_REPEAT.x,
    ),
    y: clampNumber(
      repeat?.y,
      FURNITURE_TEXTURE_REPEAT_LIMITS.min,
      FURNITURE_TEXTURE_REPEAT_LIMITS.max,
      DEFAULT_FURNITURE_TEXTURE_REPEAT.y,
    ),
  }
}

export function normalizeCustomFurnitureMaterial(
  input: CustomFurnitureMaterialInput,
  fallback?: CustomFurnitureMaterial,
): CustomFurnitureMaterial {
  const now = new Date().toISOString()
  const texture = Object.prototype.hasOwnProperty.call(input, 'texture')
    ? input.texture
    : fallback?.texture
  const finish = isFurnitureMaterialFinish(input.finish) ? input.finish : fallback?.finish
  const grainDirection = isFurnitureMaterialGrainDirection(input.grainDirection)
    ? input.grainDirection
    : fallback?.grainDirection

  return {
    id: input.id?.trim() || fallback?.id || createFurnitureMaterialId(),
    name: normalizeFurnitureMaterialName(input.name, fallback?.name),
    baseColor: normalizeFurnitureMaterialHexColor(input.baseColor, fallback?.baseColor),
    finish: finish ?? DEFAULT_FURNITURE_MATERIAL_FINISH,
    grainDirection: grainDirection ?? DEFAULT_FURNITURE_MATERIAL_GRAIN_DIRECTION,
    texture: normalizeFurnitureMaterialTexture(texture),
    textureScale: clampNumber(
      input.textureScale,
      FURNITURE_TEXTURE_SCALE_LIMITS.min,
      FURNITURE_TEXTURE_SCALE_LIMITS.max,
      fallback?.textureScale ?? DEFAULT_FURNITURE_TEXTURE_SCALE,
    ),
    textureRepeat: normalizeFurnitureTextureRepeat(input.textureRepeat ?? fallback?.textureRepeat),
    createdAt: input.createdAt || fallback?.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

export function createDefaultCustomFurnitureMaterial(
  input: CustomFurnitureMaterialInput = {},
): CustomFurnitureMaterial {
  return normalizeCustomFurnitureMaterial({
    name: 'Custom material',
    baseColor: DEFAULT_CUSTOM_FURNITURE_MATERIAL_COLOR,
    finish: DEFAULT_FURNITURE_MATERIAL_FINISH,
    grainDirection: DEFAULT_FURNITURE_MATERIAL_GRAIN_DIRECTION,
    texture: null,
    textureScale: DEFAULT_FURNITURE_TEXTURE_SCALE,
    textureRepeat: DEFAULT_FURNITURE_TEXTURE_REPEAT,
    ...input,
  })
}
