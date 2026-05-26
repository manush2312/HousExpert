import { create } from 'zustand'
import type {
  CreateFurnitureDesignPayload,
  FurnitureDesign,
  FurnitureType,
} from '../services/furnitureDesignService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrawingMode = 'draw_box' | 'select' | 'pan' | 'add_shelf' | 'add_partition' | 'add_drawer' | 'add_custom_panel'
export type DoorType = 'none' | 'single' | 'double'

export interface SectionConfig {
  door: DoorType
  hangingRail: boolean
}

export const DEFAULT_SECTION_CONFIG: SectionConfig = {
  door: 'none',
  hangingRail: false,
}

export interface OuterBox {
  width: number    // mm
  height: number   // mm
  depth: number    // mm — set separately since it can't be drawn in 2D
}

export interface Shelf {
  id: string
  fromBottom: number   // mm from interior bottom
  sectionIndex: number // which section this shelf belongs to (0 = leftmost)
}

export interface Partition {
  id: string
  fromLeft: number     // mm from interior left edge
}

export interface ShelfPartition {
  id: string
  sectionIndex: number  // which main section (between full-height partitions)
  fromLeft: number      // mm from interior left
  fromBottom: number    // mm from interior bottom (bottom of vertical span)
  toBottom: number      // mm from interior bottom (top of vertical span)
}

export interface Drawer {
  id: string
  sectionIndex: number // which section (0 = leftmost)
  fromBottom: number   // mm from interior bottom of that section
  height: number       // mm
  frontSetback: number  // mm behind the front/door plane
}

export interface Material {
  thickness: number           // mm, typically 18
  backPanelThickness: number  // mm, typically 6
  color: string               // hex color for 3D preview
}

export interface CustomPanel {
  id:        string
  name:      string
  fromLeft:  number   // mm from interior left edge
  fromBottom: number  // mm from interior bottom
  width:     number   // mm (horizontal)
  height:    number   // mm (vertical)
  thickness: number   // mm
}

// A section is the space between two partitions (or wall-to-partition).
// Derived — not stored, computed from partitions + outerBox.
export interface Section {
  index: number
  fromLeft: number     // mm from interior left
  width: number        // mm
  shelves: Shelf[]
  drawers: Drawer[]
}

// ── State ─────────────────────────────────────────────────────────────────────

interface FurnitureState {
  // Design meta
  designId: string | null
  designName: string
  furnitureType: FurnitureType
  hasUnsavedChanges: boolean
  lastSavedAt: string | null

  // Outer box — null until drawn
  outerBox: OuterBox | null

  // Material
  material: Material

  // Internal elements (all positions in mm)
  shelves: Shelf[]
  partitions: Partition[]
  drawers: Drawer[]
  customPanels: CustomPanel[]
  shelfPartitions: ShelfPartition[]

  // Per-section configuration (keyed by section index)
  sectionConfigs: Record<number, SectionConfig>

  // UI state
  mode: DrawingMode
  selectedId: string | null

  // ── Derived getters ──────────────────────────────────────────────────────

  getSections: () => Section[]

  // ── Actions ──────────────────────────────────────────────────────────────

  setDesignName: (name: string) => void
  setFurnitureType: (type: FurnitureType) => void
  setMode: (mode: DrawingMode) => void
  setSelected: (id: string | null) => void
  serializeDesign: () => CreateFurnitureDesignPayload
  loadDesign: (design: FurnitureDesign) => void
  markSaved: (design?: FurnitureDesign) => void

  // Outer box
  setOuterBox: (box: OuterBox) => void
  setDepth: (depth: number) => void
  clearOuterBox: () => void

  // Material
  setThickness: (mm: number) => void
  setBackPanelThickness: (mm: number) => void
  setMaterialColor: (color: string) => void

  // Add elements
  addShelf: (fromBottom: number, sectionIndex: number) => void
  addPartition: (fromLeft: number) => void
  addDrawer: (sectionIndex: number, fromBottom: number, height: number) => void
  addShelfPartition: (sectionIndex: number, fromLeft: number, fromBottom: number, toBottom: number) => void

