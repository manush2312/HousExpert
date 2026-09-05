// Orthographic shop drawings built from the design model.
//
// The cut list says what to cut; these views say what it becomes. Everything is
// emitted as abstract shapes in millimetre space with a top-left origin
// (+x right, +y down) so the PDF renderer only has to apply a scale and offset.
// Nothing here touches jsPDF, which keeps the geometry testable on its own.

import {
  DOOR_EDGE_GAP,
  clampDrawerDepth,
  getBackPackingGroove,
  getCarcassMetrics,
  getDrawerWidths,
  getSectionBounds,
  getSectionInsets,
  getShelfCells,
  getTopPanelDepth,
  getUsableSectionWidth,
  type BoxLike,
  type Construction,
  type MaterialLike,
} from './furnitureConstruction'

// ── Shapes ────────────────────────────────────────────────────────────────────

export type DrawingStyle =
  | 'outline'   // overall extent of the unit
  | 'carcass'   // sides, top, bottom
  | 'back'      // back sheet
  | 'base'      // plinth
  | 'panel'     // shelves and partitions
  | 'drawer'    // drawer front / box
  | 'padding'   // drawer padding blocks
  | 'channel'   // runner channel either side of the drawer box
  | 'door'      // dashed, drawn over the top of everything
  | 'custom'    // custom panels
  | 'guide'     // dimension lines

export type DrawingText = 'label' | 'dimension' | 'section'

/**
 * Offset in PAPER millimetres, applied after the drawing is scaled. Dimension
 * text is a fixed point size, so its gutter has to be fixed on the page too --
 * a model-space offset would collapse to nothing once the view is scaled down.
 */
export interface Pad { dx: number; dy: number }

export type DrawingShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; style: DrawingStyle }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; style: DrawingStyle; pad?: Pad; pad2?: Pad }
  | { kind: 'text'; x: number; y: number; text: string; role: DrawingText; align?: 'left' | 'center' | 'right'; pad?: Pad }

export type FurnitureViewId = 'front' | 'side' | 'top' | 'iso'

export interface FurnitureView {
  id: FurnitureViewId
  title: string
  /** Drawing extent in mm, including any dimension gutters. */
  width: number
  height: number
  shapes: DrawingShape[]
  /** Isometric is not to the shared orthographic scale. */
  toScale: boolean
}

export interface FurnitureDrawingInput {
  outerBox: BoxLike
  material: MaterialLike
  construction: Construction
  shelves: { fromBottom: number; sectionIndex: number }[]
  partitions: { fromLeft: number }[]
  drawers: { sectionIndex: number; fromBottom: number; height: number; depth: number }[]
  shelfPartitions?: { sectionIndex: number; fromLeft: number; fromBottom: number; toBottom: number }[]
  customPanels?: { name: string; fromLeft: number; fromBottom: number; width: number; height: number }[]
  sectionConfigs?: Record<number, { door: string; hangingRail: boolean }>
}

function rect(x: number, y: number, w: number, h: number, style: DrawingStyle): DrawingShape {
  return { kind: 'rect', x, y, w, h, style }
}

function line(
  x1: number, y1: number, x2: number, y2: number,
  style: DrawingStyle = 'guide',
  pad?: Pad, pad2?: Pad,
): DrawingShape {
  return { kind: 'line', x1, y1, x2, y2, style, pad, pad2 }
}

function text(
  x: number, y: number, value: string,
  role: DrawingText = 'dimension',
  align: 'left' | 'center' | 'right' = 'center',
  pad?: Pad,
): DrawingShape {
  return { kind: 'text', x, y, text: value, role, align, pad }
}

const pad = (dx: number, dy: number): Pad => ({ dx, dy })

/** Half-length of a dimension end tick, in paper mm. */
const TICK = 1.4

/**
 * Horizontal dimension anchored to a model line at `yAnchor`, pushed `padY`
 * paper-millimetres away from it.
 */
