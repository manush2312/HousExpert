import api from './api'
import type {
  FurnitureMaterialFinish,
  FurnitureMaterialGrainDirection,
  FurnitureMaterialTextureMimeType,
  FurnitureMaterialTextureSource,
} from '../types/furnitureMaterials'

export type FurnitureType = 'wardrobe' | 'cabinet' | 'tv_unit' | 'bookshelf' | 'kitchen_base'
export type FurnitureDoorType = 'none' | 'single' | 'double'

export interface FurnitureOuterBox {
  width: number
  height: number
  depth: number
}

export interface FurnitureMaterial {
  thickness: number
  back_panel_thickness: number
  color: string
}

export type FurnitureDesignPreviewView = 'isometric' | 'front' | 'side' | 'top'
export type FurnitureDesignPreviewBackground = 'dark' | 'light'
export type FurnitureDesignPreviewMaterialSource = 'preset' | 'custom_material'
export type FurnitureDesignPreviewMaterialArea = 'carcass' | 'doors' | 'drawers' | 'back'
export type FurnitureDesignPreviewMaterialTarget = 'all' | FurnitureDesignPreviewMaterialArea
export type FurnitureDesignMeasurementHorizontalReference =
  | 'interior_left'
  | 'exterior_left'
  | 'section_start'
  | 'interior_right'
  | 'exterior_right'
export type FurnitureDesignMeasurementVerticalReference =
  | 'interior_bottom'
  | 'exterior_bottom'
  | 'interior_top'
  | 'exterior_top'
export type FurnitureDesignMeasurementDepthReference = 'front' | 'back'
export type FurnitureDesignMeasurementPanelReference = 'centerline' | 'near_face' | 'far_face'
export type FurnitureDesignPreviewMaterialId =
  | 'design'
  | 'natural_oak'
  | 'walnut'
  | 'teak'
  | 'ivory'
  | 'charcoal'
  | 'custom'

export interface FurnitureDesignMaterialTextureRepeat {
  x: number
  y: number
}

export interface FurnitureDesignMaterialTextureImage {
  id: string
  name: string
  source: FurnitureMaterialTextureSource
  src: string
  mime_type?: FurnitureMaterialTextureMimeType
  file_name?: string
  size_bytes?: number
  width?: number
  height?: number
}

export interface FurnitureDesignCustomMaterial {
  id: string
  name: string
  base_color: string
  finish: FurnitureMaterialFinish
  grain_direction: FurnitureMaterialGrainDirection
  texture: FurnitureDesignMaterialTextureImage | null
  texture_scale: number
  texture_repeat: FurnitureDesignMaterialTextureRepeat
  created_at: string
  updated_at: string
}

export interface FurnitureDesignPreviewSettings {
  show_doors: boolean
  exploded_view: boolean
  exploded_amount: number
  show_dimensions: boolean
  active_view: FurnitureDesignPreviewView
  measurement_horizontal_reference?: FurnitureDesignMeasurementHorizontalReference
  measurement_vertical_reference?: FurnitureDesignMeasurementVerticalReference
  measurement_depth_reference?: FurnitureDesignMeasurementDepthReference
  measurement_panel_reference?: FurnitureDesignMeasurementPanelReference
  background_mode: FurnitureDesignPreviewBackground
  material_source: FurnitureDesignPreviewMaterialSource
  selected_material_id: FurnitureDesignPreviewMaterialId
  selected_custom_material_id: string | null
  custom_color: string
  custom_materials: FurnitureDesignCustomMaterial[]
  material_apply_target?: FurnitureDesignPreviewMaterialTarget
  material_assignments?: Record<FurnitureDesignPreviewMaterialArea, FurnitureDesignPreviewMaterialAssignment>
}

export interface FurnitureDesignPreviewMaterialAssignment {
  material_source: FurnitureDesignPreviewMaterialSource
  selected_material_id: FurnitureDesignPreviewMaterialId
  selected_custom_material_id: string | null
  custom_color: string
}

