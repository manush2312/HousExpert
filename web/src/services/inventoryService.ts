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
  vendor_pricing?: InventoryVendorPricing[]
  notes?: string
  created_at: string
  updated_at: string
}

export interface InventoryVendorPricing {
  supplier_name: string
  default_buy_price?: number
  default_sell_price?: number
  lead_time_days?: number
  preferred_supplier?: boolean
  notes?: string
}

export type InventoryMovementType = 'in' | 'out' | 'adjustment'

export interface InventoryMovement {
  id: string
  movement_id: string
  item_id: string
  item_name: string
  item_unit: string
  lot_id?: string
  lot_label?: string
  supplier_bucket?: string
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

export interface InventorySupplierStock {
  item_id: string
  item_name: string
  item_unit: string
  supplier_bucket: string
  available_qty: number
  unit_cost?: number
}

export interface InventoryStockLot {
  lot_id: string
  item_id: string
  item_name: string
  item_unit: string
  supplier_bucket: string
  received_quantity: number
  remaining_quantity: number
  unit_cost?: number
  default_sell_price?: number
  received_date: string
  document_number?: string
  reference?: string
  notes?: string
  label: string
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
  vendor_pricing?: InventoryVendorPricing[]
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
  vendor_pricing?: InventoryVendorPricing[]
  notes?: string
}

export interface CreateInventoryMovementPayload {
  item_id: string
  type: InventoryMovementType
  reason?: string
  quantity: number
  unit_cost?: number
  party?: string
  supplier_bucket?: string
  lot_id?: string
  document_number?: string
  transaction_date?: string
  reference?: string
  notes?: string
}

export const listInventoryItems = () =>
  api.get<{ success: boolean; data: InventoryItem[] }>('/inventory/items')

export const listAllInventoryStockLots = () =>
  api.get<{ success: boolean; data: InventoryStockLot[] }>('/inventory/stock-lots')

export const listInventorySupplierStock = (itemId: string) =>
  api.get<{ success: boolean; data: InventorySupplierStock[] }>(`/inventory/items/${itemId}/supplier-stock`)

export const listInventoryStockLots = (itemId: string) =>
  api.get<{ success: boolean; data: InventoryStockLot[] }>(`/inventory/items/${itemId}/stock-lots`)

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