function dimH(x1: number, x2: number, yAnchor: number, label: string, padY: number): DrawingShape[] {
  const up = padY < 0
  return [
    line(x1, yAnchor, x2, yAnchor, 'guide', pad(0, padY), pad(0, padY)),
    line(x1, yAnchor, x1, yAnchor, 'guide', pad(0, padY - TICK), pad(0, padY + TICK)),
    line(x2, yAnchor, x2, yAnchor, 'guide', pad(0, padY - TICK), pad(0, padY + TICK)),
    text((x1 + x2) / 2, yAnchor, label, 'dimension', 'center', pad(0, padY + (up ? -2.2 : 2.2))),
  ]
}

/** Vertical dimension anchored to a model line at `xAnchor`. */
function dimV(y1: number, y2: number, xAnchor: number, label: string, padX: number): DrawingShape[] {
  const left = padX < 0
  return [
    line(xAnchor, y1, xAnchor, y2, 'guide', pad(padX, 0), pad(padX, 0)),
    line(xAnchor, y1, xAnchor, y1, 'guide', pad(padX - TICK, 0), pad(padX + TICK, 0)),
    line(xAnchor, y2, xAnchor, y2, 'guide', pad(padX - TICK, 0), pad(padX + TICK, 0)),
    text(xAnchor, (y1 + y2) / 2, label, 'dimension', left ? 'right' : 'left',
      pad(padX + (left ? -1.2 : 1.2), 0)),
  ]
}

/** Stacked vertical segments sharing one chain line, e.g. carcass over base. */
function dimVChain(stops: number[], xAnchor: number, padX: number): DrawingShape[] {
  const shapes: DrawingShape[] = []
  stops.forEach((stop) => {
    shapes.push(line(xAnchor, stop, xAnchor, stop, 'guide', pad(padX - TICK, 0), pad(padX + TICK, 0)))
  })
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [from, to] = [stops[i], stops[i + 1]]
    shapes.push(line(xAnchor, from, xAnchor, to, 'guide', pad(padX, 0), pad(padX, 0)))
    shapes.push(text(xAnchor, (from + to) / 2, `${Math.round(to - from)}`,
      'dimension', 'right', pad(padX - 1.2, 0)))
  }
  return shapes
}

/** Clear openings get their height printed inside, when there is room to read it. */
const MIN_LABELLED_CELL = 55

// ── Front elevation ───────────────────────────────────────────────────────────

