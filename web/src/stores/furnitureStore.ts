import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrawingMode = 'draw_box' | 'select' | 'add_shelf' | 'add_partition' | 'add_drawer' | 'add_custom_panel'
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
}

export interface Partition {
  id: string
  fromLeft: number     // mm from interior left edge
}

export interface Drawer {
  id: string
  sectionIndex: number // which section (0 = leftmost)
  fromBottom: number   // mm from interior bottom of that section
  height: number       // mm
}

export interface Material {
  thickness: number    // mm, typically 18
  color: string        // hex color for 3D preview
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
  designName: string
  furnitureType: 'wardrobe' | 'cabinet' | 'tv_unit' | 'bookshelf' | 'kitchen_base'

  // Outer box — null until drawn
  outerBox: OuterBox | null

  // Material
  material: Material

  // Internal elements (all positions in mm)
  shelves: Shelf[]
  partitions: Partition[]
  drawers: Drawer[]
  customPanels: CustomPanel[]

  // Per-section configuration (keyed by section index)
  sectionConfigs: Record<number, SectionConfig>

  // UI state
  mode: DrawingMode
  selectedId: string | null

  // ── Derived getters ──────────────────────────────────────────────────────

  getSections: () => Section[]

  // ── Actions ──────────────────────────────────────────────────────────────

  setDesignName: (name: string) => void
  setFurnitureType: (type: FurnitureState['furnitureType']) => void
  setMode: (mode: DrawingMode) => void
  setSelected: (id: string | null) => void

  // Outer box
  setOuterBox: (box: OuterBox) => void
  setDepth: (depth: number) => void
  clearOuterBox: () => void

  // Material
  setThickness: (mm: number) => void
  setMaterialColor: (color: string) => void

  // Add elements
  addShelf: (fromBottom: number) => void
  addPartition: (fromLeft: number) => void
  addDrawer: (sectionIndex: number, fromBottom: number, height: number) => void

  // Move elements (drag)
  moveShelf: (id: string, fromBottom: number) => void
  movePartition: (id: string, fromLeft: number) => void
  moveDrawer: (id: string, fromBottom: number) => void

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

function snap(value: number, step = 1): number {
  return Math.round(value / step) * step
}

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULT_MATERIAL: Material = {
  thickness: 18,
  color: '#c8a96e',
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useFurnitureStore = create<FurnitureState>((set, get) => ({
  designName: 'Untitled Design',
  furnitureType: 'wardrobe',
  outerBox: null,
  material: DEFAULT_MATERIAL,
  shelves: [],
  partitions: [],
  drawers: [],
  customPanels: [],
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
        shelves: shelves.filter(() => {
          // Shelf belongs to this section if its centre falls within it
          return true // shelves span all sections for now (full-width shelves)
        }),
        drawers: drawers.filter((d) => d.sectionIndex === i),
      }
    })
  },

  // ── Actions ───────────────────────────────────────────────────────────────

  setDesignName: (name) => set({ designName: name }),
  setFurnitureType: (type) => set({ furnitureType: type }),
  setMode: (mode) => set({ mode }),
  setSelected: (id) => set({ selectedId: id }),

  setOuterBox: (box) => set({
    outerBox: {
      width: snap(box.width),
      height: snap(box.height),
      depth: snap(box.depth),
    },
    // Switch to select mode once box is drawn
    mode: 'select',
  }),

  setDepth: (depth) => set((s) => ({
    outerBox: s.outerBox ? { ...s.outerBox, depth: snap(depth) } : null,
  })),

  clearOuterBox: () => set({
    outerBox: null,
    shelves: [],
    partitions: [],
    drawers: [],
    mode: 'draw_box',
    selectedId: null,
  }),

  setThickness: (mm) => set((s) => ({ material: { ...s.material, thickness: mm } })),
  setMaterialColor: (color) => set((s) => ({ material: { ...s.material, color } })),

  addShelf: (fromBottom) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    const clamped = Math.max(T, Math.min(snap(fromBottom), interiorH - T))
    set((s) => ({ shelves: [...s.shelves, { id: uid(), fromBottom: clamped }] }))
  },

  addPartition: (fromLeft) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const clamped = Math.max(T, Math.min(snap(fromLeft), interiorW - T))
    set((s) => ({ partitions: [...s.partitions, { id: uid(), fromLeft: clamped }] }))
  },

  addDrawer: (sectionIndex, fromBottom, height) => {
    const snapped = snap(fromBottom)
    const snappedH = snap(height)
    set((s) => ({
      drawers: [...s.drawers, { id: uid(), sectionIndex, fromBottom: snapped, height: snappedH }],
    }))
  },

  moveShelf: (id, fromBottom) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorH = outerBox.height - T * 2
    const clamped = Math.max(T, Math.min(snap(fromBottom), interiorH - T))
    set((s) => ({
      shelves: s.shelves.map((sh) => sh.id === id ? { ...sh, fromBottom: clamped } : sh),
    }))
  },

  movePartition: (id, fromLeft) => {
    const { outerBox, material } = get()
    if (!outerBox) return
    const T = material.thickness
    const interiorW = outerBox.width - T * 2
    const clamped = Math.max(T, Math.min(snap(fromLeft), interiorW - T))
    set((s) => ({
      partitions: s.partitions.map((p) => p.id === id ? { ...p, fromLeft: clamped } : p),
    }))
  },

  moveDrawer: (id, fromBottom) => {
    const snapped = snap(fromBottom)
    set((s) => ({
      drawers: s.drawers.map((d) => d.id === id ? { ...d, fromBottom: snapped } : d),
    }))
  },

  addCustomPanel: (panel) => set((s) => ({
    customPanels: [...s.customPanels, { ...panel, id: uid() }],
  })),

  moveCustomPanel: (id, fromLeft, fromBottom) => set((s) => ({
    customPanels: s.customPanels.map((p) =>
      p.id === id ? { ...p, fromLeft: snap(fromLeft), fromBottom: snap(fromBottom) } : p,
    ),
  })),

  renameCustomPanel: (id, name) => set((s) => ({
    customPanels: s.customPanels.map((p) => p.id === id ? { ...p, name } : p),
  })),

  setSectionConfig: (index, patch) => set((s) => ({
    sectionConfigs: {
      ...s.sectionConfigs,
      [index]: { ...(s.sectionConfigs[index] ?? DEFAULT_SECTION_CONFIG), ...patch },
    },
  })),

  removeSelected: () => {
    const { selectedId } = get()
    if (!selectedId) return
    set((s) => ({
      shelves: s.shelves.filter((sh) => sh.id !== selectedId),
      partitions: s.partitions.filter((p) => p.id !== selectedId),
      drawers: s.drawers.filter((d) => d.id !== selectedId),
      customPanels: s.customPanels.filter((cp) => cp.id !== selectedId),
      selectedId: null,
    }))
  },

  reset: () => set({
    designName: 'Untitled Design',
    furnitureType: 'wardrobe',
    outerBox: null,
    material: DEFAULT_MATERIAL,
    shelves: [],
    partitions: [],
    drawers: [],
    customPanels: [],
    sectionConfigs: {},
    mode: 'draw_box',
    selectedId: null,
  }),
}))
