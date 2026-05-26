import { create } from 'zustand'

export type FurniturePreviewView = 'isometric' | 'front' | 'side' | 'top'
export type FurniturePreviewBackground = 'dark' | 'light'
export type FurniturePreviewMaterialId =
  | 'design'
  | 'natural_oak'
  | 'walnut'
  | 'teak'
  | 'ivory'
  | 'charcoal'
  | 'custom'

export interface FurniturePreviewMaterial {
  id: FurniturePreviewMaterialId
  name: string
  color: string
  secondaryColor: string
  backPanelColor: string
  drawerColor: string
}

interface FurniturePreviewSettings {
  showDoors: boolean
  explodedView: boolean
  explodedAmount: number
  showDimensions: boolean
  activeView: FurniturePreviewView
  backgroundMode: FurniturePreviewBackground
  selectedMaterialId: FurniturePreviewMaterialId
  customColor: string
}

export const FURNITURE_PREVIEW_MATERIALS: FurniturePreviewMaterial[] = [
  {
    id: 'design',
    name: 'Design colour',
    color: '#c8a96e',
    secondaryColor: '#a07840',
    backPanelColor: '#8b6518',
    drawerColor: '#c8a050',
  },
  {
    id: 'natural_oak',
    name: 'Natural oak',
    color: '#d8b26a',
    secondaryColor: '#ad7935',
    backPanelColor: '#8d622d',
    drawerColor: '#c9964a',
  },
  {
    id: 'walnut',
    name: 'Walnut',
    color: '#7b4a2b',
    secondaryColor: '#563018',
    backPanelColor: '#432615',
    drawerColor: '#8a5a35',
  },
  {
    id: 'teak',
    name: 'Teak',
    color: '#b87236',
    secondaryColor: '#86501f',
    backPanelColor: '#663717',
    drawerColor: '#c18448',
  },
  {
    id: 'ivory',
    name: 'Ivory laminate',
    color: '#e7e0cf',
    secondaryColor: '#c9bfaa',
    backPanelColor: '#aea58f',
    drawerColor: '#d8d0bc',
  },
  {
    id: 'charcoal',
    name: 'Charcoal laminate',
    color: '#4b5058',
    secondaryColor: '#303640',
    backPanelColor: '#232832',
    drawerColor: '#606773',
  },
]

export const DEFAULT_CUSTOM_PREVIEW_COLOR = '#6b8f7a'

const DEFAULT_PREVIEW_SETTINGS: FurniturePreviewSettings = {
  showDoors: true,
  explodedView: false,
  explodedAmount: 0.35,
  showDimensions: false,
  activeView: 'isometric',
  backgroundMode: 'dark',
  selectedMaterialId: 'design',
  customColor: DEFAULT_CUSTOM_PREVIEW_COLOR,
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((char) => `${char}${char}`).join('')}`.toLowerCase()
  }

  return DEFAULT_CUSTOM_PREVIEW_COLOR
}

function mixHexColor(color: string, target: string, amount: number) {
  const sourceHex = normalizeHexColor(color).slice(1)
  const targetHex = normalizeHexColor(target).slice(1)
  const mix = (start: number, end: number) => Math.round(start + (end - start) * amount)

  const source = [
    Number.parseInt(sourceHex.slice(0, 2), 16),
    Number.parseInt(sourceHex.slice(2, 4), 16),
    Number.parseInt(sourceHex.slice(4, 6), 16),
  ]
  const destination = [
    Number.parseInt(targetHex.slice(0, 2), 16),
    Number.parseInt(targetHex.slice(2, 4), 16),
    Number.parseInt(targetHex.slice(4, 6), 16),
  ]

  return `#${source
    .map((value, index) => mix(value, destination[index]).toString(16).padStart(2, '0'))
    .join('')}`
}

function createCustomPreviewMaterial(color: string): FurniturePreviewMaterial {
  const normalizedColor = normalizeHexColor(color)

  return {
    id: 'custom',
    name: 'Custom colour',
    color: normalizedColor,
    secondaryColor: mixHexColor(normalizedColor, '#000000', 0.24),
    backPanelColor: mixHexColor(normalizedColor, '#000000', 0.38),
    drawerColor: mixHexColor(normalizedColor, '#ffffff', 0.14),
  }
}

export function getFurniturePreviewMaterial(
  id: FurniturePreviewMaterialId,
  customColor = DEFAULT_CUSTOM_PREVIEW_COLOR,
) {
  if (id === 'custom') return createCustomPreviewMaterial(customColor)

  return FURNITURE_PREVIEW_MATERIALS.find((material) => material.id === id)
    ?? FURNITURE_PREVIEW_MATERIALS[0]
}

interface FurniturePreviewState extends FurniturePreviewSettings {
  cameraResetKey: number

  setShowDoors: (show: boolean) => void
  toggleShowDoors: () => void
  setExplodedView: (enabled: boolean) => void
  toggleExplodedView: () => void
  setExplodedAmount: (amount: number) => void
  setShowDimensions: (show: boolean) => void
  toggleDimensions: () => void
  setActiveView: (view: FurniturePreviewView) => void
  setBackgroundMode: (mode: FurniturePreviewBackground) => void
  toggleBackgroundMode: () => void
  resetCamera: () => void
  setSelectedMaterialId: (id: FurniturePreviewMaterialId) => void
  setCustomColor: (color: string) => void
  resetPreview: () => void
}

function clampPreviewAmount(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export const useFurniturePreviewStore = create<FurniturePreviewState>((set) => ({
  ...DEFAULT_PREVIEW_SETTINGS,
  cameraResetKey: 0,

  setShowDoors: (show) => set({ showDoors: show }),
  toggleShowDoors: () => set((state) => ({ showDoors: !state.showDoors })),
  setExplodedView: (enabled) => set({ explodedView: enabled }),
  toggleExplodedView: () => set((state) => ({ explodedView: !state.explodedView })),
  setExplodedAmount: (amount) => set({ explodedAmount: clampPreviewAmount(amount) }),
  setShowDimensions: (show) => set({ showDimensions: show }),
  toggleDimensions: () => set((state) => ({ showDimensions: !state.showDimensions })),
  setActiveView: (view) => set({ activeView: view }),
  setBackgroundMode: (mode) => set({ backgroundMode: mode }),
  toggleBackgroundMode: () => set((state) => ({
    backgroundMode: state.backgroundMode === 'dark' ? 'light' : 'dark',
  })),
  resetCamera: () => set((state) => ({
    activeView: 'isometric',
    cameraResetKey: state.cameraResetKey + 1,
  })),
  setSelectedMaterialId: (id) => set((state) => ({
    selectedMaterialId: getFurniturePreviewMaterial(id, state.customColor).id,
  })),
  setCustomColor: (color) => set({
    customColor: normalizeHexColor(color),
    selectedMaterialId: 'custom',
  }),
  resetPreview: () => set((state) => ({
    ...DEFAULT_PREVIEW_SETTINGS,
    cameraResetKey: state.cameraResetKey + 1,
  })),
}))