function buildFrontView(input: FurnitureDrawingInput): FurnitureView {
  const { outerBox, material, construction, shelves, partitions, drawers } = input
  const shelfPartitions = input.shelfPartitions ?? []
  const customPanels = input.customPanels ?? []
  const sectionConfigs = input.sectionConfigs ?? {}

  const m = getCarcassMetrics(outerBox, material, construction)
  const { width: W } = outerBox
  const T = m.thickness
  const totalHeight = m.sidePanelHeight
  // y grows downward from the top of the unit; the plinth sits at the bottom.
  const interiorTopY = T
  const interiorBottomY = totalHeight - m.baseHeight - T

  const shapes: DrawingShape[] = []
  const sections = getSectionBounds(partitions.map((p) => p.fromLeft), m.interiorWidth)
  const lastIndex = sections.length - 1

  shapes.push(rect(0, 0, W, totalHeight, 'outline'))

  // Sides run the full height to the floor; the base rail fits between them.
  shapes.push(rect(0, 0, T, totalHeight, 'carcass'))               // left side
  shapes.push(rect(W - T, 0, T, totalHeight, 'carcass'))           // right side
  shapes.push(rect(T, 0, W - T * 2, T, 'carcass'))                 // top
  shapes.push(rect(T, interiorBottomY, W - T * 2, T, 'carcass'))   // bottom

  if (m.baseHeight > 0) {
    const railY = totalHeight - m.baseHeight
    shapes.push(rect(T, railY, W - T * 2, m.baseHeight, 'base'))
    shapes.push(text(W / 2, railY + m.baseHeight / 2, `BASE ${Math.round(m.baseHeight)}`, 'label'))
  }

  // Full-height partitions, drawn on their centreline
  partitions.forEach((partition) => {
    shapes.push(rect(T + partition.fromLeft - T / 2, interiorTopY, T, m.interiorHeight, 'panel'))
  })

  // Shelves span only their own section's clear opening
  shelves.forEach((shelf) => {
    const section = sections[shelf.sectionIndex]
    if (!section) return
    const inset = getSectionInsets(shelf.sectionIndex, lastIndex, T)
    const x = T + section.fromLeft + inset.left
    const w = getUsableSectionWidth(section.width, shelf.sectionIndex, lastIndex, T)
    shapes.push(rect(x, interiorBottomY - shelf.fromBottom - T / 2, w, T, 'panel'))
  })

  shelfPartitions.forEach((sp) => {
    const height = sp.toBottom - sp.fromBottom
    if (height <= 0) return
    shapes.push(rect(T + sp.fromLeft - T / 2, interiorBottomY - sp.toBottom, T, height, 'panel'))
  })

  // Drawers, held clear of the door hinges by a padding block each side
  drawers.forEach((drawer) => {
    const section = sections[drawer.sectionIndex]
    if (!section) return
    const inset = getSectionInsets(drawer.sectionIndex, lastIndex, T)
    const opening = getUsableSectionWidth(section.width, drawer.sectionIndex, lastIndex, T)
    const { frontWidth, sidePadding } = getDrawerWidths(opening, construction)
    const openingLeft = T + section.fromLeft + inset.left
    const x = openingLeft + sidePadding
    const y = interiorBottomY - drawer.fromBottom - drawer.height

    if (sidePadding > 0) {
      shapes.push(rect(openingLeft, y, sidePadding, drawer.height, 'padding'))
      shapes.push(rect(openingLeft + opening - sidePadding, y, sidePadding, drawer.height, 'padding'))
    }
    shapes.push(rect(x, y, frontWidth, drawer.height, 'drawer'))
    // Runner channel sits just inside the padding, behind the front
    const channel = construction.drawerChannel
    if (channel > 0) {
      shapes.push(rect(x, y, channel, drawer.height, 'channel'))
      shapes.push(rect(x + frontWidth - channel, y, channel, drawer.height, 'channel'))
    }
    // Handle
    shapes.push(line(x + frontWidth * 0.3, y + drawer.height / 2, x + frontWidth * 0.7, y + drawer.height / 2, 'drawer'))
  })

  customPanels.forEach((panel) => {
    shapes.push(rect(
      T + panel.fromLeft,
      interiorBottomY - panel.fromBottom - panel.height,
      panel.width,
      panel.height,
      'custom',
    ))
  })

  // Doors last, dashed, so the internals stay readable underneath
  sections.forEach((section) => {
    const cfg = sectionConfigs[section.index]
    if (!cfg || cfg.door === 'none') return
    const doorH = m.interiorHeight - DOOR_EDGE_GAP * 2
      + (construction.topFormation === 'door_over_top' ? T : 0)
    const doorTopY = interiorBottomY - DOOR_EDGE_GAP - doorH
    const x = T + section.fromLeft + DOOR_EDGE_GAP

    if (cfg.door === 'single') {
      shapes.push(rect(x, doorTopY, section.width - DOOR_EDGE_GAP * 2, doorH, 'door'))
    } else {
      const halfW = (section.width - DOOR_EDGE_GAP * 4) / 2
      shapes.push(rect(x, doorTopY, halfW, doorH, 'door'))
      shapes.push(rect(x + halfW + DOOR_EDGE_GAP * 2, doorTopY, halfW, doorH, 'door'))
    }
  })

  const totalH = totalHeight

  // Section numbers, their clear widths, and the clear height of every opening
  // between shelves — the same figures the calculations panel derives.
  sections.forEach((section) => {
    const inset = getSectionInsets(section.index, lastIndex, T)
    const clearW = getUsableSectionWidth(section.width, section.index, lastIndex, T)
    const left = T + section.fromLeft + inset.left
    const cx = left + clearW / 2

    shapes.push(text(cx, interiorTopY + 30, `S${section.index + 1}`, 'section'))

    const sectionShelves = shelves
      .filter((shelf) => shelf.sectionIndex === section.index)
      .map((shelf) => shelf.fromBottom)
      .sort((a, b) => a - b)

    getShelfCells(sectionShelves, T, m.interiorHeight).forEach((cell) => {
      const height = cell.to - cell.from
      if (height < MIN_LABELLED_CELL) return
      shapes.push(text(cx, interiorBottomY - (cell.from + cell.to) / 2, `${Math.round(height)}`, 'dimension'))
    })
  })

  // Clear opening widths along the bottom, one line per section
  sections.forEach((section) => {
    const inset = getSectionInsets(section.index, lastIndex, T)
    const left = T + section.fromLeft + inset.left
    const clearW = getUsableSectionWidth(section.width, section.index, lastIndex, T)
    shapes.push(...dimH(left, left + clearW, totalH, `${Math.round(clearW)}`, 5))
  })

  // Drawer heights, printed on the drawer front
  drawers.forEach((drawer) => {
    const section = sections[drawer.sectionIndex]
    if (!section) return
    if (drawer.height < MIN_LABELLED_CELL) return
    const inset = getSectionInsets(drawer.sectionIndex, lastIndex, T)
    const opening = getUsableSectionWidth(section.width, drawer.sectionIndex, lastIndex, T)
    const { frontWidth, sidePadding } = getDrawerWidths(opening, construction)
    const cx = T + section.fromLeft + inset.left + sidePadding + frontWidth / 2
    shapes.push(text(cx, interiorBottomY - drawer.fromBottom - drawer.height / 2 + 12, `${Math.round(drawer.height)}`, 'dimension'))
  })

  shapes.push(...dimH(0, W, 0, `${Math.round(W)}`, -5))
  // Carcass and base split on the left; the overall goes on the right so the
  // two never share a column.
  if (m.baseHeight > 0) {
    shapes.push(...dimVChain([0, totalH - m.baseHeight, totalH], 0, -4))
    shapes.push(...dimV(0, totalH, W, `${Math.round(totalH)} OA`, 5))
  } else {
    shapes.push(...dimV(0, totalH, 0, `${Math.round(totalH)}`, -4))
  }

  return { id: 'front', title: 'FRONT', width: W, height: totalH, shapes, toScale: true }
}

