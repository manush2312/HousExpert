import api from './api'

export interface Vendor {
  id: string
  vendor_id: string
  name: string
  gstin?: string
  mobile?: string
  email?: string
  address?: string
  categories_served?: string[]
  notes?: string
  status: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateVendorPayload {
  name: string
  gstin?: string
  mobile?: string
  email?: string
  address?: string
  categories_served?: string[]
  notes?: string
  status?: string
}

export type UpdateVendorPayload = Partial<CreateVendorPayload>

export interface ListVendorParams {
  category?: string
  status?: 'active' | 'inactive'
}

export const listVendors = (params?: ListVendorParams) =>
  api.get<{ success: boolean; data: Vendor[] }>('/vendors', { params })

export const createVendor = (payload: CreateVendorPayload) =>
  api.post<{ success: boolean; data: Vendor }>('/vendors', payload)

export const updateVendor = (vendorId: string, payload: UpdateVendorPayload) =>
  api.put<{ success: boolean; data: Vendor }>(`/vendors/${vendorId}`, payload)

export const deleteVendor = (vendorId: string) =>
  api.delete<{ success: boolean; data: { deleted: boolean; vendor_id: string } }>(`/vendors/${vendorId}`)
