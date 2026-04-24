import api from './api'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'number' | 'dropdown' | 'date' | 'boolean'
export type LogCostMode = 'quantity_x_unit_cost' | 'direct_amount' | 'manual_total'

export interface SchemaField {
  field_id: string
  label: string
  field_type: FieldType
  required: boolean
  options?: string[]   // only for dropdown
  added_at: string
}

export interface SchemaVersion {
  version: number
  fields: SchemaField[]
  entry_fields?: SchemaField[]
  created_at: string
}

export interface LogType {
  id: string
  name: string
  current_version: number
  current_schema: SchemaField[]
  current_entry_schema?: SchemaField[]
  uses_split_schema?: boolean
  cost_mode?: LogCostMode
  schema_history: SchemaVersion[]
  categories?: LogCategory[]
  entry_count?: number
  status: 'active' | 'archived'
  created_at: string
}

export interface LogCategory {
  id: string
  log_type_id: string
  name: string
  description?: string
  entry_count: number
  status: 'active' | 'archived'
  created_at: string
}

export interface LogItem {
  id: string
  log_type_id: string
  category_id: string
  name: string
  description?: string
  schema_version: number
  fields: FieldValue[]
  entry_count: number
  status: 'active' | 'archived'
  created_at: string
}

export interface FieldValue {
  field_id: string
  label: string
  value: unknown
}

export interface LogEntry {
  id: string
  project_id: string
  log_type_id: string
  log_type_name: string
  category_id: string
  category_name: string
  item_id?: string
  item_name?: string
  schema_version: number
  quantity?: number
  total_cost?: number
  fields: FieldValue[]
  log_date: string
  notes?: string
  created_by: string
  created_at: string
}

export interface PricingRateEntry {
  keys: Record<string, string>
  rate: number
}

export interface PricingRuleVersion {
  version: number
  name: string
  dimension_fields: string[]
  rates: PricingRateEntry[]
  created_at: string
}

export interface PricingRule {
  id: string
  log_type_id: string
  name: string
  dimension_fields: string[]
  rates: PricingRateEntry[]
  current_version: number
  version_history: PricingRuleVersion[]
  created_at: string
  updated_at: string
}

// ── Log Type API ──────────────────────────────────────────────────────────────

export const listLogTypes = (params?: { include_archived?: boolean }) =>
  api.get<{ success: boolean; data: LogType[] }>('/log-types', { params })

export const getLogType = (id: string) =>
  api.get<{ success: boolean; data: LogType }>(`/log-types/${id}`)

export const createLogType = (payload: {
  name: string
  item_fields: Omit<SchemaField, 'field_id' | 'added_at'>[]
  entry_fields: Omit<SchemaField, 'field_id' | 'added_at'>[]
  cost_mode: LogCostMode
}) =>
  api.post<{ success: boolean; data: LogType }>('/log-types', payload)

export const updateLogTypeSchema = (id: string, payload: { item_fields: SchemaField[]; entry_fields: SchemaField[]; cost_mode: LogCostMode }) =>
  api.put<{ success: boolean; data: LogType }>(`/log-types/${id}/schema`, payload)

export const archiveLogType = (id: string) =>
  api.delete(`/log-types/${id}`)

export const restoreLogType = (id: string) =>
  api.post(`/log-types/${id}/restore`)

export const getPricingRule = (logTypeId: string) =>
  api.get<{ success: boolean; data: PricingRule | null }>(`/log-types/${logTypeId}/pricing-rule`)

export const savePricingRule = (logTypeId: string, payload: {
  name: string
  dimension_fields: string[]
  rates: PricingRateEntry[]
}) => api.post<{ success: boolean; data: PricingRule }>(`/log-types/${logTypeId}/pricing-rule`, payload)

export const deletePricingRule = (pricingRuleId: string) =>
  api.delete(`/pricing-rules/${pricingRuleId}`)

// ── Log Category API ──────────────────────────────────────────────────────────

export const listLogCategories = (logTypeId: string, params?: { include_archived?: boolean }) =>
  api.get<{ success: boolean; data: LogCategory[] }>(`/log-types/${logTypeId}/categories`, { params })

export const createLogCategory = (logTypeId: string, payload: { name: string; description?: string }) =>
  api.post<{ success: boolean; data: LogCategory }>(`/log-types/${logTypeId}/categories`, payload)

export const archiveLogCategory = (id: string) =>
  api.delete(`/log-categories/${id}`)

export const restoreLogCategory = (id: string) =>
  api.post(`/log-categories/${id}/restore`)

// ── Log Item API ──────────────────────────────────────────────────────────────

export const listLogItems = (categoryId: string, params?: { include_archived?: boolean }) =>
  api.get<{ success: boolean; data: LogItem[] }>(`/log-categories/${categoryId}/items`, { params })

export const createLogItem = (categoryId: string, payload: { description?: string; fields: FieldValue[] }) =>
  api.post<{ success: boolean; data: LogItem }>(`/log-categories/${categoryId}/items`, payload)

export const updateLogItem = (id: string, payload: { fields: FieldValue[] }) =>
  api.put<{ success: boolean; data: LogItem }>(`/log-items/${id}`, payload)

export const archiveLogItem = (id: string) =>
  api.delete(`/log-items/${id}`)

export const restoreLogItem = (id: string) =>
  api.post(`/log-items/${id}/restore`)

// ── Log Entry API ─────────────────────────────────────────────────────────────

export const listLogEntries = (
  projectId: string,
  params?: { log_type_id?: string; category_id?: string; log_date?: string },
) =>
  api.get<{ success: boolean; data: LogEntry[] }>(`/projects/${projectId}/logs`, { params })

export const createLogEntry = (
  projectId: string,
  payload: {
    log_type_id: string
    category_id: string
    item_id?: string
    quantity?: number
    log_date: string        // "YYYY-MM-DD"
    fields: FieldValue[]
    notes?: string
  },
) => api.post<{ success: boolean; data: LogEntry }>(`/projects/${projectId}/logs`, payload)

export const updateLogEntry = (
  projectId: string,
  entryId: string,
  payload: { fields?: FieldValue[]; notes?: string; quantity?: number },
) => api.put<{ success: boolean; data: LogEntry }>(`/projects/${projectId}/logs/${entryId}`, payload)

export const deleteLogEntry = (projectId: string, entryId: string) =>
  api.delete(`/projects/${projectId}/logs/${entryId}`)