// ── Side elevation (viewed from the left; front of the unit is to the right) ──

function buildSideView(input: FurnitureDrawingInput): FurnitureView {
  const { outerBox, material, construction, shelves, drawers } = input
  const sectionConfigs = input.sectionConfigs ?? {}

  const m = getCarcassMetrics(outerBox, material, construction)
  const { depth: D } = outerBox
  const T = m.thickness
  const B = m.backPanelThickness
  const totalHeight = m.sidePanelHeight
  const interiorBottomY = totalHeight - m.baseHeight - T
  const hasDoor = Object.values(sectionConfigs).some((cfg) => cfg && cfg.door !== 'none')
  const topDepth = getTopPanelDepth(D, T, construction.topFormation)
  const totalH = totalHeight
  const frontEdge = D + (hasDoor ? T : 0)

  const shapes: DrawingShape[] = []

  shapes.push(rect(0, 0, D, totalH, 'outline'))
  shapes.push(rect(0, 0, B, totalH, 'back'))                                // back packing, full height
  shapes.push(rect(0, 0, topDepth, T, 'carcass'))                           // top panel
  shapes.push(rect(0, interiorBottomY, D, T, 'carcass'))                    // bottom panel

  // Base rail sits at the front only; the sides run past it to the floor.
  if (m.baseHeight > 0) {
    shapes.push(rect(D - T, totalH - m.baseHeight, T, m.baseHeight, 'base'))
  }

  // Shelves in profile, running from the back sheet to the front
  const uniqueShelfHeights = [...new Set(shelves.map((s) => s.fromBottom))]
  uniqueShelfHeights.forEach((fromBottom) => {
    shapes.push(rect(B, interiorBottomY - fromBottom - T / 2, D - B, T, 'panel'))
  })

  // Drawer boxes in profile, with the padding block running behind the front
  drawers.forEach((drawer) => {
    const depth = clampDrawerDepth(drawer.depth, D, construction)
    const y = interiorBottomY - drawer.fromBottom - drawer.height
    const frontX = D - T
    const boxDepth = Math.max(1, depth - T)
    const paddingDepth = Math.max(1, D - construction.drawerBoxReduction)
    shapes.push(rect(D - paddingDepth, y, paddingDepth, drawer.height, 'padding'))
    // Channel runs the length of the padding
    shapes.push(rect(D - paddingDepth, y + drawer.height / 2 - construction.drawerChannel / 2,
      paddingDepth, construction.drawerChannel, 'channel'))
    shapes.push(rect(frontX, y, T, drawer.height, 'drawer'))                          // front
    shapes.push(rect(frontX - boxDepth, y + 3, boxDepth, drawer.height - 6, 'drawer')) // box
  })

  // The door is what makes the two top formations visibly different
  if (hasDoor) {
    const doorH = m.interiorHeight - DOOR_EDGE_GAP * 2
      + (construction.topFormation === 'door_over_top' ? T : 0)
    const doorTopY = interiorBottomY - DOOR_EDGE_GAP - doorH
    shapes.push(rect(D, doorTopY, T, doorH, 'door'))
    shapes.push(text(D + T, doorTopY + doorH / 2, 'DOOR', 'label', 'left', pad(1.5, 0)))
  }

  shapes.push(text(frontEdge, totalH, 'FRONT', 'label', 'right', pad(0, 12.5)))

  // Depth: overall on top, usable interior depth below the unit
  shapes.push(...dimH(0, D, 0, `${Math.round(D)}`, -5))
  shapes.push(...dimH(B, D, totalH, `${Math.round(D - B)} clear`, 5))

  // The top panel loses a board when the door covers its front edge, so its
  // depth gets its own line clear of the others.
  if (topDepth !== D) {
    shapes.push(...dimH(0, topDepth, totalH, `TOP ${Math.round(topDepth)}`, 9))
  }

  if (m.baseHeight > 0) {
    shapes.push(...dimVChain([0, totalH - m.baseHeight, totalH], 0, -4))
    shapes.push(...dimV(0, totalH, frontEdge, `${Math.round(totalH)} OA`, 5))
  } else {
    shapes.push(...dimV(0, totalH, 0, `${Math.round(totalH)}`, -4))
  }

  return { id: 'side', title: 'SIDE', width: frontEdge, height: totalH, shapes, toScale: true }
}