  // Move elements (drag)
  moveShelf: (id: string, fromBottom: number) => void
  movePartition: (id: string, fromLeft: number) => void
  moveDrawer: (id: string, fromBottom: number) => void
  moveShelfPartition: (id: string, fromLeft: number) => void
  setDrawerFrontSetback: (id: string, frontSetback: number) => void

  // Custom panels
  addCustomPanel: (panel: Omit<CustomPanel, 'id'>) => void
  moveCustomPanel: (id: string, fromLeft: number, fromBottom: number) => void
  renameCustomPanel: (id: string, name: string) => void

  // Section config (door, hanging rail)
  setSectionConfig: (index: number, patch: Partial<SectionConfig>) => void

  // Remove
  removeSelected: () => void

  // Reset everything
  reset: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let nextId = 1
function uid() { return `el-${nextId++}` }

function rememberElementId(id: string) {
  const match = /^el-(\d+)$/.exec(id)
  if (!match) return
  nextId = Math.max(nextId, Number(match[1]) + 1)
}

function localElementId(elementId: string | undefined) {
  if (!elementId) return uid()
  rememberElementId(elementId)
  return elementId
}

export const DEFAULT_BACK_PANEL_THICKNESS = 6
export const DRAWER_BOX_HEIGHT_ALLOWANCE = 6
const DRAWER_DEPTH_CLEARANCE = 16

function snap(value: number, step = 1): number {
  const safeValue = Number.isFinite(value) ? value : 0
  return Math.round(safeValue / step) * step
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(value, max))
}

function minOuterDimension(thickness: number): number {
  return thickness * 2 + 1
}

function minDrawerHeight(thickness: number): number {
  return Math.max(20, thickness + DRAWER_BOX_HEIGHT_ALLOWANCE + 1)
}

function partitionInsertBounds(partitions: Partition[], target: number, interiorW: number, thickness: number) {
  const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
  const nextIdx = sorted.findIndex((p) => p.fromLeft > target)
  const left = nextIdx === -1 ? sorted[sorted.length - 1] : sorted[nextIdx - 1]
  const right = nextIdx === -1 ? undefined : sorted[nextIdx]
  const min = left ? left.fromLeft + thickness : thickness / 2
  const max = right ? right.fromLeft - thickness : interiorW - thickness / 2
  if (max < min) return null
  return { min, max }
}

function partitionMoveBounds(partitions: Partition[], id: string, interiorW: number, thickness: number) {
  const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
  const idx = sorted.findIndex((p) => p.id === id)
  if (idx < 0) return null
  const left = sorted[idx - 1]
  const right = sorted[idx + 1]
  const min = left ? left.fromLeft + thickness : thickness / 2
  const max = right ? right.fromLeft - thickness : interiorW - thickness / 2
  if (max < min) return null
  return { min, max }
}

function sectionDividerBounds(
  partitions: Partition[],
  sectionIndex: number,
  interiorW: number,
  thickness: number,
) {
  const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
  const leftBoundary = sectionIndex === 0 ? 0 : sorted[sectionIndex - 1]?.fromLeft
  const rightBoundary = sectionIndex === sorted.length ? interiorW : sorted[sectionIndex]?.fromLeft
  if (leftBoundary === undefined || rightBoundary === undefined) return null
  const min = leftBoundary + (sectionIndex === 0 ? thickness / 2 : thickness)
  const max = rightBoundary - (sectionIndex === sorted.length ? thickness / 2 : thickness)
  if (max < min) return null
  return { min, max }
}

function backPanelThicknessOf(material: Material) {
  return material.backPanelThickness ?? DEFAULT_BACK_PANEL_THICKNESS
}

function maxDrawerFrontSetback(outerBox: OuterBox, thickness: number, backPanelThickness: number) {
  const interiorD = outerBox.depth - backPanelThickness
  return Math.max(0, interiorD - thickness - DRAWER_DEPTH_CLEARANCE - 1)
}

