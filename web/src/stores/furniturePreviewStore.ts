import { create } from 'zustand'
import {
  createDefaultCustomFurnitureMaterial,
  normalizeCustomFurnitureMaterial,
  type CustomFurnitureMaterial,
  type CustomFurnitureMaterialInput,
  type FurnitureMaterialTextureImage,
} from '../types/furnitureMaterials'
import type {
  FurnitureDesignCustomMaterial,
  FurnitureDesignMaterialTextureImage,
  FurnitureDesignPreviewSettings,
} from '../services/furnitureDesignService'

export type FurniturePreviewView = 'isometric' | 'front' | 'side' | 'top'
export type FurniturePreviewBackground = 'dark' | 'light'
export type FurniturePreviewMaterialSource = 'preset' | 'custom_material'
export type FurniturePreviewMaterialArea = 'carcass' | 'doors' | 'drawers' | 'back'
export type FurniturePreviewMaterialTarget = 'all' | FurniturePreviewMaterialArea
export type FurnitureMeasurementHorizontalReference =
  | 'interior_left'
  | 'exterior_left'
  | 'section_start'
  | 'interior_right'
  | 'exterior_right'
export type FurnitureMeasurementVerticalReference =
  | 'interior_bottom'
  | 'exterior_bottom'
  | 'interior_top'
  | 'exterior_top'
export type FurnitureMeasurementDepthReference = 'front' | 'back'
export type FurnitureMeasurementPanelReference = 'centerline' | 'near_face' | 'far_face'
export type FurniturePreviewMaterialId =
  | 'design'
  | 'natural_oak'
  | 'walnut'
  | 'teak'
  | 'ivory'
  | 'charcoal'
  | 'custom'

const FURNITURE_PREVIEW_VIEWS: FurniturePreviewView[] = ['isometric', 'front', 'side', 'top']
const FURNITURE_PREVIEW_BACKGROUNDS: FurniturePreviewBackground[] = ['dark', 'light']
const FURNITURE_PREVIEW_MATERIAL_SOURCES: FurniturePreviewMaterialSource[] = ['preset', 'custom_material']
export const FURNITURE_PREVIEW_MATERIAL_AREAS: FurniturePreviewMaterialArea[] = ['carcass', 'doors', 'drawers', 'back']
export const FURNITURE_PREVIEW_MATERIAL_TARGETS: FurniturePreviewMaterialTarget[] = ['all', ...FURNITURE_PREVIEW_MATERIAL_AREAS]
export const FURNITURE_MEASUREMENT_HORIZONTAL_REFERENCES: FurnitureMeasurementHorizontalReference[] = [
  'interior_left',
  'exterior_left',
  'section_start',
  'interior_right',
  'exterior_right',
]
export const FURNITURE_MEASUREMENT_VERTICAL_REFERENCES: FurnitureMeasurementVerticalReference[] = [
  'interior_bottom',
  'exterior_bottom',
  'interior_top',
  'exterior_top',
]
export const FURNITURE_MEASUREMENT_DEPTH_REFERENCES: FurnitureMeasurementDepthReference[] = ['front', 'back']
export const FURNITURE_MEASUREMENT_PANEL_REFERENCES: FurnitureMeasurementPanelReference[] = [
  'centerline',
  'near_face',
  'far_face',
]
const FURNITURE_PREVIEW_MATERIAL_IDS: FurniturePreviewMaterialId[] = [
  'design',
  'natural_oak',
  'walnut',
  'teak',
  'ivory',
  'charcoal',
  'custom',
]

export interface FurniturePreviewMaterial {
  id: FurniturePreviewMaterialId
  name: string
  color: string
  secondaryColor: string
  backPanelColor: string
  drawerColor: string
}

export interface FurniturePreviewMaterialAssignment {
  materialSource: FurniturePreviewMaterialSource
  selectedMaterialId: FurniturePreviewMaterialId
  selectedCustomMaterialId: string | null
  customColor: string
}