// ── Plan view (from above; front of the unit is at the bottom) ────────────────

function buildTopView(input: FurnitureDrawingInput): FurnitureView {
  const { outerBox, material, construction, partitions } = input
  const sectionConfigs = input.sectionConfigs ?? {}

  const m = getCarcassMetrics(outerBox, material, construction)
  const { width: W, depth: D } = outerBox
  const T = m.thickness
  const B = m.backPanelThickness
  const hasDoor = Object.values(sectionConfigs).some((cfg) => cfg && cfg.door !== 'none')

  const shapes: DrawingShape[] = []

  const groove = getBackPackingGroove(T)
  shapes.push(rect(0, 0, W, D, 'outline'))
  // Back packing is let `groove` into each side panel, so it stops short of
  // the outer faces rather than spanning the full width.
  shapes.push(rect(groove, 0, W - groove * 2, B, 'back'))
  shapes.push(rect(0, 0, T, D, 'carcass'))           // left side
  shapes.push(rect(W - T, 0, T, D, 'carcass'))       // right side

  partitions.forEach((partition) => {
    shapes.push(rect(T + partition.fromLeft - T / 2, B, T, D - B, 'panel'))
  })

  if (hasDoor) {
    const sections = getSectionBounds(partitions.map((p) => p.fromLeft), m.interiorWidth)
    sections.forEach((section) => {
      const cfg = sectionConfigs[section.index]
      if (!cfg || cfg.door === 'none') return
      const y = D + T / 2
      shapes.push(line(T + section.fromLeft + DOOR_EDGE_GAP, y, T + section.fromLeft + section.width - DOOR_EDGE_GAP, y, 'door'))
    })
  }

  const frontEdge = D + (hasDoor ? T : 0)
  shapes.push(text(W / 2, frontEdge, 'FRONT', 'label', 'center', pad(0, 5)))
  shapes.push(...dimH(0, W, 0, `${Math.round(W)}`, -5))
  shapes.push(...dimV(0, D, 0, `${Math.round(D)}`, -4))
  // Usable depth behind the back sheet
  shapes.push(...dimV(B, D, W, `${Math.round(D - B)} clear`, 5))

  return { id: 'top', title: 'PLAN', width: W, height: frontEdge, shapes, toScale: true }
}

