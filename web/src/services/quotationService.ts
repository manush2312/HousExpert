import api from './api'

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'

export interface QuotationItem {
  item_id: string
  product_id?: string
  description: string
  size?: string
  sqft?: number | null
  qty: number
  rate: number
  amount: number
  note?: string
}

export interface QuotationSection {
  section_id: string
  room_name: string
  items: QuotationItem[]
}

export interface Quotation {
  id: string
  quotation_id: string
  client_name: string
  client_phone?: string
  client_location?: string
  sections: QuotationSection[]
  total_amount: number
  status: QuotationStatus
  converted_project_id?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface QuotationListResult {
  quotations: Quotation[]
  total: number
  page: number
  limit: number
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface QuotationItemInput {
  product_id?: string
  description: string
  size?: string
  sqft?: number | null
  qty: number
  rate: number
  note?: string
}

export interface QuotationSectionInput {
  room_name: string
  items: QuotationItemInput[]
}

export interface CreateQuotationPayload {
  client_name: string
  client_phone?: string
  client_location?: string
  sections?: QuotationSectionInput[]
  notes?: string
}

export interface UpdateQuotationPayload {
  client_name?: string
  client_phone?: string
  client_location?: string
  sections?: QuotationSectionInput[]
  notes?: string
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const listQuotations = (params?: { status?: string; page?: number; limit?: number }) =>
  api.get<{ success: boolean; data: QuotationListResult }>('/quotations', { params })

export const getQuotation = (quotationId: string) =>
  api.get<{ success: boolean; data: Quotation }>(`/quotations/${quotationId}`)

export const createQuotation = (payload: CreateQuotationPayload) =>
  api.post<{ success: boolean; data: Quotation }>('/quotations', payload)

export const updateQuotation = (quotationId: string, payload: UpdateQuotationPayload) =>
  api.put<{ success: boolean; data: Quotation }>(`/quotations/${quotationId}`, payload)

export const updateQuotationStatus = (quotationId: string, status: QuotationStatus) =>
  api.put<{ success: boolean; data: Quotation }>(`/quotations/${quotationId}/status`, { status })

export const convertQuotation = (quotationId: string, projectId: string) =>
  api.post<{ success: boolean; data: { converted: boolean } }>(
    `/quotations/${quotationId}/convert`,
    { project_id: projectId },
  )

export const deleteQuotation = (quotationId: string) =>
  api.delete<{ success: boolean; data: { deleted: boolean } }>(`/quotations/${quotationId}`)