export interface FurniturePreviewSettings {
  showDoors: boolean
  explodedView: boolean
  explodedAmount: number
  showDimensions: boolean
  activeView: FurniturePreviewView
  measurementHorizontalReference: FurnitureMeasurementHorizontalReference
  measurementVerticalReference: FurnitureMeasurementVerticalReference
  measurementDepthReference: FurnitureMeasurementDepthReference
  measurementPanelReference: FurnitureMeasurementPanelReference
  backgroundMode: FurniturePreviewBackground
  materialSource: FurniturePreviewMaterialSource
  selectedMaterialId: FurniturePreviewMaterialId
  selectedCustomMaterialId: string | null
  customColor: string
  customMaterials: CustomFurnitureMaterial[]
  materialApplyTarget: FurniturePreviewMaterialTarget
  materialAssignments: Record<FurniturePreviewMaterialArea, FurniturePreviewMaterialAssignment>
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

const DEFAULT_MATERIAL_ASSIGNMENT: FurniturePreviewMaterialAssignment = {
  materialSource: 'preset',
  selectedMaterialId: 'design',
  selectedCustomMaterialId: null,
  customColor: DEFAULT_CUSTOM_PREVIEW_COLOR,
}

const DEFAULT_MATERIAL_ASSIGNMENTS: Record<FurniturePreviewMaterialArea, FurniturePreviewMaterialAssignment> = {
  carcass: { ...DEFAULT_MATERIAL_ASSIGNMENT },
  doors: { ...DEFAULT_MATERIAL_ASSIGNMENT },
  drawers: { ...DEFAULT_MATERIAL_ASSIGNMENT },
  back: { ...DEFAULT_MATERIAL_ASSIGNMENT },
}

const DEFAULT_PREVIEW_SETTINGS: FurniturePreviewSettings = {
  showDoors: true,
  explodedView: false,
  explodedAmount: 0.35,
  showDimensions: false,
  activeView: 'isometric',
  measurementHorizontalReference: 'interior_left',
  measurementVerticalReference: 'interior_bottom',
  measurementDepthReference: 'front',
  measurementPanelReference: 'centerline',
  backgroundMode: 'dark',
  materialSource: 'preset',
  selectedMaterialId: 'design',
  selectedCustomMaterialId: null,
  customColor: DEFAULT_CUSTOM_PREVIEW_COLOR,
  customMaterials: [],
  materialApplyTarget: 'all',
  materialAssignments: DEFAULT_MATERIAL_ASSIGNMENTS,
}

function normalizeHexColor(value: string | undefined) {
  const trimmed = value?.trim() ?? ''

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

export function createPreviewMaterialFromCustomFurnitureMaterial(
  material: CustomFurnitureMaterial,
): FurniturePreviewMaterial {
  const normalizedColor = normalizeHexColor(material.baseColor)

  return {
    id: 'custom',
    name: material.name,
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

export function getSelectedCustomFurnitureMaterial(
  customMaterials: CustomFurnitureMaterial[],
  selectedCustomMaterialId: string | null,
) {
  if (!selectedCustomMaterialId) return null
  return customMaterials.find((material) => material.id === selectedCustomMaterialId) ?? null
}

export function getActiveFurniturePreviewMaterial(
  settings: Pick<
    FurniturePreviewSettings,
    | 'customColor'
    | 'customMaterials'
    | 'materialSource'
    | 'selectedCustomMaterialId'
    | 'selectedMaterialId'
  >,
) {
  if (settings.materialSource === 'custom_material') {
    const customMaterial = getSelectedCustomFurnitureMaterial(
      settings.customMaterials,
      settings.selectedCustomMaterialId,
    )

    if (customMaterial) {
      return createPreviewMaterialFromCustomFurnitureMaterial(customMaterial)
    }
  }

  return getFurniturePreviewMaterial(settings.selectedMaterialId, settings.customColor)
}

function createPresetAssignment(
  selectedMaterialId: FurniturePreviewMaterialId,
  customColor = DEFAULT_CUSTOM_PREVIEW_COLOR,
): FurniturePreviewMaterialAssignment {
  return {
    materialSource: 'preset',
    selectedMaterialId: getFurniturePreviewMaterial(selectedMaterialId, customColor).id,
    selectedCustomMaterialId: null,
    customColor: normalizeHexColor(customColor),
  }
}

function createCustomMaterialAssignment(material: CustomFurnitureMaterial): FurniturePreviewMaterialAssignment {
  return {
    materialSource: 'custom_material',
    selectedMaterialId: 'custom',
    selectedCustomMaterialId: material.id,
    customColor: material.baseColor,
  }
}

export function getFurniturePreviewMaterialForAssignment(
  assignment: FurniturePreviewMaterialAssignment,
  customMaterials: CustomFurnitureMaterial[],
) {
  if (assignment.materialSource === 'custom_material') {
    const customMaterial = getSelectedCustomFurnitureMaterial(customMaterials, assignment.selectedCustomMaterialId)

    if (customMaterial) {
      return createPreviewMaterialFromCustomFurnitureMaterial(customMaterial)
    }
  }

  return getFurniturePreviewMaterial(assignment.selectedMaterialId, assignment.customColor)
}

export function getCustomFurnitureMaterialForAssignment(
  assignment: FurniturePreviewMaterialAssignment,
  customMaterials: CustomFurnitureMaterial[],
) {
  if (assignment.materialSource !== 'custom_material') return null
  return getSelectedCustomFurnitureMaterial(customMaterials, assignment.selectedCustomMaterialId)
}

export function getFurniturePreviewAssignmentForArea(
  settings: Pick<FurniturePreviewSettings, 'materialAssignments'>,
  area: FurniturePreviewMaterialArea,
) {
  return settings.materialAssignments[area] ?? DEFAULT_MATERIAL_ASSIGNMENT
}

interface FurniturePreviewState extends FurniturePreviewSettings {
  cameraResetKey: number
  hasUnsavedChanges: boolean

  setShowDoors: (show: boolean) => void
  toggleShowDoors: () => void
  setExplodedView: (enabled: boolean) => void
  toggleExplodedView: () => void
  setExplodedAmount: (amount: number) => void
  setShowDimensions: (show: boolean) => void
  toggleDimensions: () => void
  setActiveView: (view: FurniturePreviewView) => void
  setMeasurementHorizontalReference: (reference: FurnitureMeasurementHorizontalReference) => void
  setMeasurementVerticalReference: (reference: FurnitureMeasurementVerticalReference) => void
  setMeasurementDepthReference: (reference: FurnitureMeasurementDepthReference) => void
  setMeasurementPanelReference: (reference: FurnitureMeasurementPanelReference) => void
  setBackgroundMode: (mode: FurniturePreviewBackground) => void
  toggleBackgroundMode: () => void
  resetCamera: () => void
  setMaterialApplyTarget: (target: FurniturePreviewMaterialTarget) => void
  setSelectedMaterialId: (id: FurniturePreviewMaterialId) => void
  setCustomColor: (color: string) => void
  setCustomMaterials: (materials?: CustomFurnitureMaterialInput[]) => void
  addCustomMaterial: (material: CustomFurnitureMaterialInput) => CustomFurnitureMaterial
  updateCustomMaterial: (id: string, patch: CustomFurnitureMaterialInput) => void
  removeCustomMaterial: (id: string) => void
  selectCustomMaterial: (id: string | null) => void
  clearCustomMaterials: () => void
  getSelectedCustomMaterial: () => CustomFurnitureMaterial | null
  serializePreviewSettings: () => FurnitureDesignPreviewSettings
  loadPreviewSettings: (settings?: FurnitureDesignPreviewSettings | null) => void
  markSaved: () => void
  resetPreview: () => void
}

function clampPreviewAmount(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizeCustomMaterialLibrary(materials: CustomFurnitureMaterialInput[] | undefined) {
  const seen = new Set<string>()

  return (materials ?? [])
    .map((material) => normalizeCustomFurnitureMaterial(material))
    .filter((material) => {
      if (seen.has(material.id)) return false
      seen.add(material.id)
      return true
    })
}

function isPreviewView(value: string | undefined): value is FurniturePreviewView {
  return FURNITURE_PREVIEW_VIEWS.includes(value as FurniturePreviewView)
}

function isPreviewBackground(value: string | undefined): value is FurniturePreviewBackground {
  return FURNITURE_PREVIEW_BACKGROUNDS.includes(value as FurniturePreviewBackground)
}

function isPreviewMaterialSource(value: string | undefined): value is FurniturePreviewMaterialSource {
  return FURNITURE_PREVIEW_MATERIAL_SOURCES.includes(value as FurniturePreviewMaterialSource)
}

function isPreviewMaterialId(value: string | undefined): value is FurniturePreviewMaterialId {
  return FURNITURE_PREVIEW_MATERIAL_IDS.includes(value as FurniturePreviewMaterialId)
}

function isPreviewMaterialArea(value: string | undefined): value is FurniturePreviewMaterialArea {
  return FURNITURE_PREVIEW_MATERIAL_AREAS.includes(value as FurniturePreviewMaterialArea)
}

function isPreviewMaterialTarget(value: string | undefined): value is FurniturePreviewMaterialTarget {
  return FURNITURE_PREVIEW_MATERIAL_TARGETS.includes(value as FurniturePreviewMaterialTarget)
}

function isMeasurementHorizontalReference(value: string | undefined): value is FurnitureMeasurementHorizontalReference {
  return FURNITURE_MEASUREMENT_HORIZONTAL_REFERENCES.includes(value as FurnitureMeasurementHorizontalReference)
}

function isMeasurementVerticalReference(value: string | undefined): value is FurnitureMeasurementVerticalReference {
  return FURNITURE_MEASUREMENT_VERTICAL_REFERENCES.includes(value as FurnitureMeasurementVerticalReference)
}

function isMeasurementDepthReference(value: string | undefined): value is FurnitureMeasurementDepthReference {
  return FURNITURE_MEASUREMENT_DEPTH_REFERENCES.includes(value as FurnitureMeasurementDepthReference)
}

function isMeasurementPanelReference(value: string | undefined): value is FurnitureMeasurementPanelReference {
  return FURNITURE_MEASUREMENT_PANEL_REFERENCES.includes(value as FurnitureMeasurementPanelReference)
}

function copyMaterialAssignments(
  assignments: Record<FurniturePreviewMaterialArea, FurniturePreviewMaterialAssignment>,
) {
  return Object.fromEntries(
    FURNITURE_PREVIEW_MATERIAL_AREAS.map((area) => [area, { ...assignments[area] }]),
  ) as Record<FurniturePreviewMaterialArea, FurniturePreviewMaterialAssignment>
}

function createDefaultMaterialAssignments() {
  return copyMaterialAssignments(DEFAULT_MATERIAL_ASSIGNMENTS)
}

function createMaterialAssignmentFromState(
  state: Pick<
    FurniturePreviewSettings,
    'customColor' | 'customMaterials' | 'materialSource' | 'selectedCustomMaterialId' | 'selectedMaterialId'
  >,
): FurniturePreviewMaterialAssignment {
  if (state.materialSource === 'custom_material') {
    const customMaterial = getSelectedCustomFurnitureMaterial(state.customMaterials, state.selectedCustomMaterialId)
    if (customMaterial) return createCustomMaterialAssignment(customMaterial)
  }

  return createPresetAssignment(state.selectedMaterialId, state.customColor)
}

function normalizeMaterialAssignment(
  assignment: Partial<FurniturePreviewMaterialAssignment> | undefined,
  customMaterials: CustomFurnitureMaterial[],
  fallback = DEFAULT_MATERIAL_ASSIGNMENT,
): FurniturePreviewMaterialAssignment {
  const materialSource = isPreviewMaterialSource(assignment?.materialSource)
    ? assignment.materialSource
    : fallback.materialSource
  const selectedCustomMaterialId = typeof assignment?.selectedCustomMaterialId === 'string'
    ? assignment.selectedCustomMaterialId
    : fallback.selectedCustomMaterialId

  if (materialSource === 'custom_material') {
    const customMaterial = getSelectedCustomFurnitureMaterial(customMaterials, selectedCustomMaterialId)
    if (customMaterial) return createCustomMaterialAssignment(customMaterial)
  }

  return createPresetAssignment(
    isPreviewMaterialId(assignment?.selectedMaterialId)
      ? assignment.selectedMaterialId
      : fallback.selectedMaterialId,
    assignment?.customColor ?? fallback.customColor,
  )
}

function normalizeMaterialAssignments(
  assignments: Partial<Record<FurniturePreviewMaterialArea, Partial<FurniturePreviewMaterialAssignment>>> | undefined,
  customMaterials: CustomFurnitureMaterial[],
  fallback: FurniturePreviewMaterialAssignment,
) {
  return Object.fromEntries(
    FURNITURE_PREVIEW_MATERIAL_AREAS.map((area) => [
      area,
      normalizeMaterialAssignment(assignments?.[area], customMaterials, fallback),
    ]),
  ) as Record<FurniturePreviewMaterialArea, FurniturePreviewMaterialAssignment>
}

function applyMaterialAssignmentToTarget(
  state: FurniturePreviewState,
  assignment: FurniturePreviewMaterialAssignment,
) {
  const materialAssignments = copyMaterialAssignments(state.materialAssignments)

  if (state.materialApplyTarget === 'all') {
    FURNITURE_PREVIEW_MATERIAL_AREAS.forEach((area) => {
      materialAssignments[area] = { ...assignment }
    })
  } else {
    materialAssignments[state.materialApplyTarget] = { ...assignment }
  }

  return {
    materialSource: assignment.materialSource,
    selectedMaterialId: assignment.selectedMaterialId,
    selectedCustomMaterialId: assignment.selectedCustomMaterialId,
    customColor: assignment.customColor,
    materialAssignments,
  }
}

function serializeTextureImage(
  texture: FurnitureMaterialTextureImage | null,
): FurnitureDesignMaterialTextureImage | null {
  if (!texture) return null

  return {
    id: texture.id,
    name: texture.name,
    source: texture.source,
    src: texture.src,
    mime_type: texture.mimeType,
    file_name: texture.fileName,
    size_bytes: texture.sizeBytes,
    width: texture.width,
    height: texture.height,
  }
}

function deserializeTextureImage(
  texture: FurnitureDesignMaterialTextureImage | null | undefined,
): CustomFurnitureMaterialInput['texture'] {
  if (!texture) return null

  return {
    id: texture.id,
    name: texture.name,
    source: texture.source,
    src: texture.src,
    mimeType: texture.mime_type,
    fileName: texture.file_name,
    sizeBytes: texture.size_bytes,
    width: texture.width,
    height: texture.height,
  }
}

function serializeCustomMaterial(material: CustomFurnitureMaterial): FurnitureDesignCustomMaterial {
  return {
    id: material.id,
    name: material.name,
    base_color: material.baseColor,
    finish: material.finish,
    grain_direction: material.grainDirection,
    texture: serializeTextureImage(material.texture),
    texture_scale: material.textureScale,
    texture_repeat: { ...material.textureRepeat },
    created_at: material.createdAt,
    updated_at: material.updatedAt,
  }
}

function deserializeCustomMaterial(material: FurnitureDesignCustomMaterial): CustomFurnitureMaterialInput {
  return {
    id: material.id,
    name: material.name,
    baseColor: material.base_color,
    finish: material.finish,
    grainDirection: material.grain_direction,
    texture: deserializeTextureImage(material.texture),
    textureScale: material.texture_scale,
    textureRepeat: material.texture_repeat,
    createdAt: material.created_at,
    updatedAt: material.updated_at,
  }
}

function serializeFurniturePreviewSettings(
  settings: FurniturePreviewSettings,
): FurnitureDesignPreviewSettings {
  return {
    show_doors: settings.showDoors,
    exploded_view: settings.explodedView,
    exploded_amount: settings.explodedAmount,
    show_dimensions: settings.showDimensions,
    active_view: settings.activeView,
    measurement_horizontal_reference: settings.measurementHorizontalReference,
    measurement_vertical_reference: settings.measurementVerticalReference,
    measurement_depth_reference: settings.measurementDepthReference,
    measurement_panel_reference: settings.measurementPanelReference,
    background_mode: settings.backgroundMode,
    material_source: settings.materialSource,
    selected_material_id: settings.selectedMaterialId,
    selected_custom_material_id: settings.selectedCustomMaterialId,
    custom_color: settings.customColor,
    custom_materials: settings.customMaterials.map(serializeCustomMaterial),
    material_apply_target: settings.materialApplyTarget,
    material_assignments: Object.fromEntries(
      Object.entries(settings.materialAssignments).map(([area, assignment]) => [
        area,
        {
          material_source: assignment.materialSource,
          selected_material_id: assignment.selectedMaterialId,
          selected_custom_material_id: assignment.selectedCustomMaterialId,
          custom_color: assignment.customColor,
        },
      ]),
    ) as FurnitureDesignPreviewSettings['material_assignments'],
  }
}

function deserializeMaterialAssignments(
  assignments: FurnitureDesignPreviewSettings['material_assignments'] | undefined,
) {
  if (!assignments) return undefined

  return Object.fromEntries(
    Object.entries(assignments)
      .filter(([area]) => isPreviewMaterialArea(area))
      .map(([area, assignment]) => [
        area,
        {
          materialSource: assignment.material_source,
          selectedMaterialId: assignment.selected_material_id,
          selectedCustomMaterialId: assignment.selected_custom_material_id,
          customColor: assignment.custom_color,
        },
      ]),
  ) as Partial<Record<FurniturePreviewMaterialArea, Partial<FurniturePreviewMaterialAssignment>>>
}

function normalizeFurniturePreviewSettings(
  settings: FurnitureDesignPreviewSettings | null | undefined,
): FurniturePreviewSettings {
  if (!settings) {
    return {
      ...DEFAULT_PREVIEW_SETTINGS,
      customMaterials: [],
      materialAssignments: createDefaultMaterialAssignments(),
    }
  }

  const customMaterials = normalizeCustomMaterialLibrary(
    settings.custom_materials?.map(deserializeCustomMaterial),
  )
  const materialSource = isPreviewMaterialSource(settings.material_source)
    ? settings.material_source
    : DEFAULT_PREVIEW_SETTINGS.materialSource
  const selectedCustomMaterialId = typeof settings.selected_custom_material_id === 'string'
    ? settings.selected_custom_material_id
    : null
  const selectedCustomMaterial = materialSource === 'custom_material'
    ? getSelectedCustomFurnitureMaterial(customMaterials, selectedCustomMaterialId)
    : null
  const selectedMaterialId = isPreviewMaterialId(settings.selected_material_id)
    ? getFurniturePreviewMaterial(settings.selected_material_id).id
    : DEFAULT_PREVIEW_SETTINGS.selectedMaterialId
  const activeAssignment: FurniturePreviewMaterialAssignment = selectedCustomMaterial
    ? createCustomMaterialAssignment(selectedCustomMaterial)
    : createPresetAssignment(selectedMaterialId, settings.custom_color)
  const materialAssignments = normalizeMaterialAssignments(
    deserializeMaterialAssignments(settings.material_assignments),
    customMaterials,
    activeAssignment,
  )
  const materialApplyTarget = isPreviewMaterialTarget(settings.material_apply_target)
    ? settings.material_apply_target
    : DEFAULT_PREVIEW_SETTINGS.materialApplyTarget
  const targetAssignment = materialApplyTarget !== 'all'
    ? materialAssignments[materialApplyTarget]
    : activeAssignment

  return {
    showDoors: typeof settings.show_doors === 'boolean'
      ? settings.show_doors
      : DEFAULT_PREVIEW_SETTINGS.showDoors,
    explodedView: typeof settings.exploded_view === 'boolean'
      ? settings.exploded_view
      : DEFAULT_PREVIEW_SETTINGS.explodedView,
    explodedAmount: clampPreviewAmount(settings.exploded_amount ?? DEFAULT_PREVIEW_SETTINGS.explodedAmount),
    showDimensions: typeof settings.show_dimensions === 'boolean'
      ? settings.show_dimensions
      : DEFAULT_PREVIEW_SETTINGS.showDimensions,
    activeView: isPreviewView(settings.active_view)
      ? settings.active_view
      : DEFAULT_PREVIEW_SETTINGS.activeView,
    measurementHorizontalReference: isMeasurementHorizontalReference(settings.measurement_horizontal_reference)
      ? settings.measurement_horizontal_reference
      : DEFAULT_PREVIEW_SETTINGS.measurementHorizontalReference,
    measurementVerticalReference: isMeasurementVerticalReference(settings.measurement_vertical_reference)
      ? settings.measurement_vertical_reference
      : DEFAULT_PREVIEW_SETTINGS.measurementVerticalReference,
    measurementDepthReference: isMeasurementDepthReference(settings.measurement_depth_reference)
      ? settings.measurement_depth_reference
      : DEFAULT_PREVIEW_SETTINGS.measurementDepthReference,
    measurementPanelReference: isMeasurementPanelReference(settings.measurement_panel_reference)
      ? settings.measurement_panel_reference
      : DEFAULT_PREVIEW_SETTINGS.measurementPanelReference,
    backgroundMode: isPreviewBackground(settings.background_mode)
      ? settings.background_mode
      : DEFAULT_PREVIEW_SETTINGS.backgroundMode,
    materialSource: targetAssignment.materialSource,
    selectedMaterialId: targetAssignment.selectedMaterialId,
    selectedCustomMaterialId: targetAssignment.selectedCustomMaterialId,
    customColor: targetAssignment.customColor,
    customMaterials,
    materialApplyTarget,
    materialAssignments,
  }
}

function markPreviewChanged<T extends object>(patch: T) {
  return {
    ...patch,
    hasUnsavedChanges: true,
  }
}

export const useFurniturePreviewStore = create<FurniturePreviewState>((set, get) => ({
  ...DEFAULT_PREVIEW_SETTINGS,
  cameraResetKey: 0,
  hasUnsavedChanges: false,

  setShowDoors: (show) => set(markPreviewChanged({ showDoors: show })),
  toggleShowDoors: () => set((state) => markPreviewChanged({ showDoors: !state.showDoors })),
  setExplodedView: (enabled) => set(markPreviewChanged({ explodedView: enabled })),
  toggleExplodedView: () => set((state) => markPreviewChanged({ explodedView: !state.explodedView })),
  setExplodedAmount: (amount) => set(markPreviewChanged({ explodedAmount: clampPreviewAmount(amount) })),
  setShowDimensions: (show) => set(markPreviewChanged({ showDimensions: show })),
  toggleDimensions: () => set((state) => markPreviewChanged({ showDimensions: !state.showDimensions })),
  setActiveView: (view) => set(markPreviewChanged({ activeView: view })),
  setMeasurementHorizontalReference: (reference) => set(markPreviewChanged({
    measurementHorizontalReference: reference,
  })),
  setMeasurementVerticalReference: (reference) => set(markPreviewChanged({
    measurementVerticalReference: reference,
  })),
  setMeasurementDepthReference: (reference) => set(markPreviewChanged({
    measurementDepthReference: reference,
  })),
  setMeasurementPanelReference: (reference) => set(markPreviewChanged({
    measurementPanelReference: reference,
  })),
  setBackgroundMode: (mode) => set(markPreviewChanged({ backgroundMode: mode })),
  toggleBackgroundMode: () => set((state) => markPreviewChanged({
    backgroundMode: state.backgroundMode === 'dark' ? 'light' : 'dark',
  })),
  resetCamera: () => set((state) => ({
    activeView: 'isometric',
    cameraResetKey: state.cameraResetKey + 1,
    hasUnsavedChanges: true,
  })),
  setMaterialApplyTarget: (target) => set((state) => {
    if (state.materialApplyTarget === target) return {}

    if (target === 'all') {
      return markPreviewChanged({ materialApplyTarget: target })
    }

    const assignment = state.materialAssignments[target]

    return markPreviewChanged({
      materialApplyTarget: target,
      materialSource: assignment.materialSource,
      selectedMaterialId: assignment.selectedMaterialId,
      selectedCustomMaterialId: assignment.selectedCustomMaterialId,
      customColor: assignment.customColor,
    })
  }),
  setSelectedMaterialId: (id) => set((state) => markPreviewChanged(
    applyMaterialAssignmentToTarget(state, createPresetAssignment(id, state.customColor)),
  )),
  setCustomColor: (color) => set((state) => markPreviewChanged(
    applyMaterialAssignmentToTarget(state, createPresetAssignment('custom', color)),
  )),
  setCustomMaterials: (materials) => set((state) => {
    const customMaterials = normalizeCustomMaterialLibrary(materials)
    const currentAssignment = normalizeMaterialAssignment(
      createMaterialAssignmentFromState(state),
      customMaterials,
      DEFAULT_MATERIAL_ASSIGNMENT,
    )
    const materialAssignments = normalizeMaterialAssignments(
      state.materialAssignments,
      customMaterials,
      currentAssignment,
    )
    const activeAssignment = state.materialApplyTarget !== 'all'
      ? materialAssignments[state.materialApplyTarget]
      : currentAssignment

    return markPreviewChanged({
      customMaterials,
      materialAssignments,
      materialSource: activeAssignment.materialSource,
      selectedMaterialId: activeAssignment.selectedMaterialId,
      selectedCustomMaterialId: activeAssignment.selectedCustomMaterialId,
      customColor: activeAssignment.customColor,
    })
  }),
  addCustomMaterial: (input) => {
    const material = createDefaultCustomFurnitureMaterial(input)
    const assignment = createCustomMaterialAssignment(material)

    set((state) => markPreviewChanged({
      customMaterials: [
        ...state.customMaterials.filter((item) => item.id !== material.id),
        material,
      ],
      ...applyMaterialAssignmentToTarget(state, assignment),
    }))

    return material
  },
  updateCustomMaterial: (id, patch) => set((state) => {
    const existingMaterial = state.customMaterials.find((material) => material.id === id)
    if (!existingMaterial) return {}

    const updatedMaterial = normalizeCustomFurnitureMaterial(
      { ...patch, id: existingMaterial.id },
      existingMaterial,
    )
    const isSelected = state.materialSource === 'custom_material'
      && state.selectedCustomMaterialId === existingMaterial.id

    return markPreviewChanged({
      customMaterials: state.customMaterials.map((material) => (
        material.id === existingMaterial.id ? updatedMaterial : material
      )),
      ...(isSelected ? { customColor: updatedMaterial.baseColor } : {}),
    })
  }),
  removeCustomMaterial: (id) => set((state) => {
    const customMaterials = state.customMaterials.filter((material) => material.id !== id)
    const isSelected = state.materialSource === 'custom_material'
      && state.selectedCustomMaterialId === id
    const fallbackAssignment = createPresetAssignment('design', state.customColor)
    const materialAssignments = normalizeMaterialAssignments(
      state.materialAssignments,
      customMaterials,
      fallbackAssignment,
    )

    return markPreviewChanged({
      customMaterials,
      materialAssignments,
      ...(isSelected
        ? {
            materialSource: 'preset' as const,
            selectedCustomMaterialId: null,
            selectedMaterialId: 'design' as const,
          }
        : {}),
    })
  }),
  selectCustomMaterial: (id) => set((state) => {
    const customMaterial = getSelectedCustomFurnitureMaterial(state.customMaterials, id)

    if (!customMaterial) {
      return markPreviewChanged(applyMaterialAssignmentToTarget(
        state,
        createPresetAssignment('design', state.customColor),
      ))
    }

    return markPreviewChanged(applyMaterialAssignmentToTarget(state, createCustomMaterialAssignment(customMaterial)))
  }),
  clearCustomMaterials: () => set(markPreviewChanged({
    customMaterials: [],
    materialSource: 'preset',
    selectedCustomMaterialId: null,
    selectedMaterialId: 'design',
    customColor: DEFAULT_CUSTOM_PREVIEW_COLOR,
    materialAssignments: createDefaultMaterialAssignments(),
  })),
  getSelectedCustomMaterial: () => {
    const state = get()

    if (state.materialSource !== 'custom_material') return null
    return getSelectedCustomFurnitureMaterial(state.customMaterials, state.selectedCustomMaterialId)
  },
  serializePreviewSettings: () => serializeFurniturePreviewSettings(get()),
  loadPreviewSettings: (settings) => set((state) => ({
    ...normalizeFurniturePreviewSettings(settings),
    cameraResetKey: state.cameraResetKey + 1,
    hasUnsavedChanges: false,
  })),
  markSaved: () => set({ hasUnsavedChanges: false }),
  resetPreview: () => set((state) => markPreviewChanged({
    ...DEFAULT_PREVIEW_SETTINGS,
    customMaterials: state.customMaterials,
    materialAssignments: createDefaultMaterialAssignments(),
    cameraResetKey: state.cameraResetKey + 1,
  })),
}))
