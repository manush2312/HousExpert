import type { OuterBox, Shelf, Partition, Drawer, Material, CustomPanel, ShelfPartition } from '../stores/furnitureStore'
import {
  DEFAULT_BACK_PANEL_THICKNESS,
  DEFAULT_SECTION_CONFIG,
  DRAWER_BOX_HEIGHT_ALLOWANCE,
} from '../stores/furnitureStore'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CutCategory = 'shell' | 'partition' | 'shelf' | 'drawer_front' | 'drawer_box' | 'door' | 'custom'

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
}

// ── Category labels ───────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<CutCategory, string> = {
  shell:        'Outer Shell',
  partition:    'Partitions',
  shelf:        'Shelves',
  drawer_front: 'Drawer Fronts',
  drawer_box:   'Drawer Boxes',
  door:         'Doors',
  custom:       'Custom Panels',
}

const CATEGORY_ORDER: CutCategory[] = [
  'shell', 'partition', 'shelf', 'drawer_front', 'drawer_box', 'door', 'custom',
]

function getSectionInsets(index: number, lastIndex: number, thickness: number) {
  return {
    left:  index === 0 ? 0 : thickness / 2,
    right: index === lastIndex ? 0 : thickness / 2,
  }
}

function getUsableSectionWidth(sectionWidth: number, index: number, lastIndex: number, thickness: number) {
  const inset = getSectionInsets(index, lastIndex, thickness)
  return sectionWidth - inset.left - inset.right
}

// ── Calculator ────────────────────────────────────────────────────────────────

export function calculateCutList(
  outerBox:       OuterBox,
  shelves:        Shelf[],
  partitions:     Partition[],
  drawers:        Drawer[],
  material:       Material,
  sectionConfigs: Record<number, { door: string; hangingRail: boolean }> = {},
  shelfPartitions: ShelfPartition[] = [],
  customPanels:   CustomPanel[] = [],
): CutListSummary {
  const { width: W, height: H, depth: D } = outerBox
  const T  = material.thickness
  const B  = material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
  const iW = W - T * 2          // interior width
  const iH = H - T * 2          // interior height
  const iD = Math.max(1, D - B)

  let seq = 0
  const uid = () => `cl-${seq++}`
  const items: CutListItem[] = []
  const addItem = (item: Omit<CutListItem, 'id'>) => {
    const length = Math.round(item.length)
    const width = Math.round(item.width)
    const thickness = Math.round(item.thickness)
    if (length <= 0 || width <= 0 || thickness <= 0 || item.qty <= 0) return
    items.push({ id: uid(), ...item, length, width, thickness })
  }

  // ── Outer shell (5 panels) ──────────────────────────────────────────────

  addItem({ category: 'shell', name: 'Left Side',    length: H, width: D,  thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Right Side',   length: H, width: D,  thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Top Panel',    length: iW, width: D, thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Bottom Panel', length: iW, width: D, thickness: T, qty: 1 })
  addItem({ category: 'shell', name: 'Back Panel',   length: H, width: W,  thickness: B, qty: 1 })

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
  const bounds = [0, ...sorted.map((p) => p.fromLeft), iW]
  const sections = bounds.slice(0, -1).map((fromLeft, i) => ({
    index:    i,
    fromLeft,
    width:    Math.round(bounds[i + 1] - fromLeft),
  }))

  // ── Shelves (each shelf lives in exactly one section) ──────────────────

  if (shelves.length > 0) {
    // Group identical-length shelves to consolidate qty
    const byLength: Record<number, number> = {}
    shelves.forEach((shelf) => {
      const sec = sections[shelf.sectionIndex]
      if (!sec) return
      const shelfL = Math.round(getUsableSectionWidth(sec.width, shelf.sectionIndex, sorted.length, T))
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

  drawers.forEach((drawer, i) => {
    const section = sections[drawer.sectionIndex]
    if (!section) return

    const usableW = getUsableSectionWidth(section.width, drawer.sectionIndex, sorted.length, T)
    const maxSetback = Math.max(0, iD - T - 16 - 1)
    const frontSetback = Math.max(0, Math.min(Math.round(drawer.frontSetback ?? 0), maxSetback))
    const fW  = Math.round(usableW)              // front width, matching the canvas section opening
    const fH  = drawer.height - 2                // front height (2mm clearance)
    const boxSideH = Math.round(drawer.height - T - DRAWER_BOX_HEIGHT_ALLOWANCE)
    const boxL     = Math.round(iD - frontSetback - T - 16)
    const boxW     = Math.round(fW - 32)                 // box width (leaving 16mm each side for slides)

    addItem({
      category: 'drawer_front', name: `Drawer Front ${i + 1}`,
      length: fW, width: fH, thickness: T, qty: 1,
    })
    addItem({
      category: 'drawer_box', name: `Drawer Side ${i + 1}`,
      length: boxL, width: boxSideH, thickness: 15, qty: 2,
    })
    addItem({
      category: 'drawer_box', name: `Drawer Back ${i + 1}`,
      length: boxW, width: boxSideH, thickness: 15, qty: 1,
    })
    addItem({
      category: 'drawer_box', name: `Drawer Bottom ${i + 1}`,
      length: boxW, width: boxL, thickness: 9, qty: 1,
    })
  })

  // ── Doors ───────────────────────────────────────────────────────────────

  sections.forEach((section) => {
    const cfg = sectionConfigs[section.index] ?? DEFAULT_SECTION_CONFIG
    if (cfg.door === 'none') return

    const doorW = Math.round(section.width - 2)   // 1mm clearance each side
    const doorH = Math.round(iH - 2)              // 1mm clearance top + bottom

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
        length: Math.round((section.width - 4) / 2), width: doorH, thickness: T, qty: 2,
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

  return { items, totalPieces, totalAreaM2, groups }
}
