import type { jsPDF } from 'jspdf'
import type { DrawingStyle, FurnitureView } from './furnitureDrawings'

// Renders dimensioned orthographic views onto a jsPDF page.

export type Rgb = [number, number, number]

/** fill (null = unfilled), stroke, line width, dashed. */
const SHAPE_STYLES: Record<DrawingStyle, {
  fill: Rgb | null; stroke: Rgb; width: number; dash?: boolean
}> = {
  outline: { fill: null,            stroke: [170, 170, 170], width: 0.2 },
  carcass: { fill: [222, 222, 222], stroke: [70, 70, 70],    width: 0.35 },
  back:    { fill: [242, 242, 242], stroke: [150, 150, 150], width: 0.2 },
  base:    { fill: [196, 196, 196], stroke: [70, 70, 70],    width: 0.35 },
  panel:   { fill: [214, 214, 214], stroke: [80, 80, 80],    width: 0.3 },
  drawer:  { fill: [236, 236, 236], stroke: [95, 95, 95],    width: 0.3 },
  padding: { fill: [176, 138, 100], stroke: [110, 74, 40],  width: 0.3 },
  channel: { fill: [120, 160, 175], stroke: [60, 100, 115], width: 0.25 },
  door:    { fill: null,            stroke: [40, 40, 40],    width: 0.3, dash: true },
  custom:  { fill: [246, 246, 246], stroke: [120, 120, 120], width: 0.25 },
  guide:   { fill: null,            stroke: [150, 150, 150], width: 0.15 },
}

/** Standard drawing scales, smallest denominator (largest drawing) first. */
const STANDARD_SCALES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 500]

/**
 * Paper-millimetre margins reserved inside each cell for dimension lines and
 * their labels. These do not scale, which is the whole point — the text is a
 * fixed point size, so its gutter has to be fixed on the page too.
 */
const ANNOTATION_MARGIN = { left: 14, right: 17, top: 9, bottom: 16 }
const PLAIN_MARGIN = { left: 2, right: 2, top: 2, bottom: 2 }

/** Largest standard scale that still fits the view in the space available. */
function fitScale(view: FurnitureView, availW: number, availH: number) {
  const raw = Math.min(availW / view.width, availH / view.height)
  if (!view.toScale) return { scale: raw * 0.98, label: '' }
  const denominator = STANDARD_SCALES.find((n) => n >= 1 / raw)
  return denominator
    ? { scale: 1 / denominator, label: `1:${denominator}` }
    : { scale: raw, label: `1:${Math.round(1 / raw)}` }
}

export function renderDrawingSheet(
  doc: jsPDF,
  views: FurnitureView[],
  lm: number,
  top: number,
  cw: number,
  cellH: number,
): number {
  const gutter = 6
  const cellW = (cw - gutter) / 2
  const titleH = 5
  const drawH = cellH - titleH - 3

  views.forEach((view, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const cellX = lm + col * (cellW + gutter)
    const cellY = top + row * (cellH + 6)

    const margin = view.toScale ? ANNOTATION_MARGIN : PLAIN_MARGIN
    const availW = cellW - margin.left - margin.right
    const availH = drawH - margin.top - margin.bottom
    const { scale, label } = fitScale(view, availW, availH)

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60, 60, 60)
    doc.text(view.title, cellX, cellY + 3)
    if (label) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(150, 150, 150)
      doc.text(label, cellX + cellW, cellY + 3, { align: 'right' })
    }

    // Centre the scaled drawing inside the annotation margins
    const innerX = cellX + margin.left
    const innerY = cellY + titleH + margin.top
    const originX = innerX + (availW - view.width * scale) / 2
    const originY = innerY + (availH - view.height * scale) / 2
    const px = (x: number, dx = 0) => originX + x * scale + dx
    const py = (y: number, dy = 0) => originY + y * scale + dy

    view.shapes.forEach((shape) => {
      if (shape.kind === 'text') {
        const size = shape.role === 'section' ? 7 : shape.role === 'label' ? 5.2 : 5
        doc.setFontSize(size)
        doc.setFont('helvetica', shape.role === 'dimension' ? 'normal' : 'bold')
        doc.setTextColor(...(shape.role === 'dimension' ? [55, 55, 55] : [90, 90, 90]) as Rgb)
        doc.text(shape.text, px(shape.x, shape.pad?.dx), py(shape.y, shape.pad?.dy), {
          align: shape.align ?? 'center',
          baseline: 'middle',
        })
        return
      }

      const style = SHAPE_STYLES[shape.style]
      doc.setLineWidth(style.width)
      doc.setDrawColor(...style.stroke)
      doc.setLineDashPattern(style.dash ? [0.8, 0.8] : [], 0)

      if (shape.kind === 'line') {
        doc.line(
          px(shape.x1, shape.pad?.dx), py(shape.y1, shape.pad?.dy),
          px(shape.x2, shape.pad2?.dx ?? shape.pad?.dx), py(shape.y2, shape.pad2?.dy ?? shape.pad?.dy),
        )
      } else {
        if (style.fill) {
          doc.setFillColor(...style.fill)
          doc.rect(px(shape.x), py(shape.y), shape.w * scale, shape.h * scale, 'FD')
        } else {
          doc.rect(px(shape.x), py(shape.y), shape.w * scale, shape.h * scale, 'S')
        }
      }
    })

    doc.setLineDashPattern([], 0)
  })

  return top + Math.ceil(views.length / 2) * (cellH + 6)
}

