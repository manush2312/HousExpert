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
  average_unit_cost?: number
  inventory_value?: number
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
  display_quantity?: number
  display_unit?: string
  unit_cost?: number
  total_amount?: number
  cost_status?: LotCostStatus
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
  average_unit_cost?: number
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
  cost_status?: LotCostStatus
  cost_source?: LotCostSource
  estimated_unit_cost?: number
  invoice_number?: string
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
  /** Receipt whose supplier bill has not arrived — stored at an estimate and
   *  corrected later via confirmLotBill. Ignored on outgoing stock. */
  price_pending?: boolean
  party?: string
  supplier_bucket?: string
  lot_id?: string
  document_number?: string
  transaction_date?: string
  reference?: string
  notes?: string
}

export interface InventoryOverview {
  items: InventoryItem[]
  summary: InventorySummary
  stock_lots: InventoryStockLot[]
}

export interface InventoryLogLinkRow {
  inventory_item_id: string
  log_type_id: string
  log_type_name: string
  category_id: string
  category_name: string
  item_id: string
  item_name: string
  inventory_unit: string
  quantity_unit: string
  usage_per_quantity: number
}

// Items, summary and stock lots in one request. The three separate endpoints
// below each re-ran the full item query and its cost enrichment, so fetching
// them in parallel did the same work three times.
export const getInventoryOverview = () =>
  api.get<{ success: boolean; data: InventoryOverview }>('/inventory/overview')

// Every log item wired to an inventory item, in one indexed query — replaces
// walking log types → categories → items from the client.
export const listInventoryLogLinks = () =>
  api.get<{ success: boolean; data: InventoryLogLinkRow[] }>('/inventory/log-links')

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

// ── Goods received, bill pending ─────────────────────────────────────────────
//
// Stock often lands days before its invoice. Such a receipt is stored at an
// estimated rate and flagged "provisional"; when the bill arrives, confirming it
// reprices the lot and every issue drawn from it, so each project's cost becomes
// the real one. An absent cost_status means confirmed — lots created before this
// feature are settled history.

export type LotCostStatus = 'provisional' | 'confirmed'
export type LotCostSource = 'invoice' | 'vendor_default' | 'last_purchase' | 'manual'

export interface CostRevisionSplit {
  project_id?: string
  project_ref?: string
  project_name?: string
  quantity: number
  previous_amount: number
  new_amount: number
  delta: number
  movement_id_count?: number
}

export interface PendingBillRow {
  lot_id: string
  item_id: string
  item_name: string
  item_unit: string
  supplier_bucket: string
  received_quantity: number
  remaining_quantity: number
  consumed_quantity: number
  estimated_unit_cost: number
  estimated_value: number
  cost_source?: LotCostSource
  received_date: string
  days_pending: number
  document_number?: string
  notes?: string
  label: string
  suggested_unit_cost?: number
  used_in_projects?: CostRevisionSplit[]
}

export interface PendingBillsSummary {
  pending_lots: number
  estimated_value: number
  oldest_days: number
}

export interface InventoryCostRevision {
  id: string
  revision_id: string
  lot_id: string
  item_id: string
  item_name: string
  item_unit?: string
  supplier_bucket?: string
  previous_unit_cost: number
  new_unit_cost: number
  unit_cost_delta: number
  received_quantity: number
  consumed_quantity: number
  consumed_delta: number
  stock_delta: number
  total_delta: number
  invoice_number?: string
  invoice_date?: string
  affected_movement_ids?: string[]
  affected_projects?: CostRevisionSplit[]
  confirmed_by?: string
  created_at: string
}

export interface ConfirmLotBillPayload {
  item_id?: string
  unit_cost: number
  invoice_number?: string
  invoice_date?: string
  notes?: string
  confirmed_by?: string
  /** Compute the full impact without writing anything — powers the preview. */
  dry_run?: boolean
}

export interface ConfirmLotBillResult {
  dry_run: boolean
  lot: InventoryStockLot
  revision: InventoryCostRevision
  projects: CostRevisionSplit[]
}

export interface ProjectCostConfidence {
  project_id: string
  confirmed_cost: number
  provisional_cost: number
  total_cost: number
  pending_lots: number
  pending_items_label?: string
}

export const listPendingBills = () =>
  api.get<{ success: boolean; data: PendingBillRow[] }>('/inventory/pending-bills')

export const getPendingBillsSummary = () =>
  api.get<{ success: boolean; data: PendingBillsSummary }>('/inventory/pending-bills/summary')

export const confirmLotBill = (lotId: string, payload: ConfirmLotBillPayload) =>
  api.post<{ success: boolean; data: ConfirmLotBillResult }>(
    `/inventory/stock-lots/${lotId}/confirm-bill`,
    payload,
  )

export const listCostRevisions = (params?: { item_id?: string; limit?: number }) =>
  api.get<{ success: boolean; data: InventoryCostRevision[] }>('/inventory/cost-revisions', { params })

export const getProjectCostConfidence = (projectRef: string) =>
  api.get<{ success: boolean; data: ProjectCostConfidence }>(
    `/inventory/projects/${projectRef}/cost-confidence`,
  )
