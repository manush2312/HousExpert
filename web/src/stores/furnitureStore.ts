import { create } from 'zustand'
import type {
  CreateFurnitureDesignPayload,
  FurnitureDesign,
  FurnitureType,
} from '../services/furnitureDesignService'
import {
  FURNITURE_BOX_FRAME_PADDING,
  furnitureCanvasPxToMm,
} from '../utils/furnitureCanvasGeometry'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrawingMode = 'draw_box' | 'select' | 'pan' | 'add_shelf' | 'add_partition' | 'add_drawer' | 'add_custom_panel' | 'fill_gap' | 'pencil'
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

export interface FreehandPath {
  id: string
  points: number[]
  stroke: string
  strokeWidth: number
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

export interface FurnitureSnapshot {
  designName: string
  furnitureType: FurnitureType
  outerBox: OuterBox | null
  material: Material
  shelves: Shelf[]
  partitions: Partition[]
  drawers: Drawer[]
  customPanels: CustomPanel[]
  shelfPartitions: ShelfPartition[]
  freehandPaths: FreehandPath[]
  sectionConfigs: Record<number, SectionConfig>
}

export const MAX_FURNITURE_HISTORY = 100
export const OUTER_BOX_SELECTION_ID = 'outer-box'

export type SelectedFurnitureItem =
  | { type: 'outer_box'; id: typeof OUTER_BOX_SELECTION_ID; item: OuterBox }
  | { type: 'shelf'; id: string; item: Shelf }
  | { type: 'partition'; id: string; item: Partition }
  | { type: 'shelf_partition'; id: string; item: ShelfPartition }
  | { type: 'drawer'; id: string; item: Drawer }
  | { type: 'custom_panel'; id: string; item: CustomPanel }
  | { type: 'freehand_path'; id: string; item: FreehandPath }

export type ShelfUpdate = Partial<Pick<Shelf, 'fromBottom' | 'sectionIndex'>>
export type PartitionUpdate = Partial<Pick<Partition, 'fromLeft'>>
export type DrawerUpdate = Partial<Pick<Drawer, 'sectionIndex' | 'fromBottom' | 'height' | 'frontSetback'>>
export type ShelfPartitionUpdate = Partial<Pick<ShelfPartition, 'sectionIndex' | 'fromLeft' | 'fromBottom' | 'toBottom'>>
export type CustomPanelUpdate = Partial<Omit<CustomPanel, 'id'>>
export type FreehandPathUpdate = Partial<Pick<FreehandPath, 'points' | 'stroke' | 'strokeWidth'>>

// ── State ─────────────────────────────────────────────────────────────────────

interface FurnitureState {
  // Design meta
  designId: string | null
  designName: string
  furnitureType: FurnitureType
  hasUnsavedChanges: boolean
  lastSavedAt: string | null
  savedSnapshot: FurnitureSnapshot | null
  past: FurnitureSnapshot[]
  future: FurnitureSnapshot[]

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
  freehandPaths: FreehandPath[]

  // Per-section configuration (keyed by section index)
  sectionConfigs: Record<number, SectionConfig>

  // UI state
  mode: DrawingMode
  selectedId: string | null
  pencilStroke: string
  pencilStrokeWidth: number
  pencilSnapEnabled: boolean

  // ── Derived getters ──────────────────────────────────────────────────────

  getSections: () => Section[]
  getSelectedItem: () => SelectedFurnitureItem | null

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
  updateOuterBox: (patch: Partial<OuterBox>) => void
  setDepth: (depth: number) => void
  clearOuterBox: () => void

  // Material
  setThickness: (mm: number) => void
  setBackPanelThickness: (mm: number) => void
  setMaterialColor: (color: string) => void

  // Add elements
  addShelf: (fromBottom: number, sectionIndex: number) => void
  addPartition: (fromLeft: number) => void
  addEqualShelves: (count: number, sectionIndex: number, bottomMargin?: number, topMargin?: number) => void
  addEqualPartitions: (count: number, sectionIndex: number, leftMargin?: number, rightMargin?: number) => void
  addEqualShelfPartitions: (
    count: number,
    sectionIndex: number,
    fromBottom: number,
    toBottom: number,
    fromLeft: number,
    toLeft: number,
  ) => void
  addDrawer: (sectionIndex: number, fromBottom: number, height: number) => void
  addShelfPartition: (sectionIndex: number, fromLeft: number, fromBottom: number, toBottom: number) => void
  addFreehandPath: (path: Omit<FreehandPath, 'id'>) => void
  setPencilStroke: (stroke: string) => void
  setPencilStrokeWidth: (strokeWidth: number) => void
  setPencilSnapEnabled: (enabled: boolean) => void

  // Exact item edits
  updateShelf: (id: string, patch: ShelfUpdate) => void
  updatePartition: (id: string, patch: PartitionUpdate) => void
  updateDrawer: (id: string, patch: DrawerUpdate) => void
  updateShelfPartition: (id: string, patch: ShelfPartitionUpdate) => void
  updateCustomPanel: (id: string, patch: CustomPanelUpdate) => void
  updateFreehandPath: (id: string, patch: FreehandPathUpdate) => void

  // Move elements (drag)
  moveShelf: (id: string, fromBottom: number) => void
  movePartition: (id: string, fromLeft: number) => void
  moveDrawer: (id: string, fromBottom: number) => void
  moveShelfPartition: (id: string, fromLeft: number) => void
  moveFreehandPath: (id: string, deltaX: number, deltaY: number) => void

  // Custom panels
  addCustomPanel: (panel: Omit<CustomPanel, 'id'>) => void
  convertFreehandPathToCustomPanel: (id: string) => void
  moveCustomPanel: (id: string, fromLeft: number, fromBottom: number) => void
  renameCustomPanel: (id: string, name: string) => void

  // Section config (door, hanging rail)
  setSectionConfig: (index: number, patch: Partial<SectionConfig>) => void

  // Remove
  removeSelected: () => void

