import type { OuterBox, Shelf, Partition, Drawer, Material, CustomPanel, ShelfPartition } from '../stores/furnitureStore'
import { DEFAULT_SECTION_CONFIG } from '../stores/furnitureStore'
import {
  DEFAULT_CONSTRUCTION,
  DOOR_EDGE_GAP,
  DRAWER_BOTTOM_THICKNESS,
  DRAWER_FRONT_GAP,
  clampDrawerDepth,
  getBackPackingSize,
  getBasePieceSizes,
  getCarcassMetrics,
  getDoorHeight,
  getDrawerParts,
  getSectionBounds,
  getTopPanelDepth,
  getUsableSectionWidth,
  type Construction,
} from './furnitureConstruction'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CutCategory =
  | 'shell' | 'base' | 'partition' | 'shelf'
  | 'drawer_front' | 'drawer_box' | 'drawer_padding' | 'door' | 'custom'

export interface CutListItem {
  id:        string
  category:  CutCategory
  name:      string
  length:    number   // mm — longest dimension
  width:     number   // mm
  thickness: number   // mm
  qty:       number
}

export interface CutListSummary {
  items:       CutListItem[]
  totalPieces: number
  totalAreaM2: number   // sum of (length × width × qty) in m²
  groups:      { category: CutCategory; label: string; items: CutListItem[] }[]
  /** Places where a requested allowance had to be reduced to fit. */
  warnings:    string[]
}

export interface CutListInput {
  outerBox:        OuterBox
  material:        Material
  construction?:   Construction
  shelves:         Shelf[]
  partitions:      Partition[]
  drawers:         Drawer[]
  shelfPartitions?: ShelfPartition[]
  customPanels?:   CustomPanel[]
  sectionConfigs?: Record<number, { door: string; hangingRail: boolean }>
}

// ── Category labels ───────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<CutCategory, string> = {
  shell:        'Outer Shell',
  base:         'Base / Plinth',
  partition:    'Partitions',
  shelf:        'Shelves',
  drawer_front: 'Drawer Fronts',
  drawer_box:   'Drawer Boxes',
  drawer_padding: 'Drawer Paddings',
  door:         'Doors',
  custom:       'Custom Panels',
}

const CATEGORY_ORDER: CutCategory[] = [
  'shell', 'base', 'partition', 'shelf',
  'drawer_front', 'drawer_box', 'drawer_padding', 'door', 'custom',
]

// ── Calculator ────────────────────────────────────────────────────────────────

