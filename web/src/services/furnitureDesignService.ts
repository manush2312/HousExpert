import api from './api'

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
  section_configs: Record<string, FurnitureSectionConfig>
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
  section_configs?: Record<string, FurnitureSectionConfig>
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
  section_configs?: Record<string, FurnitureSectionConfig>
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