  // History
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

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
export const DEFAULT_PENCIL_STROKE = '#2563eb'
export const DEFAULT_PENCIL_STROKE_WIDTH = 2
export const PENCIL_STROKE_WIDTH_RANGE = { min: 1, max: 16 }

function snap(value: number, step = 1): number {
  const safeValue = Number.isFinite(value) ? value : 0
  return Math.round(safeValue / step) * step
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(value, max))
}

function valuesMatch<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function clampSectionIndex(sectionIndex: number | undefined, fallback: number, partitions: Partition[]) {
  return clamp(snap(sectionIndex ?? fallback), 0, partitions.length)
}

function minDrawerHeight(thickness: number): number {
  return Math.max(20, thickness + DRAWER_BOX_HEIGHT_ALLOWANCE + 1)
}

function minOuterWidthForLayout(thickness: number, partitionCount: number): number {
  return thickness * (partitionCount + 2) + 1
}

function minOuterHeightForLayout(thickness: number, hasShelves: boolean, hasDrawers: boolean): number {
  let minInteriorHeight = 1
  if (hasShelves) minInteriorHeight = Math.max(minInteriorHeight, thickness + 1)
  if (hasDrawers) minInteriorHeight = Math.max(minInteriorHeight, minDrawerHeight(thickness))
  return thickness * 2 + minInteriorHeight
}

function maxMaterialThicknessForLayout(outerBox: OuterBox, state: FurnitureState): number {
  const widthLimit = Math.floor((outerBox.width - 1) / (state.partitions.length + 2))
  let heightLimit = Math.floor((outerBox.height - 1) / 2)

  if (state.shelves.length > 0) {
    heightLimit = Math.min(heightLimit, Math.floor((outerBox.height - 1) / 3))
  }
  if (state.drawers.length > 0) {
    heightLimit = Math.min(
      heightLimit,
      Math.floor((outerBox.height - 20) / 2),
      Math.floor((outerBox.height - DRAWER_BOX_HEIGHT_ALLOWANCE - 1) / 3),
    )
  }

  return Math.max(1, Math.min(widthLimit, heightLimit))
}

function sanitizeOuterBoxForLayout(
  box: OuterBox,
  material: Material,
  state: Pick<FurnitureState, 'partitions' | 'shelves' | 'drawers'>,
): OuterBox {
  return {
    width: Math.max(
      minOuterWidthForLayout(material.thickness, state.partitions.length),
      snap(box.width),
    ),
    height: Math.max(
      minOuterHeightForLayout(material.thickness, state.shelves.length > 0, state.drawers.length > 0),
      snap(box.height),
    ),
    depth: Math.max(backPanelThicknessOf(material) + 1, snap(box.depth)),
  }
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

function shiftSectionConfigsForBulkInsert(
  configs: Record<number, SectionConfig>,
  insertionIdx: number,
  count: number,
): Record<number, SectionConfig> {
  return Object.fromEntries(
    Object.entries(configs).map(([key, value]) => {
      const idx = Number(key)
      return [idx > insertionIdx ? idx + count : idx, value]
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

function evenlySpacedCenters(start: number, end: number, itemThickness: number, count: number) {
  const safeCount = clamp(snap(count), 1, 50)
  const available = end - start
  if (available < itemThickness * safeCount) return []

  const opening = (available - itemThickness * safeCount) / (safeCount + 1)
  return Array.from({ length: safeCount }, (_, index) => (
    snap(start + opening + itemThickness / 2 + index * (opening + itemThickness))
  ))
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

function freehandPathCanvasBounds(points: number[]) {
  const xs = points.filter((_, index) => index % 2 === 0)
  const ys = points.filter((_, index) => index % 2 === 1)
  if (!xs.length || !ys.length) return null

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

function customPanelFromFreehandPath(
  path: FreehandPath,
  outerBox: OuterBox,
  thickness: number,
): Omit<CustomPanel, 'id'> | null {
  const bounds = freehandPathCanvasBounds(path.points)
  if (!bounds) return null

  const interiorLeft = FURNITURE_BOX_FRAME_PADDING.left + thickness
  const interiorTop = FURNITURE_BOX_FRAME_PADDING.top + thickness
  const interiorRight = FURNITURE_BOX_FRAME_PADDING.left + outerBox.width - thickness
  const interiorBottom = FURNITURE_BOX_FRAME_PADDING.top + outerBox.height - thickness

  if (
    bounds.right < interiorLeft
    || bounds.left > interiorRight
    || bounds.bottom < interiorTop
    || bounds.top > interiorBottom
  ) {
    return null
  }

  const left = clamp(bounds.left, interiorLeft, interiorRight)
  const right = clamp(bounds.right, interiorLeft, interiorRight)
  const top = clamp(bounds.top, interiorTop, interiorBottom)
  const bottom = clamp(bounds.bottom, interiorTop, interiorBottom)
  const rawWidth = Math.max(1, furnitureCanvasPxToMm(right - left))
  const rawHeight = Math.max(1, furnitureCanvasPxToMm(bottom - top))
  const centerLeft = furnitureCanvasPxToMm((left + right) / 2 - interiorLeft)
  const centerBottom = furnitureCanvasPxToMm(interiorBottom - (top + bottom) / 2)
  const isHorizontal = rawWidth >= rawHeight * 1.75
  const isVertical = rawHeight >= rawWidth * 1.75

  if (isHorizontal) {
    const width = Math.max(thickness, rawWidth)
    const height = thickness
    return clampCustomPanel({
      name: 'Sketch Panel',
      fromLeft: centerLeft - width / 2,
      fromBottom: centerBottom - height / 2,
      width,
      height,
      thickness,
    }, outerBox, thickness)
  }

  if (isVertical) {
    const width = thickness
    const height = Math.max(thickness, rawHeight)
    return clampCustomPanel({
      name: 'Sketch Panel',
      fromLeft: centerLeft - width / 2,
      fromBottom: centerBottom - height / 2,
      width,
      height,
      thickness,
    }, outerBox, thickness)
  }

  return clampCustomPanel({
    name: 'Sketch Panel',
    fromLeft: furnitureCanvasPxToMm(left - interiorLeft),
    fromBottom: furnitureCanvasPxToMm(interiorBottom - bottom),
    width: Math.max(thickness, rawWidth),
    height: Math.max(thickness, rawHeight),
    thickness,
  }, outerBox, thickness)
}

function clampPartitionsForLayout(partitions: Partition[], outerBox: OuterBox, thickness: number): Partition[] {
  const interiorW = Math.max(1, outerBox.width - thickness * 2)
  const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
  const lastIndex = sorted.length - 1

  return sorted.map((partition, index) => {
    const min = thickness / 2 + index * thickness
    const max = interiorW - thickness / 2 - (lastIndex - index) * thickness
    return {
      ...partition,
      fromLeft: clamp(snap(partition.fromLeft), min, max),
    }
  })
}

function clampSectionConfigsForLayout(
  configs: Record<number, SectionConfig>,
  partitionCount: number,
): Record<number, SectionConfig> {
  return Object.fromEntries(
    Object.entries(configs)
      .map(([key, cfg]) => [Number(key), cfg] as const)
      .filter(([index]) => Number.isFinite(index) && index >= 0 && index <= partitionCount),
  )
}

type NormalizedFurnitureLayout = {
  outerBox: OuterBox
  material: Material
  shelves: Shelf[]
  partitions: Partition[]
  drawers: Drawer[]
  customPanels: CustomPanel[]
  shelfPartitions: ShelfPartition[]
  sectionConfigs: Record<number, SectionConfig>
}

function normalizeFurnitureLayout(
  state: FurnitureState,
  outerBox: OuterBox,
  material: Material,
): NormalizedFurnitureLayout {
  const safeOuterBox = sanitizeOuterBoxForLayout(outerBox, material, state)
  const T = material.thickness
  const interiorH = Math.max(1, safeOuterBox.height - T * 2)
  const partitions = clampPartitionsForLayout(state.partitions, safeOuterBox, T)

  const shelves = state.shelves.map((shelf) => ({
    ...shelf,
    fromBottom: clamp(snap(shelf.fromBottom), T / 2, interiorH - T / 2),
    sectionIndex: clampSectionIndex(shelf.sectionIndex, shelf.sectionIndex, partitions),
  }))

  const drawers = state.drawers.map((drawer) => {
    const minH = Math.min(interiorH, minDrawerHeight(T))
    const height = clamp(snap(drawer.height), minH, interiorH)
    return {
      ...drawer,
      sectionIndex: clampSectionIndex(drawer.sectionIndex, drawer.sectionIndex, partitions),
      fromBottom: clamp(snap(drawer.fromBottom), 0, Math.max(0, interiorH - height)),
      height,
      frontSetback: clamp(
        snap(drawer.frontSetback ?? 0),
        0,
        maxDrawerFrontSetback(safeOuterBox, T, backPanelThicknessOf(material)),
      ),
    }
  })

  const shelfPartitions = state.shelfPartitions
    .map((partition) => {
      const sectionIndex = clampSectionIndex(partition.sectionIndex, partition.sectionIndex, partitions)
      const bounds = sectionDividerBounds(
        partitions,
        sectionIndex,
        Math.max(1, safeOuterBox.width - T * 2),
        T,
      )
      if (!bounds) return null
      const fromBottom = clamp(snap(partition.fromBottom), 0, Math.max(0, interiorH - 1))
      const toBottom = clamp(snap(partition.toBottom), fromBottom + 1, interiorH)
      return {
        ...partition,
        sectionIndex,
        fromLeft: clamp(snap(partition.fromLeft), bounds.min, bounds.max),
        fromBottom,
        toBottom,
      }
    })
    .filter((partition): partition is ShelfPartition => partition != null)

  const customPanels = state.customPanels.map((panel) => {
    const { id, ...rawPanel } = panel
    return { id, ...clampCustomPanel(rawPanel, safeOuterBox, T) }
  })

  return {
    outerBox: safeOuterBox,
    material,
    shelves,
    partitions,
    drawers,
    customPanels,
    shelfPartitions,
    sectionConfigs: clampSectionConfigsForLayout(state.sectionConfigs, partitions.length),
  }
}

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULT_MATERIAL: Material = {
  thickness: 18,
  backPanelThickness: DEFAULT_BACK_PANEL_THICKNESS,
  color: '#c8a96e',
}

function cloneSectionConfigs(configs: Record<number, SectionConfig>): Record<number, SectionConfig> {
  return Object.fromEntries(
    Object.entries(configs).map(([key, cfg]) => [
      Number(key),
      { door: cfg.door, hangingRail: cfg.hangingRail },
    ]),
  )
}

function cloneFurnitureSnapshot(snapshot: FurnitureSnapshot): FurnitureSnapshot {
  return {
    designName: snapshot.designName,
    furnitureType: snapshot.furnitureType,
    outerBox: snapshot.outerBox ? { ...snapshot.outerBox } : null,
    material: { ...snapshot.material },
    shelves: snapshot.shelves.map((shelf) => ({ ...shelf })),
    partitions: snapshot.partitions.map((partition) => ({ ...partition })),
    drawers: snapshot.drawers.map((drawer) => ({ ...drawer })),
    customPanels: snapshot.customPanels.map((panel) => ({ ...panel })),
    shelfPartitions: snapshot.shelfPartitions.map((partition) => ({ ...partition })),
    freehandPaths: snapshot.freehandPaths.map((path) => ({ ...path, points: [...path.points] })),
    sectionConfigs: cloneSectionConfigs(snapshot.sectionConfigs),
  }
}

export function captureFurnitureSnapshot(state: FurnitureState): FurnitureSnapshot {
  return cloneFurnitureSnapshot({
    designName: state.designName,
    furnitureType: state.furnitureType,
    outerBox: state.outerBox,
    material: state.material,
    shelves: state.shelves,
    partitions: state.partitions,
    drawers: state.drawers,
    customPanels: state.customPanels,
    shelfPartitions: state.shelfPartitions,
    freehandPaths: state.freehandPaths,
    sectionConfigs: state.sectionConfigs,
  })
}

function furnitureSnapshotsMatch(a: FurnitureSnapshot | null, b: FurnitureSnapshot | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

function snapshotHasSelectedItem(snapshot: FurnitureSnapshot, selectedId: string | null): boolean {
  if (!selectedId) return false
  if (selectedId === OUTER_BOX_SELECTION_ID) return snapshot.outerBox != null
  return snapshot.shelves.some((item) => item.id === selectedId)
    || snapshot.partitions.some((item) => item.id === selectedId)
    || snapshot.shelfPartitions.some((item) => item.id === selectedId)
    || snapshot.drawers.some((item) => item.id === selectedId)
    || snapshot.customPanels.some((item) => item.id === selectedId)
    || snapshot.freehandPaths.some((item) => item.id === selectedId)
}

export function restoreFurnitureSnapshot(
  snapshot: FurnitureSnapshot,
  savedSnapshot: FurnitureSnapshot | null = null,
  selectedId: string | null = null,
): Partial<FurnitureState> {
  return {
    ...cloneFurnitureSnapshot(snapshot),
    mode: snapshot.outerBox ? 'select' : 'draw_box',
    selectedId: snapshotHasSelectedItem(snapshot, selectedId) ? selectedId : null,
    hasUnsavedChanges: !furnitureSnapshotsMatch(snapshot, savedSnapshot),
  }
}

export function pushFurnitureHistory(state: FurnitureState): Pick<FurnitureState, 'past' | 'future'> {
  return {
    past: [...state.past, captureFurnitureSnapshot(state)].slice(-MAX_FURNITURE_HISTORY),
    future: [],
  }
}

export function clearFurnitureFuture(): Pick<FurnitureState, 'future'> {
  return { future: [] }
}

export function clearFurnitureHistory(): Pick<FurnitureState, 'past' | 'future'> {
  return { past: [], future: [] }
}

function recordFurnitureEdit(state: FurnitureState): Pick<FurnitureState, 'past' | 'future' | 'hasUnsavedChanges'> {
  return {
    ...pushFurnitureHistory(state),
    hasUnsavedChanges: true,
  }
}

function resolveSelectedFurnitureItem(state: FurnitureState): SelectedFurnitureItem | null {
  const { selectedId } = state
  if (!selectedId) return null

  if (selectedId === OUTER_BOX_SELECTION_ID) {
    return state.outerBox
      ? { type: 'outer_box', id: OUTER_BOX_SELECTION_ID, item: state.outerBox }
      : null
  }

  const shelf = state.shelves.find((item) => item.id === selectedId)
  if (shelf) return { type: 'shelf', id: shelf.id, item: shelf }

  const partition = state.partitions.find((item) => item.id === selectedId)
  if (partition) return { type: 'partition', id: partition.id, item: partition }

  const shelfPartition = state.shelfPartitions.find((item) => item.id === selectedId)
  if (shelfPartition) {
    return { type: 'shelf_partition', id: shelfPartition.id, item: shelfPartition }
  }

  const drawer = state.drawers.find((item) => item.id === selectedId)
  if (drawer) return { type: 'drawer', id: drawer.id, item: drawer }

  const customPanel = state.customPanels.find((item) => item.id === selectedId)
  if (customPanel) return { type: 'custom_panel', id: customPanel.id, item: customPanel }

  const freehandPath = state.freehandPaths.find((item) => item.id === selectedId)
  if (freehandPath) return { type: 'freehand_path', id: freehandPath.id, item: freehandPath }

  return null
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
    freehand_paths: s.freehandPaths.map((path) => ({
      element_id: path.id,
      points: path.points,
      stroke: path.stroke,
      stroke_width: path.strokeWidth,
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
  const designName = design.name || 'Untitled Design'
  const furnitureType = design.furniture_type || 'wardrobe'
  const outerBox = design.outer_box
    ? {
        width: design.outer_box.width,
        height: design.outer_box.height,
        depth: design.outer_box.depth,
      }
    : null
  const material = {
    thickness: design.material?.thickness ?? DEFAULT_MATERIAL.thickness,
    backPanelThickness: design.material?.back_panel_thickness ?? DEFAULT_MATERIAL.backPanelThickness,
    color: design.material?.color || DEFAULT_MATERIAL.color,
  }
  const shelves = (design.shelves ?? []).map((shelf) => ({
    id: localElementId(shelf.element_id),
    fromBottom: shelf.from_bottom,
    sectionIndex: shelf.section_index,
  }))
  const partitions = (design.partitions ?? []).map((partition) => ({
    id: localElementId(partition.element_id),
    fromLeft: partition.from_left,
  }))
  const drawers = (design.drawers ?? []).map((drawer) => ({
    id: localElementId(drawer.element_id),
    sectionIndex: drawer.section_index,
    fromBottom: drawer.from_bottom,
    height: drawer.height,
    frontSetback: drawer.front_setback,
  }))
  const customPanels = (design.custom_panels ?? []).map((panel) => ({
    id: localElementId(panel.element_id),
    name: panel.name,
    fromLeft: panel.from_left,
    fromBottom: panel.from_bottom,
    width: panel.width,
    height: panel.height,
    thickness: panel.thickness,
  }))
  const shelfPartitions = (design.shelf_partitions ?? []).map((partition) => ({
    id: localElementId(partition.element_id),
    sectionIndex: partition.section_index,
    fromLeft: partition.from_left,
    fromBottom: partition.from_bottom,
    toBottom: partition.to_bottom,
  }))
  const freehandPaths = (design.freehand_paths ?? []).map((path) => ({
    id: localElementId(path.element_id),
    points: [...(path.points ?? [])],
    stroke: path.stroke || '#2563eb',
    strokeWidth: path.stroke_width || 2,
  }))
  const sectionConfigs = sectionConfigsFromDesign(design)
  const savedSnapshot = cloneFurnitureSnapshot({
    designName,
    furnitureType,
    outerBox,
    material,
    shelves,
    partitions,
    drawers,
    customPanels,
    shelfPartitions,
    freehandPaths,
    sectionConfigs,
  })

  return {
    designId: design.design_id,
    designName,
    furnitureType,
    outerBox,
    material,
    shelves,
    partitions,
    drawers,
    customPanels,
    shelfPartitions,
    freehandPaths,
    sectionConfigs,
    mode: outerBox ? 'select' : 'draw_box',
    selectedId: null,
    hasUnsavedChanges: false,
    lastSavedAt: design.updated_at ?? new Date().toISOString(),
    savedSnapshot,
    ...clearFurnitureHistory(),
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useFurnitureStore = create<FurnitureState>((set, get) => ({
  designId: null,
  designName: 'Untitled Design',
  furnitureType: 'wardrobe',
  hasUnsavedChanges: false,
  lastSavedAt: null,
  savedSnapshot: null,
  past: [],
  future: [],
  outerBox: null,
  material: DEFAULT_MATERIAL,
  shelves: [],
  partitions: [],
  drawers: [],
  customPanels: [],
  shelfPartitions: [],
  freehandPaths: [],
  sectionConfigs: {},
  mode: 'draw_box',
  selectedId: null,
  pencilStroke: DEFAULT_PENCIL_STROKE,
  pencilStrokeWidth: DEFAULT_PENCIL_STROKE_WIDTH,
  pencilSnapEnabled: true,

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

  getSelectedItem: () => resolveSelectedFurnitureItem(get()),

  // ── Actions ───────────────────────────────────────────────────────────────

  setDesignName: (name) => set((s) => (
    s.designName === name ? {} : { ...recordFurnitureEdit(s), designName: name }
  )),
  setFurnitureType: (type) => set((s) => (
    s.furnitureType === type ? {} : { ...recordFurnitureEdit(s), furnitureType: type }
  )),
  setMode: (mode) => set({ mode }),
  setSelected: (id) => set({ selectedId: id }),
  setPencilStroke: (stroke) => set({ pencilStroke: stroke || DEFAULT_PENCIL_STROKE }),
  setPencilStrokeWidth: (strokeWidth) => set({
    pencilStrokeWidth: clamp(
      snap(strokeWidth),
      PENCIL_STROKE_WIDTH_RANGE.min,
      PENCIL_STROKE_WIDTH_RANGE.max,
    ),
  }),
  setPencilSnapEnabled: (enabled) => set({ pencilSnapEnabled: enabled }),
  serializeDesign: () => serializeFurnitureDesignState(get()),
  loadDesign: (design) => set(storePatchFromDesign(design)),
  markSaved: (design) => set((s) => ({
    designId: design?.design_id ?? s.designId,
    hasUnsavedChanges: false,
    lastSavedAt: design?.updated_at ?? new Date().toISOString(),
    savedSnapshot: captureFurnitureSnapshot(s),
  })),

  setOuterBox: (box) => {
    set((s) => {
      const layout = normalizeFurnitureLayout(s, box, s.material)
      const isSameBox = s.outerBox
        && s.outerBox.width === layout.outerBox.width
        && s.outerBox.height === layout.outerBox.height
        && s.outerBox.depth === layout.outerBox.depth
      if (isSameBox && s.mode === 'select') return {}
      return {
        ...recordFurnitureEdit(s),
        ...layout,
        // Switch to select mode once box is drawn
        mode: 'select',
      }
    })
  },

  updateOuterBox: (patch) => set((s) => {
    if (!s.outerBox) return {}
    const layout = normalizeFurnitureLayout(s, {
      width: patch.width ?? s.outerBox.width,
      height: patch.height ?? s.outerBox.height,
      depth: patch.depth ?? s.outerBox.depth,
    }, s.material)
    if (valuesMatch({
      outerBox: s.outerBox,
      shelves: s.shelves,
      partitions: s.partitions,
      drawers: s.drawers,
      customPanels: s.customPanels,
      shelfPartitions: s.shelfPartitions,
      freehandPaths: s.freehandPaths,
      sectionConfigs: s.sectionConfigs,
    }, {
      outerBox: layout.outerBox,
      shelves: layout.shelves,
      partitions: layout.partitions,
      drawers: layout.drawers,
      customPanels: layout.customPanels,
      shelfPartitions: layout.shelfPartitions,
      freehandPaths: s.freehandPaths,
      sectionConfigs: layout.sectionConfigs,
    })) return {}
    return {
      ...recordFurnitureEdit(s),
      ...layout,
    }
  }),

  setDepth: (depth) => set((s) => {
    if (!s.outerBox) return { outerBox: null }
    const layout = normalizeFurnitureLayout(s, { ...s.outerBox, depth }, s.material)
    if (s.outerBox.depth === layout.outerBox.depth && valuesMatch(s.drawers, layout.drawers)) return {}
    return {
      ...recordFurnitureEdit(s),
      ...layout,
    }
  }),

  clearOuterBox: () => set((s) => ({
    ...recordFurnitureEdit(s),
    outerBox: null,
    shelves: [],
    partitions: [],
    drawers: [],
    customPanels: [],
    shelfPartitions: [],
    freehandPaths: [],
    sectionConfigs: {},
    mode: 'draw_box',
    selectedId: null,
  })),

  setThickness: (mm) => set((s) => {
    const requested = Math.max(1, snap(mm))
    if (!s.outerBox) {
      if (s.material.thickness === requested) return {}
      return {
        ...recordFurnitureEdit(s),
        material: { ...s.material, thickness: requested },
      }
    }
    const maxThickness = maxMaterialThicknessForLayout(s.outerBox, s)
    const material = { ...s.material, thickness: clamp(requested, 1, maxThickness) }
    const layout = normalizeFurnitureLayout(s, s.outerBox, material)
    if (s.material.thickness === material.thickness && valuesMatch(s.drawers, layout.drawers)) return {}
    return {
      ...recordFurnitureEdit(s),
      ...layout,
    }
  }),
  setBackPanelThickness: (mm) => set((s) => {
    const requested = Math.max(1, snap(mm))
    if (!s.outerBox) {
      if (s.material.backPanelThickness === requested) return {}
      return {
        ...recordFurnitureEdit(s),
        material: { ...s.material, backPanelThickness: requested },
      }
    }
    const maxBackPanelThickness = Math.max(1, s.outerBox.depth - 1)
    const material = {
      ...s.material,
      backPanelThickness: clamp(requested, 1, maxBackPanelThickness),
    }
    const layout = normalizeFurnitureLayout(s, s.outerBox, material)
    if (s.material.backPanelThickness === material.backPanelThickness && valuesMatch(s.drawers, layout.drawers)) return {}
    return {
      ...recordFurnitureEdit(s),
      ...layout,
    }
  }),
  setMaterialColor: (color) => set((s) => (
    s.material.color === color
      ? {}
      : { ...recordFurnitureEdit(s), material: { ...s.material, color } }
  )),

  addShelf: (fromBottom, sectionIndex) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    if (interiorH <= 0) return
    const clamped = clamp(snap(fromBottom), T / 2, interiorH - T / 2)
    set((s) => ({
      ...recordFurnitureEdit(s),
      shelves: [...s.shelves, {
        id: uid(),
        fromBottom: clamped,
        sectionIndex: clampSectionIndex(sectionIndex, 0, partitions),
      }],
    }))
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
        ...recordFurnitureEdit(s),
        partitions:      [...s.partitions, { id: uid(), fromLeft: clamped }],
        shelves:         s.shelves.map((sh) => ({ ...sh, sectionIndex: shiftIdx(sh.sectionIndex) })),
        drawers:         s.drawers.map((d)  => ({ ...d,  sectionIndex: shiftIdx(d.sectionIndex)  })),
        shelfPartitions: s.shelfPartitions.map((sp) => ({ ...sp, sectionIndex: shiftIdx(sp.sectionIndex) })),
        sectionConfigs:  shiftSectionConfigsForInsert(s.sectionConfigs, insertionIdx),
      }
    })
  },

  addEqualShelves: (count, sectionIndex, bottomMargin = 0, topMargin = 0) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return

    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    if (interiorH <= 0) return

    const safeSectionIndex = clampSectionIndex(sectionIndex, 0, partitions)
    const bottom = clamp(snap(bottomMargin), 0, interiorH)
    const top = clamp(snap(topMargin), 0, Math.max(0, interiorH - bottom))
    const centers = evenlySpacedCenters(bottom, interiorH - top, T, count)
    if (centers.length === 0) return

    set((s) => ({
      ...recordFurnitureEdit(s),
      shelves: [
        ...s.shelves,
        ...centers.map((fromBottom) => ({
          id: uid(),
          fromBottom,
          sectionIndex: safeSectionIndex,
        })),
      ],
    }))
  },

  addEqualPartitions: (count, sectionIndex, leftMargin = 0, rightMargin = 0) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return

    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    if (interiorW <= T) return

    const safeCount = clamp(snap(count), 1, 50)
    const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
    const safeSectionIndex = clamp(snap(sectionIndex), 0, sorted.length)
    const sectionStart = safeSectionIndex === 0 ? 0 : sorted[safeSectionIndex - 1]?.fromLeft
    const sectionEnd = safeSectionIndex === sorted.length ? interiorW : sorted[safeSectionIndex]?.fromLeft
    if (sectionStart === undefined || sectionEnd === undefined) return

    const sectionClearStart = sectionStart + (safeSectionIndex === 0 ? 0 : T / 2)
    const sectionClearEnd = sectionEnd - (safeSectionIndex === sorted.length ? 0 : T / 2)
    const maxMarginSpace = Math.max(0, sectionClearEnd - sectionClearStart)
    const left = clamp(snap(leftMargin), 0, maxMarginSpace)
    const right = clamp(snap(rightMargin), 0, Math.max(0, maxMarginSpace - left))
    const centers = evenlySpacedCenters(sectionClearStart + left, sectionClearEnd - right, T, safeCount)
    if (centers.length === 0) return

    set((s) => {
      const shiftIdx = (idx: number) => idx > safeSectionIndex ? idx + centers.length : idx

      return {
        ...recordFurnitureEdit(s),
        partitions: [
          ...s.partitions,
          ...centers.map((fromLeft) => ({ id: uid(), fromLeft })),
        ],
        shelves: s.shelves.map((shelf) => ({
          ...shelf,
          sectionIndex: shiftIdx(shelf.sectionIndex),
        })),
        drawers: s.drawers.map((drawer) => ({
          ...drawer,
          sectionIndex: shiftIdx(drawer.sectionIndex),
        })),
        shelfPartitions: s.shelfPartitions.map((partition) => ({
          ...partition,
          sectionIndex: shiftIdx(partition.sectionIndex),
        })),
        sectionConfigs: shiftSectionConfigsForBulkInsert(
          s.sectionConfigs,
          safeSectionIndex,
          centers.length,
        ),
      }
    })
  },

  addEqualShelfPartitions: (count, sectionIndex, fromBottom, toBottom, fromLeft, toLeft) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return

    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const interiorH = outerBox.height - T * 2
    if (interiorW <= 0 || interiorH <= 0) return

    const sorted = [...partitions].sort((a, b) => a.fromLeft - b.fromLeft)
    const safeSectionIndex = clampSectionIndex(sectionIndex, 0, sorted)
    const sectionStart = safeSectionIndex === 0 ? 0 : sorted[safeSectionIndex - 1]?.fromLeft
    const sectionEnd = safeSectionIndex === sorted.length ? interiorW : sorted[safeSectionIndex]?.fromLeft
    if (sectionStart === undefined || sectionEnd === undefined) return

    const sectionClearStart = sectionStart + (safeSectionIndex === 0 ? 0 : T / 2)
    const sectionClearEnd = sectionEnd - (safeSectionIndex === sorted.length ? 0 : T / 2)
    const left = clamp(snap(Math.min(fromLeft, toLeft)), sectionClearStart, sectionClearEnd)
    const right = clamp(snap(Math.max(fromLeft, toLeft)), left, sectionClearEnd)
    const lower = clamp(snap(Math.min(fromBottom, toBottom)), 0, Math.max(0, interiorH - 1))
    const upper = clamp(snap(Math.max(fromBottom, toBottom)), lower + 1, interiorH)
    const centers = evenlySpacedCenters(left, right, T, count)
    if (centers.length === 0) return

    set((s) => ({
      ...recordFurnitureEdit(s),
      shelfPartitions: [
        ...s.shelfPartitions,
        ...centers.map((center) => ({
          id: uid(),
          sectionIndex: safeSectionIndex,
          fromLeft: center,
          fromBottom: lower,
          toBottom: upper,
        })),
      ],
    }))
  },

  addDrawer: (sectionIndex, fromBottom, height) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return
    const interiorH = outerBox.height - material.thickness * 2
    if (interiorH <= 0) return
    const minH = Math.min(interiorH, minDrawerHeight(material.thickness))
    const snappedH = clamp(snap(height), minH, interiorH)
    const snapped = clamp(snap(fromBottom), 0, interiorH - snappedH)
    set((s) => ({
      ...recordFurnitureEdit(s),
      drawers: [...s.drawers, {
        id: uid(),
        sectionIndex: clampSectionIndex(sectionIndex, 0, partitions),
        fromBottom: snapped,
        height: snappedH,
        frontSetback: 0,
      }],
    }))
  },

  updateShelf: (id, patch) => set((s) => {
    if (!s.outerBox) return {}
    const shelf = s.shelves.find((item) => item.id === id)
    if (!shelf) return {}

    const T = s.material.thickness
    const interiorH = s.outerBox.height - T * 2
    if (interiorH <= 0) return {}

    const nextShelf = {
      ...shelf,
      fromBottom: clamp(snap(patch.fromBottom ?? shelf.fromBottom), T / 2, interiorH - T / 2),
      sectionIndex: clampSectionIndex(patch.sectionIndex, shelf.sectionIndex, s.partitions),
    }
    if (valuesMatch(shelf, nextShelf)) return {}

    return {
      ...recordFurnitureEdit(s),
      shelves: s.shelves.map((item) => item.id === id ? nextShelf : item),
    }
  }),

  updatePartition: (id, patch) => set((s) => {
    if (!s.outerBox || patch.fromLeft === undefined) return {}
    const partition = s.partitions.find((item) => item.id === id)
    if (!partition) return {}

    const T = s.material.thickness
    const interiorW = s.outerBox.width - T * 2
    const bounds = partitionMoveBounds(s.partitions, id, interiorW, T)
    if (!bounds) return {}

    const nextPartition = {
      ...partition,
      fromLeft: clamp(snap(patch.fromLeft), bounds.min, bounds.max),
    }
    if (valuesMatch(partition, nextPartition)) return {}

    return {
      ...recordFurnitureEdit(s),
      partitions: s.partitions.map((item) => item.id === id ? nextPartition : item),
    }
  }),

  updateDrawer: (id, patch) => set((s) => {
    if (!s.outerBox) return {}
    const drawer = s.drawers.find((item) => item.id === id)
    if (!drawer) return {}

    const interiorH = s.outerBox.height - s.material.thickness * 2
    if (interiorH <= 0) return {}

    const minH = Math.min(interiorH, minDrawerHeight(s.material.thickness))
    const height = clamp(snap(patch.height ?? drawer.height), minH, interiorH)
    const nextDrawer = {
      ...drawer,
      sectionIndex: clampSectionIndex(patch.sectionIndex, drawer.sectionIndex, s.partitions),
      fromBottom: clamp(snap(patch.fromBottom ?? drawer.fromBottom), 0, Math.max(0, interiorH - height)),
      height,
      frontSetback: clamp(
        snap(patch.frontSetback ?? drawer.frontSetback ?? 0),
        0,
        maxDrawerFrontSetback(s.outerBox, s.material.thickness, backPanelThicknessOf(s.material)),
      ),
    }
    if (valuesMatch(drawer, nextDrawer)) return {}

    return {
      ...recordFurnitureEdit(s),
      drawers: s.drawers.map((item) => item.id === id ? nextDrawer : item),
    }
  }),

  updateShelfPartition: (id, patch) => set((s) => {
    if (!s.outerBox) return {}
    const shelfPartition = s.shelfPartitions.find((item) => item.id === id)
    if (!shelfPartition) return {}

    const T = s.material.thickness
    const interiorW = s.outerBox.width - T * 2
    const interiorH = s.outerBox.height - T * 2
    if (interiorW <= 0 || interiorH <= 0) return {}

    const sectionIndex = clampSectionIndex(patch.sectionIndex, shelfPartition.sectionIndex, s.partitions)
    const bounds = sectionDividerBounds(s.partitions, sectionIndex, interiorW, T)
    if (!bounds) return {}

    const fromBottom = clamp(
      snap(patch.fromBottom ?? shelfPartition.fromBottom),
      0,
      Math.max(0, interiorH - 1),
    )
    const toBottom = clamp(
      snap(patch.toBottom ?? shelfPartition.toBottom),
      fromBottom + 1,
      interiorH,
    )
    const nextShelfPartition = {
      ...shelfPartition,
      sectionIndex,
      fromLeft: clamp(snap(patch.fromLeft ?? shelfPartition.fromLeft), bounds.min, bounds.max),
      fromBottom,
      toBottom,
    }
    if (valuesMatch(shelfPartition, nextShelfPartition)) return {}

    return {
      ...recordFurnitureEdit(s),
      shelfPartitions: s.shelfPartitions.map((item) => item.id === id ? nextShelfPartition : item),
    }
  }),

  updateCustomPanel: (id, patch) => set((s) => {
    if (!s.outerBox) return {}
    const customPanel = s.customPanels.find((item) => item.id === id)
    if (!customPanel) return {}

    const clamped = clampCustomPanel(
      {
        name: patch.name ?? customPanel.name,
        fromLeft: patch.fromLeft ?? customPanel.fromLeft,
        fromBottom: patch.fromBottom ?? customPanel.fromBottom,
        width: patch.width ?? customPanel.width,
        height: patch.height ?? customPanel.height,
        thickness: patch.thickness ?? customPanel.thickness,
      },
      s.outerBox,
      s.material.thickness,
    )
    const nextCustomPanel = { ...customPanel, ...clamped }
    if (valuesMatch(customPanel, nextCustomPanel)) return {}

    return {
      ...recordFurnitureEdit(s),
      customPanels: s.customPanels.map((item) => item.id === id ? nextCustomPanel : item),
    }
  }),

  moveShelf: (id, fromBottom) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    if (interiorH <= 0) return
    const clamped = clamp(snap(fromBottom), T / 2, interiorH - T / 2)
    set((s) => ({
      ...recordFurnitureEdit(s),
      shelves: s.shelves.map((sh) => sh.id === id ? { ...sh, fromBottom: clamped } : sh),
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
      ...recordFurnitureEdit(s),
      partitions: s.partitions.map((p) => p.id === id ? { ...p, fromLeft: clamped } : p),
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
      ...recordFurnitureEdit(s),
      drawers: s.drawers.map((d) => d.id === id ? { ...d, fromBottom: snapped } : d),
    }))
  },

  addShelfPartition: (sectionIndex, fromLeft, fromBottom, toBottom) => {
    const { outerBox, material, partitions } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const interiorH = outerBox.height - T * 2
    if (interiorW <= 0 || interiorH <= 0) return
    const safeSectionIndex = clampSectionIndex(sectionIndex, 0, partitions)
    const bounds = sectionDividerBounds(partitions, safeSectionIndex, interiorW, T)
    if (!bounds) return
    const clamped = clamp(snap(fromLeft), bounds.min, bounds.max)
    const lower = clamp(snap(Math.min(fromBottom, toBottom)), 0, Math.max(0, interiorH - 1))
    const upper = clamp(snap(Math.max(fromBottom, toBottom)), lower + 1, interiorH)
    set((s) => ({
      ...recordFurnitureEdit(s),
      shelfPartitions: [...s.shelfPartitions, {
        id: uid(),
        sectionIndex: safeSectionIndex,
        fromLeft: clamped,
        fromBottom: lower,
        toBottom: upper,
      }],
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
      ...recordFurnitureEdit(s),
      shelfPartitions: s.shelfPartitions.map((sp) =>
        sp.id === id ? { ...sp, fromLeft: clamped } : sp,
      ),
    }))
  },

  addCustomPanel: (panel) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const clamped = clampCustomPanel(panel, outerBox, material.thickness)
    set((s) => ({
      ...recordFurnitureEdit(s),
      customPanels: [...s.customPanels, { ...clamped, id: uid() }],
    }))
  },

  convertFreehandPathToCustomPanel: (id) => {
    const { outerBox, material, freehandPaths } = get()
    if (!outerBox) return

    const path = freehandPaths.find((item) => item.id === id)
    if (!path) return

    const panel = customPanelFromFreehandPath(path, outerBox, material.thickness)
    if (!panel) return

    const panelId = uid()
    set((s) => ({
      ...recordFurnitureEdit(s),
      customPanels: [...s.customPanels, { ...panel, id: panelId }],
      freehandPaths: s.freehandPaths.filter((item) => item.id !== id),
      selectedId: panelId,
      mode: 'select',
    }))
  },

  addFreehandPath: (path) => {
    if (path.points.length < 4) return
    set((s) => ({
      ...recordFurnitureEdit(s),
      freehandPaths: [...s.freehandPaths, {
        id: uid(),
        points: [...path.points],
        stroke: path.stroke || DEFAULT_PENCIL_STROKE,
        strokeWidth: clamp(
          snap(path.strokeWidth),
          PENCIL_STROKE_WIDTH_RANGE.min,
          PENCIL_STROKE_WIDTH_RANGE.max,
        ),
      }],
    }))
  },

  updateFreehandPath: (id, patch) => set((s) => {
    const current = s.freehandPaths.find((path) => path.id === id)
    if (!current) return {}

    const next: FreehandPath = {
      ...current,
      points: patch.points ? [...patch.points] : current.points,
      stroke: patch.stroke ?? current.stroke,
      strokeWidth: patch.strokeWidth == null
        ? current.strokeWidth
        : clamp(
          snap(patch.strokeWidth),
          PENCIL_STROKE_WIDTH_RANGE.min,
          PENCIL_STROKE_WIDTH_RANGE.max,
        ),
    }

    if (valuesMatch(current, next)) return {}

    return {
      ...recordFurnitureEdit(s),
      freehandPaths: s.freehandPaths.map((path) => path.id === id ? next : path),
    }
  }),

  moveFreehandPath: (id, deltaX, deltaY) => set((s) => {
    const dx = Number.isFinite(deltaX) ? deltaX : 0
    const dy = Number.isFinite(deltaY) ? deltaY : 0
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return {}

    const current = s.freehandPaths.find((path) => path.id === id)
    if (!current) return {}

    return {
      ...recordFurnitureEdit(s),
      freehandPaths: s.freehandPaths.map((path) => (
        path.id === id
          ? {
            ...path,
            points: path.points.map((point, index) => snap(point + (index % 2 === 0 ? dx : dy))),
          }
          : path
      )),
    }
  }),

  moveCustomPanel: (id, fromLeft, fromBottom) => {
    const { outerBox, material, customPanels } = get()
    if (!outerBox) return
    const panel = customPanels.find((p) => p.id === id)
    if (!panel) return
    const clamped = clampCustomPanel({ ...panel, fromLeft, fromBottom }, outerBox, material.thickness)
    set((s) => ({
      ...recordFurnitureEdit(s),
      customPanels: s.customPanels.map((p) =>
        p.id === id ? { ...p, fromLeft: clamped.fromLeft, fromBottom: clamped.fromBottom } : p,
      ),
    }))
  },

  renameCustomPanel: (id, name) => set((s) => ({
    ...recordFurnitureEdit(s),
    customPanels: s.customPanels.map((p) => p.id === id ? { ...p, name } : p),
  })),

  setSectionConfig: (index, patch) => set((s) => ({
    ...recordFurnitureEdit(s),
    sectionConfigs: {
      ...s.sectionConfigs,
      [index]: { ...(s.sectionConfigs[index] ?? DEFAULT_SECTION_CONFIG), ...patch },
    },
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
        ...recordFurnitureEdit(s),
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
      }))
    } else {
      set((s) => ({
        ...recordFurnitureEdit(s),
        shelves:         s.shelves.filter((sh) => sh.id !== selectedId),
        partitions:      s.partitions.filter((p)  => p.id  !== selectedId),
        drawers:         s.drawers.filter((d)  => d.id  !== selectedId),
        customPanels:    s.customPanels.filter((cp) => cp.id !== selectedId),
        shelfPartitions: s.shelfPartitions.filter((sp) => sp.id !== selectedId),
        freehandPaths:   s.freehandPaths.filter((path) => path.id !== selectedId),
        selectedId: null,
      }))
    }
  },

  undo: () => set((s) => {
    const previous = s.past.at(-1)
    if (!previous) return {}

    return {
      ...restoreFurnitureSnapshot(previous, s.savedSnapshot, s.selectedId),
      past: s.past.slice(0, -1),
      future: [captureFurnitureSnapshot(s), ...s.future].slice(0, MAX_FURNITURE_HISTORY),
    }
  }),

  redo: () => set((s) => {
    const next = s.future[0]
    if (!next) return {}

    return {
      ...restoreFurnitureSnapshot(next, s.savedSnapshot, s.selectedId),
      past: [...s.past, captureFurnitureSnapshot(s)].slice(-MAX_FURNITURE_HISTORY),
      future: s.future.slice(1),
    }
  }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  reset: () => set({
    designId: null,
    designName: 'Untitled Design',
    furnitureType: 'wardrobe',
    hasUnsavedChanges: false,
    lastSavedAt: null,
    savedSnapshot: null,
    ...clearFurnitureHistory(),
    outerBox: null,
    material: DEFAULT_MATERIAL,
    shelves: [],
    partitions: [],
    drawers: [],
    customPanels: [],
    shelfPartitions: [],
    freehandPaths: [],
    sectionConfigs: {},
    mode: 'draw_box',
    selectedId: null,
    pencilStroke: DEFAULT_PENCIL_STROKE,
    pencilStrokeWidth: DEFAULT_PENCIL_STROKE_WIDTH,
    pencilSnapEnabled: true,
  }),
}))
