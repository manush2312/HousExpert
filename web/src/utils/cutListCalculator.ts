import type { OuterBox, Shelf, Partition, Drawer, Material, CustomPanel } from '../stores/furnitureStore'
import { DEFAULT_SECTION_CONFIG } from '../stores/furnitureStore'

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

// ── Calculator ────────────────────────────────────────────────────────────────

export function calculateCutList(
  outerBox:       OuterBox,
  shelves:        Shelf[],
  partitions:     Partition[],
  drawers:        Drawer[],
  material:       Material,
  sectionConfigs: Record<number, { door: string; hangingRail: boolean }> = {},
  customPanels:   CustomPanel[] = [],
): CutListSummary {
  const { width: W, height: H, depth: D } = outerBox
  const T  = material.thickness
  const iW = W - T * 2          // interior width
  const iH = H - T * 2          // interior height
  const iD = D - 6               // interior depth (minus 6mm back panel)

  let seq = 0
  const uid = () => `cl-${seq++}`
  const items: CutListItem[] = []

  // ── Outer shell (5 panels) ──────────────────────────────────────────────

  items.push({ id: uid(), category: 'shell', name: 'Left Side',    length: H, width: D,  thickness: T, qty: 1 })
  items.push({ id: uid(), category: 'shell', name: 'Right Side',   length: H, width: D,  thickness: T, qty: 1 })
  items.push({ id: uid(), category: 'shell', name: 'Top Panel',    length: iW, width: D, thickness: T, qty: 1 })
  items.push({ id: uid(), category: 'shell', name: 'Bottom Panel', length: iW, width: D, thickness: T, qty: 1 })
  items.push({ id: uid(), category: 'shell', name: 'Back Panel',   length: H, width: W,  thickness: 6, qty: 1 })

  // ── Partitions ──────────────────────────────────────────────────────────

  if (partitions.length > 0) {
    items.push({
      id: uid(), category: 'partition', name: 'Vertical Partition',
      length: iH, width: iD, thickness: T,
      qty: partitions.length,
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

  // ── Shelves (one board per section per shelf) ───────────────────────────

  if (shelves.length > 0) {
    // Group sections by their width to consolidate identical pieces
    const byWidth: Record<number, number> = {}
    sections.forEach((s) => {
      const shelfL = Math.round(s.width - T)   // butt-joint: shelf fits between panels
      byWidth[shelfL] = (byWidth[shelfL] ?? 0) + shelves.length
    })
    Object.entries(byWidth).forEach(([lenStr, qty]) => {
      items.push({
        id: uid(), category: 'shelf', name: 'Shelf',
        length: Number(lenStr), width: Math.round(iD), thickness: T, qty,
      })
    })
  }

  // ── Drawers ─────────────────────────────────────────────────────────────

  drawers.forEach((drawer, i) => {
    const section = sections[drawer.sectionIndex]
    if (!section) return

    const fW  = Math.round(section.width - T)   // front width
    const fH  = drawer.height - 2                // front height (2mm clearance)
    const boxSideH = Math.round(drawer.height - T - 6)  // box side height
    const boxL     = Math.round(iD - T - 16)             // drawer depth inside carcass
    const boxW     = Math.round(fW - 32)                 // box width (leaving 16mm each side for slides)

    items.push({
      id: uid(), category: 'drawer_front', name: `Drawer Front ${i + 1}`,
      length: fW, width: fH, thickness: T, qty: 1,
    })
    items.push({
      id: uid(), category: 'drawer_box', name: `Drawer Side ${i + 1}`,
      length: boxL, width: boxSideH, thickness: 15, qty: 2,
    })
    items.push({
      id: uid(), category: 'drawer_box', name: `Drawer Back ${i + 1}`,
      length: boxW, width: boxSideH, thickness: 15, qty: 1,
    })
    items.push({
      id: uid(), category: 'drawer_box', name: `Drawer Bottom ${i + 1}`,
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
      items.push({
        id: uid(), category: 'door',
        name: `Door (Section ${section.index + 1})`,
        length: doorW, width: doorH, thickness: T, qty: 1,
      })
    } else if (cfg.door === 'double') {
      items.push({
        id: uid(), category: 'door',
        name: `Door (Section ${section.index + 1})`,
        length: Math.round(doorW / 2), width: doorH, thickness: T, qty: 2,
      })
    }
  })

  // ── Custom panels ────────────────────────────────────────────────────────

  customPanels.forEach((cp) => {
    items.push({
      id:        uid(),
      category:  'custom',
      name:      cp.name,
      length:    cp.width,      // horizontal dimension as drawn
      width:     cp.height,     // vertical dimension as drawn
      thickness: cp.thickness,
      qty:       1,
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