export function calculateCutList(input: CutListInput): CutListSummary {
  const {
    outerBox,
    material,
    construction = DEFAULT_CONSTRUCTION,
    shelves,
    partitions,
    drawers,
    shelfPartitions = [],
    customPanels = [],
    sectionConfigs = {},
  } = input

  const { depth: D } = outerBox
  const metrics = getCarcassMetrics(outerBox, material, construction)
  const T  = metrics.thickness
  const iW = metrics.interiorWidth
  const iH = metrics.interiorHeight
  const iD = metrics.interiorDepth
  // Sides and back run the full height to the floor; the base rail fits
  // between them, so only the interior is shortened by the plinth.
  const sideH = metrics.sidePanelHeight

  let seq = 0
  const uid = () => `cl-${seq++}`
  const items: CutListItem[] = []
  const warnings: string[] = []
  const addItem = (item: Omit<CutListItem, 'id'>) => {
    const length = Math.round(item.length)
    const width = Math.round(item.width)
    const thickness = Math.round(item.thickness)
    if (length <= 0 || width <= 0 || thickness <= 0 || item.qty <= 0) return
    items.push({ id: uid(), ...item, length, width, thickness })
  }

  // ── Outer shell (5 panels) ──────────────────────────────────────────────
  // With a plinth the carcass sits on top of it, so the sides and back stop
  // short of the floor by the base height.

  const topDepth = getTopPanelDepth(D, T, construction.topFormation)

  const backPacking = getBackPackingSize(outerBox, material, metrics)

  addItem({ category: 'shell', name: 'Left Side',    length: sideH, width: D,        thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Right Side',   length: sideH, width: D,        thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Top Panel',    length: iW,    width: topDepth, thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Bottom Panel', length: iW,    width: D,        thickness: T, qty: 1 })
  // Let into a groove in each side panel so it grips, hence the reduced width.
  addItem({
    category: 'shell', name: 'Back Packing',
    length: backPacking.height, width: backPacking.width, thickness: backPacking.thickness, qty: 1,
  })

  // ── Base / plinth ───────────────────────────────────────────────────────
  // A single front rail fitted between the full-height side panels.

  const base = getBasePieceSizes(material, metrics)
  if (base) {
    addItem({
      category: 'base', name: 'Base Front Rail',
      length: base.railLength, width: base.height, thickness: base.thickness, qty: 1,
    })
    if (base.height < construction.baseHeight) {
      warnings.push(
        `Base reduced to ${Math.round(base.height)}mm — the overall height cannot fit a ${Math.round(construction.baseHeight)}mm plinth.`,
      )
    }
  }

  // ── Partitions ──────────────────────────────────────────────────────────

  if (partitions.length > 0) {
    addItem({
      category: 'partition', name: 'Vertical Partition',
      length: iH, width: iD, thickness: T,
      qty: partitions.length,
    })
  }

  if (shelfPartitions.length > 0) {
    const byHeight: Record<number, number> = {}
    shelfPartitions.forEach((partition) => {
      const height = Math.round(partition.toBottom - partition.fromBottom)
      if (height > 0) byHeight[height] = (byHeight[height] ?? 0) + 1
    })
    Object.entries(byHeight).forEach(([height, qty]) => {
      addItem({
        category: 'partition', name: 'Shelf Partition',
        length: Number(height), width: iD, thickness: T, qty,
      })
    })
  }

  // ── Section boundaries (needed for shelf widths & drawer widths) ────────

  const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
  const sections = getSectionBounds(sorted.map((p) => p.fromLeft), iW)
  const lastIndex = sections.length - 1

  // ── Shelves (each shelf lives in exactly one section) ──────────────────

  if (shelves.length > 0) {
    // Group identical-length shelves to consolidate qty
    const byLength: Record<number, number> = {}
    shelves.forEach((shelf) => {
      const sec = sections[shelf.sectionIndex]
      if (!sec) return
      const shelfL = Math.round(getUsableSectionWidth(sec.width, shelf.sectionIndex, lastIndex, T))
      if (shelfL <= 0) return
      byLength[shelfL] = (byLength[shelfL] ?? 0) + 1
    })
    Object.entries(byLength).forEach(([lenStr, qty]) => {
      addItem({
        category: 'shelf', name: 'Shelf',
        length: Number(lenStr), width: Math.round(iD), thickness: T, qty,
      })
    })
  }

  // ── Drawers ─────────────────────────────────────────────────────────────
  // A padding block insets the drawer from both sides of its opening so the
  // door hinges can close, and the runner channel sits inside that:
  //
  //   936 - 36 (carcass) - 36 - 36 (paddings)
  //       - 12.5 - 12.5 (channels) - 36 (box sides) = 767

  drawers.forEach((drawer, i) => {
    const section = sections[drawer.sectionIndex]
    if (!section) return

    const usableW = getUsableSectionWidth(section.width, drawer.sectionIndex, lastIndex, T)
    const depth = clampDrawerDepth(drawer.depth, outerBox.depth, construction)
    const parts = getDrawerParts({
      openingWidth: usableW,
      drawerHeight: drawer.height,
      drawerDepth: depth,
      cabinetDepth: outerBox.depth,
      boardThickness: T,
      construction,
    })

    if (parts.sidePadding < construction.drawerSidePadding) {
      warnings.push(
        `Drawer ${i + 1}: side padding reduced to ${Math.round(parts.sidePadding)}mm — the ${Math.round(usableW)}mm opening is too narrow for ${Math.round(construction.drawerSidePadding)}mm each side.`,
      )
    }
    if (parts.wallHeight <= 0) {
      warnings.push(
        `Drawer ${i + 1}: ${Math.round(drawer.height)}mm is too short for a ${Math.round(construction.drawerBoxReduction)}mm box reduction — no box walls produced.`,
      )
    }

    addItem({
      category: 'drawer_front', name: `Drawer Front ${i + 1}`,
      length: Math.round(parts.frontWidth), width: drawer.height - DRAWER_FRONT_GAP,
      thickness: T, qty: 1,
    })
    // Sides (2) and (4) run front to back.
    addItem({
      category: 'drawer_box', name: `Drawer Side ${i + 1}`,
      length: parts.sideMemberLength, width: parts.wallHeight, thickness: T, qty: 2,
    })
    // Sides (1) and (3) fit between them, across the width.
    addItem({
      category: 'drawer_box', name: `Drawer Front/Back Board ${i + 1}`,
      length: parts.crossMemberLength, width: parts.wallHeight, thickness: T, qty: 2,
    })
    addItem({
      category: 'drawer_box', name: `Drawer Bottom ${i + 1}`,
      length: parts.bottomWidth, width: parts.bottomDepth,
      thickness: DRAWER_BOTTOM_THICKNESS, qty: 1,
    })
    addItem({
      category: 'drawer_padding', name: `Drawer Padding ${i + 1}`,
      length: parts.paddingDepth, width: parts.paddingHeight,
      thickness: parts.paddingThickness, qty: 2,
    })
  })

  // ── Doors ───────────────────────────────────────────────────────────────
  // Door height follows the top formation: `door_over_top` runs the door up
  // across the front edge of the top panel, gaining one board thickness.

  const doorH = Math.round(getDoorHeight(iH, T, construction.topFormation))

  sections.forEach((section) => {
    const cfg = sectionConfigs[section.index] ?? DEFAULT_SECTION_CONFIG
    if (cfg.door === 'none') return

    const doorW = Math.round(section.width - DOOR_EDGE_GAP * 2)

    if (cfg.door === 'single') {
      addItem({
        category: 'door',
        name: `Door (Section ${section.index + 1})`,
        length: doorW, width: doorH, thickness: T, qty: 1,
      })
    } else if (cfg.door === 'double') {
      addItem({
        category: 'door',
        name: `Door (Section ${section.index + 1})`,
        length: Math.round((section.width - DOOR_EDGE_GAP * 4) / 2), width: doorH, thickness: T, qty: 2,
      })
    }
  })

  // ── Custom panels ────────────────────────────────────────────────────────

  customPanels.forEach((cp) => {
    addItem({
      category: 'custom',
      name: cp.name,
      length: cp.width,      // horizontal dimension as drawn
      width: cp.height,      // vertical dimension as drawn
      thickness: cp.thickness,
      qty: 1,
    })
  })

  // ── Summary ─────────────────────────────────────────────────────────────

  const totalPieces = items.reduce((s, it) => s + it.qty, 0)
  const totalAreaM2 = items.reduce(
    (s, it) => s + (it.length / 1000) * (it.width / 1000) * it.qty, 0,
  )

  const groups = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      label:    CATEGORY_LABELS[cat],
      items:    items.filter((it) => it.category === cat),
    }))
    .filter((g) => g.items.length > 0)

  return { items, totalPieces, totalAreaM2, groups, warnings }
}