function clampDrawerFrontSetbacks(drawers: Drawer[], outerBox: OuterBox, material: Material) {
  const maxSetback = maxDrawerFrontSetback(
    outerBox,
    material.thickness,
    backPanelThicknessOf(material),
  )
  return drawers.map((drawer) => ({
    ...drawer,
    frontSetback: clamp(snap(drawer.frontSetback ?? 0), 0, maxSetback),
  }))
}

function shiftSectionConfigsForInsert(
  configs: Record<number, SectionConfig>,
  insertionIdx: number,
): Record<number, SectionConfig> {
  return Object.fromEntries(
    Object.entries(configs).map(([key, value]) => {
      const idx = Number(key)
      return [idx > insertionIdx ? idx + 1 : idx, value]
    }),
  )
}

function shiftSectionConfigsForRemove(
  configs: Record<number, SectionConfig>,
  removeIdx: number,
): Record<number, SectionConfig> {
  const next: Record<number, SectionConfig> = {}
  const hasLeftConfig = configs[removeIdx] !== undefined
  Object.entries(configs).forEach(([key, value]) => {
    const idx = Number(key)
    if (idx <= removeIdx) next[idx] = value
    else if (idx === removeIdx + 1) {
      if (!hasLeftConfig) next[removeIdx] = value
    } else next[idx - 1] = value
  })
  return next
}

function clampCustomPanel(panel: Omit<CustomPanel, 'id'>, outerBox: OuterBox, thickness: number) {
  const interiorW = Math.max(1, outerBox.width - thickness * 2)
  const interiorH = Math.max(1, outerBox.height - thickness * 2)
  const width = clamp(snap(panel.width), 1, interiorW)
  const height = clamp(snap(panel.height), 1, interiorH)

  return {
    ...panel,
    fromLeft: clamp(snap(panel.fromLeft), 0, interiorW - width),
    fromBottom: clamp(snap(panel.fromBottom), 0, interiorH - height),
    width,
    height,
    thickness: Math.max(1, snap(panel.thickness)),
  }
}

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULT_MATERIAL: Material = {
  thickness: 18,
  backPanelThickness: DEFAULT_BACK_PANEL_THICKNESS,
  color: '#c8a96e',
}

function serializeFurnitureDesignState(s: FurnitureState): CreateFurnitureDesignPayload {
  return {
    name: s.designName,
    furniture_type: s.furnitureType,
    outer_box: s.outerBox,
    material: {
      thickness: s.material.thickness,
      back_panel_thickness: s.material.backPanelThickness,
      color: s.material.color,
    },
    shelves: s.shelves.map((shelf) => ({
      element_id: shelf.id,
      from_bottom: shelf.fromBottom,
      section_index: shelf.sectionIndex,
    })),
    partitions: s.partitions.map((partition) => ({
      element_id: partition.id,
      from_left: partition.fromLeft,
    })),
    drawers: s.drawers.map((drawer) => ({
      element_id: drawer.id,
      section_index: drawer.sectionIndex,
      from_bottom: drawer.fromBottom,
      height: drawer.height,
      front_setback: drawer.frontSetback,
    })),
    custom_panels: s.customPanels.map((panel) => ({
      element_id: panel.id,
      name: panel.name,
      from_left: panel.fromLeft,
      from_bottom: panel.fromBottom,
      width: panel.width,
      height: panel.height,
      thickness: panel.thickness,
    })),
    shelf_partitions: s.shelfPartitions.map((partition) => ({
      element_id: partition.id,
      section_index: partition.sectionIndex,
      from_left: partition.fromLeft,
      from_bottom: partition.fromBottom,
      to_bottom: partition.toBottom,
    })),
    section_configs: Object.fromEntries(
      Object.entries(s.sectionConfigs).map(([key, cfg]) => [
        key,
        { door: cfg.door, hanging_rail: cfg.hangingRail },
      ]),
    ),
  }
}