export interface FurnitureShelf {
  element_id: string
  from_bottom: number
  section_index: number
}

export interface FurniturePartition {
  element_id: string
  from_left: number
}

export interface FurnitureShelfPartition {
  element_id: string
  section_index: number
  from_left: number
  from_bottom: number
  to_bottom: number
}

export interface FurnitureDrawer {
  element_id: string
  section_index: number
  from_bottom: number
  height: number
  front_setback: number
}

export interface FurnitureCustomPanel {
  element_id: string
  name: string
  from_left: number
  from_bottom: number
  width: number
  height: number
  thickness: number
}

export interface FurnitureFreehandPath {
  element_id: string
  points: number[]
  stroke: string
  stroke_width: number
}

export interface FurnitureSectionConfig {
  door: FurnitureDoorType
  hanging_rail: boolean
}

export interface FurnitureDesign {
  id: string
  design_id: string
  name: string
  furniture_type: FurnitureType
  outer_box?: FurnitureOuterBox
  material: FurnitureMaterial
  shelves: FurnitureShelf[]
  partitions: FurniturePartition[]
  drawers: FurnitureDrawer[]
  custom_panels: FurnitureCustomPanel[]
  shelf_partitions: FurnitureShelfPartition[]
  freehand_paths: FurnitureFreehandPath[]
  section_configs: Record<string, FurnitureSectionConfig>
  preview_settings?: FurnitureDesignPreviewSettings | null
  created_at: string
  updated_at: string
}

export interface FurnitureDesignListResult {
  designs: FurnitureDesign[]
  total: number
  page: number
  limit: number
}

export interface CreateFurnitureDesignPayload {
  name?: string
  furniture_type?: FurnitureType
  outer_box?: FurnitureOuterBox | null
  material?: Partial<FurnitureMaterial>
  shelves?: FurnitureShelf[]
  partitions?: FurniturePartition[]
  drawers?: FurnitureDrawer[]
  custom_panels?: FurnitureCustomPanel[]
  shelf_partitions?: FurnitureShelfPartition[]
  freehand_paths?: FurnitureFreehandPath[]
  section_configs?: Record<string, FurnitureSectionConfig>
  preview_settings?: FurnitureDesignPreviewSettings | null
}

export interface UpdateFurnitureDesignPayload {
  name?: string
  furniture_type?: FurnitureType
  outer_box?: FurnitureOuterBox | null
  material?: Partial<FurnitureMaterial>
  shelves?: FurnitureShelf[]
  partitions?: FurniturePartition[]
  drawers?: FurnitureDrawer[]
  custom_panels?: FurnitureCustomPanel[]
  shelf_partitions?: FurnitureShelfPartition[]
  freehand_paths?: FurnitureFreehandPath[]
  section_configs?: Record<string, FurnitureSectionConfig>
  preview_settings?: FurnitureDesignPreviewSettings | null
}

export const listFurnitureDesigns = (params?: {
  furniture_type?: FurnitureType
  page?: number
  limit?: number
}) =>
  api.get<{ success: boolean; data: FurnitureDesignListResult }>('/furniture-designs', { params })

export const getFurnitureDesign = (designId: string) =>
  api.get<{ success: boolean; data: FurnitureDesign }>(`/furniture-designs/${designId}`)

export const createFurnitureDesign = (payload: CreateFurnitureDesignPayload) =>
  api.post<{ success: boolean; data: FurnitureDesign }>('/furniture-designs', payload)

export const updateFurnitureDesign = (designId: string, payload: UpdateFurnitureDesignPayload) =>
  api.put<{ success: boolean; data: FurnitureDesign }>(`/furniture-designs/${designId}`, payload)

export const deleteFurnitureDesign = (designId: string) =>
  api.delete<{ success: boolean; data: { deleted: boolean; design_id: string } }>(`/furniture-designs/${designId}`)
