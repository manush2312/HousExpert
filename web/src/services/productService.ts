import api from './api'

export interface Product {
  id: string
  product_id: string
  name: string
  default_size?: string
  created_at: string
  updated_at: string
}

export interface CreateProductPayload {
  name: string
  default_size?: string
}

export interface UpdateProductPayload {
  name?: string
  default_size?: string
}

export const listProducts = () =>
  api.get<{ success: boolean; data: Product[] }>('/products')

export const createProduct = (payload: CreateProductPayload) =>
  api.post<{ success: boolean; data: Product }>('/products', payload)

export const updateProduct = (productId: string, payload: UpdateProductPayload) =>
  api.put<{ success: boolean; data: Product }>(`/products/${productId}`, payload)

export const deleteProduct = (productId: string) =>
  api.delete<{ success: boolean; data: { deleted: boolean } }>(`/products/${productId}`)
