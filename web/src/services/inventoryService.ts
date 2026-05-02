import api from './api'

export interface InventoryItem {
  id: string
  item_id: string
  sku?: string
  name: string
  category?: string
  unit: string
  usage_unit?: string
  usage_units_per_stock_unit?: number
  supplier?: string
  location?: string
  min_stock_level: number
  current_stock: number
  last_purchase_cost?: number
  notes?: string
  created_at: string
  updated_at: string
}

export type InventoryMovementType = 'in' | 'out' | 'adjustment'

export interface InventoryMovement {
  id: string
  movement_id: string
  item_id: string
  item_name: string
  item_unit: string
  type: InventoryMovementType
  reason?: string
  quantity: number
  unit_cost?: number
  total_amount?: number
  balance_after: number
  party?: string
  document_number?: string
  reference?: string
  notes?: string
  transaction_date: string
  created_at: string
}

export interface InventorySummary {
  total_items: number
  total_units: number
  low_stock_count: number
  out_of_stock_count: number
  inventory_value: number
}

export interface CreateInventoryItemPayload {
  sku?: string
  name: string
  category?: string
  unit?: string
  usage_unit?: string
  usage_units_per_stock_unit?: number
  supplier?: string
  location?: string
  min_stock_level?: number
  opening_stock?: number
  last_purchase_cost?: number
  notes?: string
}

export interface UpdateInventoryItemPayload {
  sku?: string
  name?: string
  category?: string
  unit?: string
  usage_unit?: string
  usage_units_per_stock_unit?: number
  supplier?: string
  location?: string
  min_stock_level?: number
  last_purchase_cost?: number
  notes?: string
}

export interface CreateInventoryMovementPayload {
  item_id: string
  type: InventoryMovementType
  reason?: string
  quantity: number
  unit_cost?: number
  party?: string
  document_number?: string
  transaction_date?: string
  reference?: string
  notes?: string
}

export const listInventoryItems = () =>
  api.get<{ success: boolean; data: InventoryItem[] }>('/inventory/items')

export const createInventoryItem = (payload: CreateInventoryItemPayload) =>
  api.post<{ success: boolean; data: InventoryItem }>('/inventory/items', payload)

export const updateInventoryItem = (itemId: string, payload: UpdateInventoryItemPayload) =>
  api.put<{ success: boolean; data: InventoryItem }>(`/inventory/items/${itemId}`, payload)

export const deleteInventoryItem = (itemId: string) =>
  api.delete<{ success: boolean; data: { deleted: boolean; item_id: string } }>(`/inventory/items/${itemId}`)

export const listInventoryMovements = (params?: { item_id?: string; type?: InventoryMovementType | 'all'; reason?: string; date_from?: string; date_to?: string; limit?: number }) =>
  api.get<{ success: boolean; data: InventoryMovement[] }>('/inventory/movements', { params })

export const createInventoryMovement = (payload: CreateInventoryMovementPayload) =>
  api.post<{ success: boolean; data: InventoryMovement }>('/inventory/movements', payload)

export const getInventorySummary = () =>
  api.get<{ success: boolean; data: InventorySummary }>('/inventory/summary')