function sectionConfigsFromDesign(design: FurnitureDesign): Record<number, SectionConfig> {
  return Object.fromEntries(
    Object.entries(design.section_configs ?? {})
      .map(([key, cfg]) => {
        const index = Number(key)
        if (!Number.isFinite(index)) return null
        return [index, {
          door: cfg.door ?? 'none',
          hangingRail: Boolean(cfg.hanging_rail),
        }] as const
      })
      .filter((entry): entry is readonly [number, SectionConfig] => entry != null),
  )
}

function storePatchFromDesign(design: FurnitureDesign): Partial<FurnitureState> {
  return {
    designId: design.design_id,
    designName: design.name || 'Untitled Design',
    furnitureType: design.furniture_type || 'wardrobe',
    outerBox: design.outer_box
      ? {
          width: design.outer_box.width,
          height: design.outer_box.height,
          depth: design.outer_box.depth,
        }
      : null,
    material: {
      thickness: design.material?.thickness ?? DEFAULT_MATERIAL.thickness,
      backPanelThickness: design.material?.back_panel_thickness ?? DEFAULT_MATERIAL.backPanelThickness,
      color: design.material?.color || DEFAULT_MATERIAL.color,
    },
    shelves: (design.shelves ?? []).map((shelf) => ({
      id: localElementId(shelf.element_id),
      fromBottom: shelf.from_bottom,
      sectionIndex: shelf.section_index,
    })),
    partitions: (design.partitions ?? []).map((partition) => ({
      id: localElementId(partition.element_id),
      fromLeft: partition.from_left,
    })),
    drawers: (design.drawers ?? []).map((drawer) => ({
      id: localElementId(drawer.element_id),
      sectionIndex: drawer.section_index,
      fromBottom: drawer.from_bottom,
      height: drawer.height,
      frontSetback: drawer.front_setback,
    })),
    customPanels: (design.custom_panels ?? []).map((panel) => ({
      id: localElementId(panel.element_id),
      name: panel.name,
      fromLeft: panel.from_left,
      fromBottom: panel.from_bottom,
      width: panel.width,
      height: panel.height,
      thickness: panel.thickness,
    })),
    shelfPartitions: (design.shelf_partitions ?? []).map((partition) => ({
      id: localElementId(partition.element_id),
      sectionIndex: partition.section_index,
      fromLeft: partition.from_left,
      fromBottom: partition.from_bottom,
      toBottom: partition.to_bottom,
    })),
    sectionConfigs: sectionConfigsFromDesign(design),
    mode: design.outer_box ? 'select' : 'draw_box',
    selectedId: null,
    hasUnsavedChanges: false,
    lastSavedAt: design.updated_at ?? new Date().toISOString(),
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useFurnitureStore = create<FurnitureState>((set, get) => ({
  designId: null,
  designName: 'Untitled Design',
  furnitureType: 'wardrobe',
  hasUnsavedChanges: false,
  lastSavedAt: null,
  outerBox: null,
  material: DEFAULT_MATERIAL,
  shelves: [],
  partitions: [],
  drawers: [],
  customPanels: [],
  shelfPartitions: [],
  sectionConfigs: {},
  mode: 'draw_box',
  selectedId: null,

  // ── Derived ───────────────────────────────────────────────────────────────

  getSections: () => {
    const { outerBox, partitions, shelves, drawers, material } = get()
    if (!outerBox) return []

    const T = material.thickness
    const interiorWidth = outerBox.width - T * 2

    // Sort partitions left to right
    const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)

    // Build section boundaries
    const boundaries: number[] = [0, ...sorted.map((p) => p.fromLeft), interiorWidth]

    return boundaries.slice(0, -1).map((fromLeft, i) => {
      const toLeft = boundaries[i + 1]
      const width = toLeft - fromLeft

      return {
        index: i,
        fromLeft,
        width,
        shelves: shelves.filter((sh) => sh.sectionIndex === i),
        drawers: drawers.filter((d) => d.sectionIndex === i),
      }
    })
  },

  // ── Actions ───────────────────────────────────────────────────────────────

  setDesignName: (name) => set({ designName: name, hasUnsavedChanges: true }),
  setFurnitureType: (type) => set({ furnitureType: type, hasUnsavedChanges: true }),
  setMode: (mode) => set({ mode }),
  setSelected: (id) => set({ selectedId: id }),
  serializeDesign: () => serializeFurnitureDesignState(get()),
  loadDesign: (design) => set(storePatchFromDesign(design)),
  markSaved: (design) => set((s) => design
    ? storePatchFromDesign(design)
    : { hasUnsavedChanges: false, lastSavedAt: s.lastSavedAt ?? new Date().toISOString() }),

  setOuterBox: (box) => {
    const { material } = get()
    const minOuter = minOuterDimension(material.thickness)
    const minDepth = backPanelThicknessOf(material) + 1
    set({
      outerBox: {
        width: Math.max(minOuter, snap(box.width)),
        height: Math.max(minOuter, snap(box.height)),
        depth: Math.max(minDepth, snap(box.depth)),
      },
      // Switch to select mode once box is drawn
      mode: 'select',
      hasUnsavedChanges: true,
    })
  },

  setDepth: (depth) => set((s) => {
    if (!s.outerBox) return { outerBox: null }
    const nextOuterBox = {
      ...s.outerBox,
      depth: Math.max(backPanelThicknessOf(s.material) + 1, snap(depth)),
    }
    return {
      outerBox: nextOuterBox,
      drawers: clampDrawerFrontSetbacks(s.drawers, nextOuterBox, s.material),
      hasUnsavedChanges: true,
    }
  }),

  clearOuterBox: () => set({
    outerBox: null,
    shelves: [],
    partitions: [],
    drawers: [],
    customPanels: [],
    shelfPartitions: [],
    sectionConfigs: {},
    mode: 'draw_box',
    selectedId: null,
    hasUnsavedChanges: true,
  }),

  setThickness: (mm) => set((s) => {
    const requested = Math.max(1, snap(mm))
    if (!s.outerBox) return { material: { ...s.material, thickness: requested }, hasUnsavedChanges: true }
    const maxThickness = Math.max(1, Math.floor((Math.min(s.outerBox.width, s.outerBox.height) - 1) / 2))
    const material = { ...s.material, thickness: clamp(requested, 1, maxThickness) }
    return {
      material,
      drawers: clampDrawerFrontSetbacks(s.drawers, s.outerBox, material),
      hasUnsavedChanges: true,
    }
  }),
  setBackPanelThickness: (mm) => set((s) => {
    const requested = Math.max(1, snap(mm))
    if (!s.outerBox) return { material: { ...s.material, backPanelThickness: requested }, hasUnsavedChanges: true }
    const maxBackPanelThickness = Math.max(1, s.outerBox.depth - 1)
    const material = {
      ...s.material,
      backPanelThickness: clamp(requested, 1, maxBackPanelThickness),
    }
    return {
      material,
      drawers: clampDrawerFrontSetbacks(s.drawers, s.outerBox, material),
      hasUnsavedChanges: true,
    }
  }),
  setMaterialColor: (color) => set((s) => ({ material: { ...s.material, color }, hasUnsavedChanges: true })),

  addShelf: (fromBottom, sectionIndex) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    if (interiorH <= 0) return
    const clamped = clamp(snap(fromBottom), T / 2, interiorH - T / 2)
    set((s) => ({ shelves: [...s.shelves, { id: uid(), fromBottom: clamped, sectionIndex }], hasUnsavedChanges: true }))
  },

  addPartition: (fromLeft) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    if (interiorW <= T) return
    const target = snap(fromLeft)
    const bounds = partitionInsertBounds(partitions, target, interiorW, T)
    if (!bounds) return
    const clamped = clamp(target, bounds.min, bounds.max)

    // Count how many existing partitions sit to the LEFT of the new one.
    // That count = the new partition's position in sorted order.
    // Every section whose index is GREATER than that position shifts right by 1.
    const insertionIdx = partitions.filter((p) => p.fromLeft < clamped).length

    set((s) => {
      const shiftIdx = (idx: number) => idx > insertionIdx ? idx + 1 : idx
      return {
        partitions:      [...s.partitions, { id: uid(), fromLeft: clamped }],
        shelves:         s.shelves.map((sh) => ({ ...sh, sectionIndex: shiftIdx(sh.sectionIndex) })),
        drawers:         s.drawers.map((d)  => ({ ...d,  sectionIndex: shiftIdx(d.sectionIndex)  })),
        shelfPartitions: s.shelfPartitions.map((sp) => ({ ...sp, sectionIndex: shiftIdx(sp.sectionIndex) })),
        sectionConfigs:  shiftSectionConfigsForInsert(s.sectionConfigs, insertionIdx),
        hasUnsavedChanges: true,
      }
    })
  },

  addDrawer: (sectionIndex, fromBottom, height) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const interiorH = outerBox.height - material.thickness * 2
    if (interiorH <= 0) return
    const minH = Math.min(interiorH, minDrawerHeight(material.thickness))
    const snappedH = clamp(snap(height), minH, interiorH)
    const snapped = clamp(snap(fromBottom), 0, interiorH - snappedH)
    set((s) => ({
      drawers: [...s.drawers, { id: uid(), sectionIndex, fromBottom: snapped, height: snappedH, frontSetback: 0 }],
      hasUnsavedChanges: true,
    }))
  },

  moveShelf: (id, fromBottom) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    if (interiorH <= 0) return
    const clamped = clamp(snap(fromBottom), T / 2, interiorH - T / 2)
    set((s) => ({
      shelves: s.shelves.map((sh) => sh.id === id ? { ...sh, fromBottom: clamped } : sh),
      hasUnsavedChanges: true,
    }))
  },

  movePartition: (id, fromLeft) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const bounds = partitionMoveBounds(partitions, id, interiorW, T)
    if (!bounds) return
    const clamped = clamp(snap(fromLeft), bounds.min, bounds.max)
    set((s) => ({
      partitions: s.partitions.map((p) => p.id === id ? { ...p, fromLeft: clamped } : p),
      hasUnsavedChanges: true,
    }))
  },

  moveDrawer: (id, fromBottom) => {
    const { outerBox, material, drawers } = get()
    if (!outerBox) return
    const drawer = drawers.find((d) => d.id === id)
    if (!drawer) return
    const interiorH = outerBox.height - material.thickness * 2
    const snapped = clamp(snap(fromBottom), 0, Math.max(0, interiorH - drawer.height))
    set((s) => ({
      drawers: s.drawers.map((d) => d.id === id ? { ...d, fromBottom: snapped } : d),
      hasUnsavedChanges: true,
    }))
  },

  setDrawerFrontSetback: (id, frontSetback) => {
    const { outerBox, material, drawers } = get()
    if (!outerBox) return
    const drawer = drawers.find((d) => d.id === id)
    if (!drawer) return
    const clamped = clamp(
      snap(frontSetback),
      0,
      maxDrawerFrontSetback(outerBox, material.thickness, backPanelThicknessOf(material)),
    )
    set((s) => ({
      drawers: s.drawers.map((d) => d.id === id ? { ...d, frontSetback: clamped } : d),
      hasUnsavedChanges: true,
    }))
  },

  addShelfPartition: (sectionIndex, fromLeft, fromBottom, toBottom) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const bounds = sectionDividerBounds(partitions, sectionIndex, interiorW, T)
    if (!bounds) return
    const clamped = clamp(snap(fromLeft), bounds.min, bounds.max)
    set((s) => ({
      shelfPartitions: [...s.shelfPartitions, {
        id: uid(),
        sectionIndex,
        fromLeft: clamped,
        fromBottom: snap(fromBottom),
        toBottom: snap(toBottom),
      }],
      hasUnsavedChanges: true,
    }))
  },

  moveShelfPartition: (id, fromLeft) => {
    const { outerBox, material, partitions, shelfPartitions } = get()
    if (!outerBox) return
    const shelfPartition = shelfPartitions.find((sp) => sp.id === id)
    if (!shelfPartition) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const bounds = sectionDividerBounds(partitions, shelfPartition.sectionIndex, interiorW, T)
    if (!bounds) return
    const clamped = clamp(snap(fromLeft), bounds.min, bounds.max)
    set((s) => ({
      shelfPartitions: s.shelfPartitions.map((sp) =>
        sp.id === id ? { ...sp, fromLeft: clamped } : sp,
      ),
      hasUnsavedChanges: true,
    }))
  },

  addCustomPanel: (panel) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const clamped = clampCustomPanel(panel, outerBox, material.thickness)
    set((s) => ({
      customPanels: [...s.customPanels, { ...clamped, id: uid() }],
      hasUnsavedChanges: true,
    }))
  },

  moveCustomPanel: (id, fromLeft, fromBottom) => {
    const { outerBox, material, customPanels } = get()
    if (!outerBox) return
    const panel = customPanels.find((p) => p.id === id)
    if (!panel) return
    const clamped = clampCustomPanel({ ...panel, fromLeft, fromBottom }, outerBox, material.thickness)
    set((s) => ({
      customPanels: s.customPanels.map((p) =>
        p.id === id ? { ...p, fromLeft: clamped.fromLeft, fromBottom: clamped.fromBottom } : p,
      ),
      hasUnsavedChanges: true,
    }))
  },

  renameCustomPanel: (id, name) => set((s) => ({
    customPanels: s.customPanels.map((p) => p.id === id ? { ...p, name } : p),
    hasUnsavedChanges: true,
  })),

  setSectionConfig: (index, patch) => set((s) => ({
    sectionConfigs: {
      ...s.sectionConfigs,
      [index]: { ...(s.sectionConfigs[index] ?? DEFAULT_SECTION_CONFIG), ...patch },
    },
    hasUnsavedChanges: true,
  })),

  removeSelected: () => {
    const { selectedId, partitions } = get()
    if (!selectedId) return

    const removedPartition = partitions.find((p) => p.id === selectedId)

    if (removedPartition) {
      // Find sorted index so we know which sections shift left
      const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
      const removeIdx = sorted.findIndex((p) => p.id === selectedId)
      // All elements in sections > removeIdx merge down by 1
      set((s) => ({
        partitions:      s.partitions.filter((p) => p.id !== selectedId),
        shelves:         s.shelves.map((sh) =>
          sh.sectionIndex > removeIdx ? { ...sh, sectionIndex: sh.sectionIndex - 1 } : sh,
        ),
        drawers:         s.drawers.map((d) =>
          d.sectionIndex > removeIdx ? { ...d, sectionIndex: d.sectionIndex - 1 } : d,
        ),
        shelfPartitions: s.shelfPartitions.map((sp) =>
          sp.sectionIndex > removeIdx ? { ...sp, sectionIndex: sp.sectionIndex - 1 } : sp,
        ),
        customPanels:    s.customPanels,
        sectionConfigs:  shiftSectionConfigsForRemove(s.sectionConfigs, removeIdx),
        selectedId:      null,
        hasUnsavedChanges: true,
      }))
    } else {
      set((s) => ({
        shelves:         s.shelves.filter((sh) => sh.id !== selectedId),
        partitions:      s.partitions.filter((p)  => p.id  !== selectedId),
        drawers:         s.drawers.filter((d)  => d.id  !== selectedId),
        customPanels:    s.customPanels.filter((cp) => cp.id !== selectedId),
        shelfPartitions: s.shelfPartitions.filter((sp) => sp.id !== selectedId),
        selectedId: null,
        hasUnsavedChanges: true,
      }))
    }
  },

  reset: () => set({
    designId: null,
    designName: 'Untitled Design',
    furnitureType: 'wardrobe',
    hasUnsavedChanges: false,
    lastSavedAt: null,
    outerBox: null,
    material: DEFAULT_MATERIAL,
    shelves: [],
    partitions: [],
    drawers: [],
    customPanels: [],
    shelfPartitions: [],
    sectionConfigs: {},
    mode: 'draw_box',
    selectedId: null,
  }),
}))
