import api from './api'

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'

export interface QuotationItem {
  item_id: string
  product_id?: string
  description: string
  size?: string
  sqft?: number | null
  qty: number
  use_quantity_rate?: boolean
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
  subtotal_amount: number
  discount_percent?: number
  discount_amount?: number
  apply_gst?: boolean
  gst_percent?: number
  gst_amount?: number
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

export interface FloorPlanAnalysisUploadResult {
  status: 'upload_validated' | 'analysis_completed'
  message: string
  file: {
    filename: string
    content_type: string
    kind: 'image' | 'pdf'
    size_bytes: number
  }
  client: {
    name: string
    phone?: string
    location?: string
  }
  analysis_image: {
    source: 'original_upload' | 'pdf_first_page'
    page: number
    converted: boolean
    converter?: string
    content_type: string
    kind: 'image' | 'pdf'
    size_bytes: number
    data_url?: string
  }
  rooms: Array<{
    type: string
    label: string
    confidence: number
  }>
  warnings: string[]
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface QuotationItemInput {
  product_id?: string
  description: string
  size?: string
  sqft?: number | null
  qty: number
  use_quantity_rate?: boolean
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
  discount_percent?: number
  apply_gst?: boolean
  gst_percent?: number
  notes?: string
}

export interface UpdateQuotationPayload {
  client_name?: string
  client_phone?: string
  client_location?: string
  sections?: QuotationSectionInput[]
  discount_percent?: number
  apply_gst?: boolean
  gst_percent?: number
  notes?: string
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const listQuotations = (params?: { status?: string; page?: number; limit?: number }) =>
  api.get<{ success: boolean; data: QuotationListResult }>('/quotations', { params })

export const getQuotation = (quotationId: string) =>
  api.get<{ success: boolean; data: Quotation }>(`/quotations/${quotationId}`)

export const createQuotation = (payload: CreateQuotationPayload) =>
  api.post<{ success: boolean; data: Quotation }>('/quotations', payload)

export const analyzeFloorPlanQuotation = (payload: {
  file: File
  client_name: string
  client_phone?: string
  client_location?: string
}) => {
  const formData = new FormData()
  formData.append('file', payload.file)
  formData.append('client_name', payload.client_name)
  if (payload.client_phone) formData.append('client_phone', payload.client_phone)
  if (payload.client_location) formData.append('client_location', payload.client_location)

  return api.post<{ success: boolean; data: FloorPlanAnalysisUploadResult }>(
    '/quotations/analyze-floor-plan',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
}

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