// ── Isometric ─────────────────────────────────────────────────────────────────

const ISO_COS = Math.cos(Math.PI / 6)   // 30 degrees
const ISO_SIN = Math.sin(Math.PI / 6)

/** Standard isometric: x runs right, y up, z toward the viewer. */
function isoPoint(x: number, y: number, z: number) {
  return { x: (x - z) * ISO_COS, y: (x + z) * ISO_SIN - y }
}

function isoBox(
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  style: DrawingStyle,
): DrawingShape[] {
  const p = (dx: number, dy: number, dz: number) => isoPoint(x + dx, y + dy, z + dz)
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    line(a.x, a.y, b.x, b.y, style)

  // Only the six silhouette + three interior edges that read as a solid.
  const ftl = p(0, h, d), ftr = p(w, h, d), fbl = p(0, 0, d), fbr = p(w, 0, d)
  const btl = p(0, h, 0), btr = p(w, h, 0), bbr = p(w, 0, 0)

  return [
    seg(ftl, ftr), seg(ftr, fbr), seg(fbr, fbl), seg(fbl, ftl),   // front face
    seg(ftl, btl), seg(ftr, btr), seg(fbr, bbr),                   // receding edges
    seg(btl, btr), seg(btr, bbr),                                  // back top + side
  ]
}

function buildIsoView(input: FurnitureDrawingInput): FurnitureView {
  const { outerBox, material, construction, partitions, shelves } = input
  const m = getCarcassMetrics(outerBox, material, construction)
  const { width: W, depth: D } = outerBox
  const T = m.thickness

  const raw: DrawingShape[] = []

  // Carcass and plinth as separate solids
  raw.push(...isoBox(0, 0, 0, W, m.sidePanelHeight, D, 'carcass'))
  if (m.baseHeight > 0) {
    // Front rail only, spanning the interior between the full-height sides.
    raw.push(...isoBox(T, 0, D - T, m.interiorWidth, m.baseHeight, T, 'base'))
  }

  // Partitions and shelves as flat planes on the front opening
  partitions.forEach((partition) => {
    const x = T + partition.fromLeft
    raw.push(...isoBox(x - T / 2, m.interiorBottom, 0, T, m.interiorHeight, D, 'panel'))
  })

  const sections = getSectionBounds(partitions.map((p) => p.fromLeft), m.interiorWidth)
  shelves.forEach((shelf) => {
    const section = sections[shelf.sectionIndex]
    if (!section) return
    const inset = getSectionInsets(shelf.sectionIndex, sections.length - 1, T)
    const x = T + section.fromLeft + inset.left
    const w = getUsableSectionWidth(section.width, shelf.sectionIndex, sections.length - 1, T)
    raw.push(...isoBox(x, m.interiorBottom + shelf.fromBottom - T / 2, 0, w, T, D, 'panel'))
  })

  // Normalise the projection into a positive top-left origin box
  const xs: number[] = []
  const ys: number[] = []
  raw.forEach((shape) => {
    if (shape.kind !== 'line') return
    xs.push(shape.x1, shape.x2)
    ys.push(shape.y1, shape.y2)
  })
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)

  return {
    id: 'iso',
    title: 'ISOMETRIC',
    width: maxX - minX,
    height: maxY - minY,
    shapes: offset(raw, -minX, -minY),
    toScale: false,
  }
}

// ── Assembly ──────────────────────────────────────────────────────────────────

function offset(shapes: DrawingShape[], dx: number, dy: number): DrawingShape[] {
  return shapes.map((shape) => {
    if (shape.kind === 'rect') return { ...shape, x: shape.x + dx, y: shape.y + dy }
    if (shape.kind === 'line') {
      return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy }
    }
    return { ...shape, x: shape.x + dx, y: shape.y + dy }
  })
}

export function buildFurnitureDrawings(input: FurnitureDrawingInput): FurnitureView[] {
  return [
    buildFrontView(input),
    buildSideView(input),
    buildTopView(input),
    buildIsoView(input),
  ]
}
