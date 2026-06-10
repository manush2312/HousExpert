export const FURNITURE_CANVAS_PX_PER_MM = 1

export const FURNITURE_BOX_FRAME_PADDING = {
  top: 40,
  right: 96,
  bottom: 24,
  left: 40,
} as const

export function furnitureMmToCanvasPx(mm: number): number {
  return mm * FURNITURE_CANVAS_PX_PER_MM
}

export function furnitureCanvasPxToMm(px: number): number {
  return px / FURNITURE_CANVAS_PX_PER_MM
}
